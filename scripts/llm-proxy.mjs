#!/usr/bin/env node
/**
 * llm-proxy — Anthropic Messages API  ->  OpenAI chat/completions shim.
 *
 * Lets any Anthropic-native harness (Claude Code, the Claude SDK, anything that
 * honours ANTHROPIC_BASE_URL) drive a local llama-server / any OpenAI-compatible
 * endpoint.
 *
 * Zero dependencies — Node 18+ built-ins only.
 *
 *   UPSTREAM   OpenAI-compatible base URL   (default http://127.0.0.1:8089/v1)
 *   MODEL      model name sent upstream     (default qwen-local)
 *   PORT       port to listen on            (default 8790)
 *   PROXY_THINK=0     disable the model's reasoning phase (default: ON)
 *   EMIT_THINKING=1   surface reasoning_content as visible text
 *   DEBUG=1           log every translated request to stderr
 *
 * Thinking is ON by default, so the stream goes quiet for a long time: a harness
 * prompt is ~23k tokens, and on the 27B that is ~85 s of prefill plus minutes of
 * reasoning before the first visible token. Nothing is wrong during that window,
 * but a silent socket looks dead — so this proxy emits SSE pings throughout.
 * Cap the reasoning phase server-side with `--reasoning-budget` (llm-serve does).
 *
 * Anthropic `thinking` blocks are never emitted: they carry a signature the
 * harness round-trips on the next turn, and a local model cannot produce a valid
 * one, so emitting them risks 400s on multi-turn conversations.
 */

import http from "node:http";
import { randomUUID } from "node:crypto";

const UPSTREAM = (process.env.UPSTREAM || "http://127.0.0.1:8089/v1").replace(/\/$/, "");
const MODEL = process.env.MODEL || "qwen-local";
const PORT = Number(process.env.PORT || 8790);
const THINK = process.env.PROXY_THINK !== "0";
const EMIT_THINKING = process.env.EMIT_THINKING === "1";
const DEBUG = process.env.DEBUG === "1";

// How often to emit an SSE ping while the upstream is silent. Prefill on a large
// harness prompt can run 85 s+ with no bytes at all; without a heartbeat the
// harness concludes the connection is dead and retries.
const PING_INTERVAL_MS = Number(process.env.PING_INTERVAL_MS || 5000);

const log = (...a) => console.error("[llm-proxy]", ...a);
const debug = (...a) => DEBUG && log(...a);

/* ------------------------------------------------------------------ */
/* Anthropic request -> OpenAI request                                  */
/* ------------------------------------------------------------------ */

/** Anthropic `system` is a string or an array of text blocks. */
function systemToText(system) {
  if (!system) return null;
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system.filter((b) => b.type === "text").map((b) => b.text).join("\n\n");
  }
  return null;
}

/** Flatten an Anthropic content array to plain text (ignoring non-text blocks). */
function blocksToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Anthropic messages -> OpenAI messages.
 *
 * The shapes differ in two structural ways, not just naming:
 *   - assistant tool calls are content blocks in Anthropic, a sibling
 *     `tool_calls` array in OpenAI;
 *   - tool results are user-role content blocks in Anthropic, but their own
 *     `role: "tool"` messages in OpenAI.
 */
function convertMessages(anthropicMessages, systemText) {
  const out = [];
  if (systemText) out.push({ role: "system", content: systemText });

  for (const msg of anthropicMessages || []) {
    const content = msg.content;

    if (typeof content === "string") {
      out.push({ role: msg.role, content });
      continue;
    }
    if (!Array.isArray(content)) continue;

    if (msg.role === "assistant") {
      const text = blocksToText(content);
      const toolUses = content.filter((b) => b.type === "tool_use");
      const m = { role: "assistant", content: text || null };
      if (toolUses.length) {
        m.tool_calls = toolUses.map((t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) },
        }));
      }
      // Skip assistant turns that carried only stripped blocks (e.g. thinking).
      if (m.content || m.tool_calls) out.push(m);
      continue;
    }

    // user role: tool_result blocks become their own `tool` messages, and must
    // precede whatever plain text accompanied them.
    const toolResults = content.filter((b) => b.type === "tool_result");
    for (const tr of toolResults) {
      let body = typeof tr.content === "string" ? tr.content : blocksToText(tr.content);
      if (tr.is_error) body = `ERROR: ${body}`;
      out.push({ role: "tool", tool_call_id: tr.tool_use_id, content: body || "(no output)" });
    }

    const hasImage = content.some((b) => b.type === "image");
    let text = blocksToText(content);
    if (hasImage) {
      // The local models are text-only; say so rather than silently dropping.
      text = `${text}\n[an image was attached but this model cannot see images]`.trim();
    }
    if (text) out.push({ role: "user", content: text });
  }

  // OpenAI rejects a conversation whose first non-system turn is a tool result.
  const firstReal = out.findIndex((m) => m.role !== "system");
  if (firstReal !== -1 && out[firstReal].role === "tool") {
    out.splice(firstReal, 0, { role: "user", content: "(continuing)" });
  }
  return out;
}

function convertTools(tools) {
  if (!Array.isArray(tools) || !tools.length) return undefined;
  return tools
    .filter((t) => t.name) // drop Anthropic server-side tools (web_search etc.)
    .map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description || "",
        parameters: t.input_schema || { type: "object", properties: {} },
      },
    }));
}

function convertToolChoice(tc) {
  if (!tc) return undefined;
  if (tc.type === "auto") return "auto";
  if (tc.type === "any") return "required";
  if (tc.type === "none") return "none";
  if (tc.type === "tool" && tc.name) return { type: "function", function: { name: tc.name } };
  return undefined;
}

function toOpenAIRequest(body) {
  const systemText = systemToText(body.system);
  const req = {
    model: MODEL,
    messages: convertMessages(body.messages, systemText),
    stream: !!body.stream,
  };
  if (body.max_tokens) req.max_tokens = body.max_tokens;
  if (typeof body.temperature === "number") req.temperature = body.temperature;
  if (typeof body.top_p === "number") req.top_p = body.top_p;
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length) req.stop = body.stop_sequences;

  const tools = convertTools(body.tools);
  if (tools) {
    req.tools = tools;
    const choice = convertToolChoice(body.tool_choice);
    if (choice) req.tool_choice = choice;
  }
  if (req.stream) req.stream_options = { include_usage: true };
  // Suppress the model's reasoning phase unless explicitly opted in.
  if (!THINK) req.chat_template_kwargs = { enable_thinking: false };
  return req;
}

const STOP_REASON = {
  stop: "end_turn",
  length: "max_tokens",
  tool_calls: "tool_use",
  function_call: "tool_use",
  content_filter: "end_turn",
};

/* ------------------------------------------------------------------ */
/* OpenAI response -> Anthropic response                                */
/* ------------------------------------------------------------------ */

function toAnthropicResponse(oai, requestedModel) {
  const choice = oai.choices?.[0] || {};
  const msg = choice.message || {};
  const content = [];

  if (EMIT_THINKING && msg.reasoning_content) {
    content.push({ type: "text", text: `<thinking>\n${msg.reasoning_content}\n</thinking>` });
  }
  if (msg.content) content.push({ type: "text", text: msg.content });

  for (const tc of msg.tool_calls || []) {
    let input = {};
    try {
      input = JSON.parse(tc.function?.arguments || "{}");
    } catch {
      input = { _raw: tc.function?.arguments || "" };
    }
    content.push({ type: "tool_use", id: tc.id || `toolu_${randomUUID()}`, name: tc.function?.name, input });
  }
  if (!content.length) content.push({ type: "text", text: "" });

  return {
    id: `msg_${(oai.id || randomUUID()).replace(/^chatcmpl-/, "")}`,
    type: "message",
    role: "assistant",
    model: requestedModel || MODEL,
    content,
    stop_reason: STOP_REASON[choice.finish_reason] || "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: oai.usage?.prompt_tokens ?? 0,
      output_tokens: oai.usage?.completion_tokens ?? 0,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Streaming                                                            */
/* ------------------------------------------------------------------ */

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Translate an OpenAI SSE stream into the Anthropic event sequence.
 *
 * The bookkeeping here is all about content-block indices: Anthropic requires a
 * strict start/delta/stop lifecycle per block, while OpenAI just emits deltas.
 * We open a text block lazily on first text, and one tool_use block per tool
 * call index, closing whatever is open before opening the next.
 */
async function streamAnthropic(upstreamRes, res, requestedModel) {
  const msgId = `msg_${randomUUID()}`;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  sse(res, "message_start", {
    type: "message_start",
    message: {
      id: msgId,
      type: "message",
      role: "assistant",
      model: requestedModel || MODEL,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });

  // Keep the socket demonstrably alive through prefill and the reasoning phase,
  // both of which produce no client-visible bytes for minutes on the dense model.
  let lastWrite = Date.now();
  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    if (Date.now() - lastWrite >= PING_INTERVAL_MS) {
      res.write(`event: ping\ndata: ${JSON.stringify({ type: "ping" })}\n\n`);
      lastWrite = Date.now();
    }
  }, PING_INTERVAL_MS);
  // A harness that gives up mid-generation must not leave the timer running.
  res.on("close", () => clearInterval(heartbeat));

  const emit = (event, data) => {
    sse(res, event, data);
    lastWrite = Date.now();
  };

  let blockIndex = -1;
  let textOpen = false;
  const toolBlocks = new Map(); // upstream tool index -> our block index
  let stopReason = "end_turn";
  let outputTokens = 0;
  let inputTokens = 0;
  let thinkingOpen = false;

  // Idempotent: a block is stopped at most once, whatever path closes it.
  let blockOpen = false;
  const closeOpenBlock = () => {
    if (blockOpen) {
      emit("content_block_stop", { type: "content_block_stop", index: blockIndex });
      blockOpen = false;
    }
    textOpen = false;
    thinkingOpen = false;
  };
  const openBlock = (contentBlock) => {
    closeOpenBlock();
    blockIndex++;
    blockOpen = true;
    emit("content_block_start", { type: "content_block_start", index: blockIndex, content_block: contentBlock });
  };

  const decoder = new TextDecoder();
  let buf = "";

  for await (const chunk of upstreamRes.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let evt;
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }

      if (evt.usage) {
        inputTokens = evt.usage.prompt_tokens ?? inputTokens;
        outputTokens = evt.usage.completion_tokens ?? outputTokens;
      }

      const choice = evt.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta || {};

      // Reasoning arrives in its own field (--reasoning-format deepseek). Shown
      // only on request; otherwise the pings above cover the silence.
      if (EMIT_THINKING && delta.reasoning_content) {
        if (!thinkingOpen) {
          openBlock({ type: "text", text: "" });
          textOpen = true;
          thinkingOpen = true;
          emit("content_block_delta", {
            type: "content_block_delta",
            index: blockIndex,
            delta: { type: "text_delta", text: "[thinking] " },
          });
        }
        emit("content_block_delta", {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "text_delta", text: delta.reasoning_content },
        });
      }

      if (delta.content) {
        // A thinking block must be closed before the answer starts.
        if (thinkingOpen) closeOpenBlock();
        if (!textOpen) {
          openBlock({ type: "text", text: "" });
          textOpen = true;
        }
        emit("content_block_delta", {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "text_delta", text: delta.content },
        });
      }

      for (const tc of delta.tool_calls || []) {
        const idx = tc.index ?? 0;
        if (!toolBlocks.has(idx)) {
          openBlock({
            type: "tool_use",
            id: tc.id || `toolu_${randomUUID()}`,
            name: tc.function?.name || "unknown",
            input: {},
          });
          toolBlocks.set(idx, blockIndex);
        }
        const args = tc.function?.arguments;
        if (args) {
          emit("content_block_delta", {
            type: "content_block_delta",
            index: toolBlocks.get(idx),
            delta: { type: "input_json_delta", partial_json: args },
          });
        }
      }

      if (choice.finish_reason) stopReason = STOP_REASON[choice.finish_reason] || "end_turn";
    }
  }

  clearInterval(heartbeat);
  closeOpenBlock();
  emit("message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  });
  emit("message_stop", { type: "message_stop" });
  res.end();
}

/* ------------------------------------------------------------------ */
/* Server                                                               */
/* ------------------------------------------------------------------ */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function anthropicError(res, code, message, type = "api_error") {
  sendJSON(res, code, { type: "error", error: { type, message } });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (path === "/health") return sendJSON(res, 200, { ok: true, upstream: UPSTREAM, model: MODEL });

  // Claude Code pre-flights context budget here; an approximation is fine, it
  // only drives compaction timing.
  if (path.endsWith("/count_tokens")) {
    const raw = await readBody(req);
    let approx = 0;
    try {
      const body = JSON.parse(raw);
      const text = (systemToText(body.system) || "") + JSON.stringify(body.messages || []) + JSON.stringify(body.tools || []);
      approx = Math.ceil(text.length / 3.5);
    } catch {
      approx = 0;
    }
    return sendJSON(res, 200, { input_tokens: approx });
  }

  if (path !== "/v1/messages") return anthropicError(res, 404, `no route for ${path}`, "not_found_error");
  if (req.method !== "POST") return anthropicError(res, 405, "method not allowed", "invalid_request_error");

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return anthropicError(res, 400, `bad JSON: ${e.message}`, "invalid_request_error");
  }

  const oaiReq = toOpenAIRequest(body);
  debug(`${body.model} -> ${MODEL}  msgs=${oaiReq.messages.length} tools=${oaiReq.tools?.length ?? 0} stream=${oaiReq.stream}`);

  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(oaiReq),
    });
  } catch (e) {
    log("upstream unreachable:", e.message);
    return anthropicError(res, 502, `cannot reach llama-server at ${UPSTREAM} — is it running? (${e.message})`);
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    log("upstream error", upstream.status, text.slice(0, 400));
    return anthropicError(res, upstream.status, `upstream ${upstream.status}: ${text.slice(0, 800)}`);
  }

  try {
    if (oaiReq.stream) {
      await streamAnthropic(upstream, res, body.model);
    } else {
      sendJSON(res, 200, toAnthropicResponse(await upstream.json(), body.model));
    }
  } catch (e) {
    log("translation failed:", e.stack || e.message);
    if (!res.headersSent) anthropicError(res, 500, `proxy error: ${e.message}`);
    else res.end();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  log(`listening on http://127.0.0.1:${PORT}  ->  ${UPSTREAM}  (model: ${MODEL})`);
  log(`point a harness at it:  ANTHROPIC_BASE_URL=http://127.0.0.1:${PORT}`);
});
