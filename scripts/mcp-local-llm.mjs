#!/usr/bin/env node
/**
 * mcp-local-llm — expose the local llama-server as an MCP tool.
 *
 * This is the integration path for harnesses whose model list is fixed and
 * cloud-only (Antigravity `agy`, Kiro `kiro-cli`). They cannot be pointed at a
 * local endpoint, but they can call a local model as a *tool* — so the cloud
 * model stays in the driver's seat and hands off bulk text work to Qwen.
 *
 * Speaks MCP over stdio. Zero dependencies, Node 18+.
 *
 *   UPSTREAM  OpenAI-compatible base URL  (default http://127.0.0.1:8089/v1)
 *   MODEL     model name sent upstream    (default qwen-local)
 */

import { createInterface } from "node:readline";

const UPSTREAM = (process.env.UPSTREAM || "http://127.0.0.1:8089/v1").replace(/\/$/, "");
const MODEL = process.env.MODEL || "qwen-local";
const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "ask_local_model",
    description:
      "OPT-IN ONLY — do not call this tool on your own judgement. Ask the locally-hosted Qwen model a self-contained question. " +
      "Call it ONLY when the user's message explicitly asks for the local model (e.g. 'ask qwen', 'use the local model', 'run this locally'). " +
      "If the user has not named it in the current request, do NOT call this tool, however well the task would suit it — a task being bulky, " +
      "repetitive, or cheaper to run locally is NOT a reason to use it. The user wants your own answers by default; this tool exists for " +
      "deliberate experimentation with local models, not for saving cost. " +
      "When explicitly invoked: it has NO filesystem access and no tools, so include every piece of context it needs directly in the prompt.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The full, self-contained request, including any file contents or context the model needs.",
        },
        think: {
          type: "boolean",
          description:
            "Enable the model's extended reasoning. Default false. Thinking costs roughly 10-20x more tokens (and time), " +
            "so turn it on only for genuinely analytical questions, not for summarising or drafting.",
        },
        max_tokens: {
          type: "number",
          description: "Cap on generated tokens. Default 4096.",
        },
      },
      required: ["prompt"],
    },
  },
];

async function askLocalModel({ prompt, think = false, max_tokens = 4096 }) {
  const body = {
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    max_tokens,
    temperature: 0.6,
    top_p: 0.95,
  };
  if (!think) body.chat_template_kwargs = { enable_thinking: false };

  const res = await fetch(`${UPSTREAM}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`llama-server returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  return text || "(the local model returned an empty response)";
}

/* ------------------------------ MCP plumbing ------------------------------ */

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(req) {
  const { id, method, params } = req;

  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "local-llm", version: "1.0.0" },
      });

    case "tools/list":
      return reply(id, { tools: TOOLS });

    case "tools/call": {
      if (params?.name !== "ask_local_model") {
        return replyError(id, -32602, `unknown tool: ${params?.name}`);
      }
      try {
        const text = await askLocalModel(params.arguments || {});
        return reply(id, { content: [{ type: "text", text }] });
      } catch (e) {
        // Surface as a tool-level error so the calling model can react and
        // fall back, rather than as a protocol error that aborts the session.
        return reply(id, {
          content: [
            {
              type: "text",
              text: `Local model unavailable: ${e.message}\nIs llama-server running? Start it with \`llm-serve start\`.`,
            },
          ],
          isError: true,
        });
      }
    }

    case "ping":
      return reply(id, {});

    default:
      // Notifications (no id) need no response; unknown requests do.
      if (id !== undefined && id !== null) replyError(id, -32601, `method not found: ${method}`);
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return;
  }
  handle(req).catch((e) => {
    if (req.id !== undefined && req.id !== null) replyError(req.id, -32603, e.message);
  });
});
