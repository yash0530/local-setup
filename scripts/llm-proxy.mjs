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
 *   THINK_VIEW        how the reasoning phase is shown (default: off; llm-serve
 *                     starts the proxy with `native`):
 *                       off     nothing — the stream just goes quiet
 *                       status  compact heartbeat, then a "thought for Ns" line
 *                       text    the whole chain of thought, inline
 *                       native  Anthropic thinking blocks — Claude Code's own UI
 *   THINK_TICK_MS     heartbeat interval for THINK_VIEW=status (default 10000)
 *   EMIT_THINKING=1   alias for THINK_VIEW=text
 *   DEBUG=1           log every translated request to stderr
 *   DUMP_DIR=<dir>    write every translated request to a file (see below)
 *
 * Web tools (WebSearch / WebFetch):
 *   WEB_TOOLS=0       don't stand in for them at all
 *   SEARCH_BACKEND    duckduckgo (default) | brave | searxng
 *   BRAVE_API_KEY     required for SEARCH_BACKEND=brave
 *   SEARXNG_URL       required for SEARCH_BACKEND=searxng
 *   SEARCH_RESULTS    results per search   (default 8)
 *   FETCH_MAX_CHARS   web_fetch page cap   (default 20000)
 *   MAX_PROXY_HOPS    search/answer rounds per turn (default 4)
 *
 * Thinking is ON by default, so the stream goes quiet for a long time: a harness
 * prompt is ~23k tokens, and on the 27B that is ~85 s of prefill plus minutes of
 * reasoning before the first visible token. Nothing is wrong during that window,
 * but a silent socket looks dead — so this proxy emits SSE pings throughout.
 * Cap the reasoning phase server-side with `--reasoning-budget` (llm-serve does).
 *
 * Anthropic `thinking` blocks carry a signature that is normally Anthropic's
 * proof the reasoning came back unmodified, which a local model cannot produce —
 * so these were long left unemitted for fear of 400s. That fear turns out not to
 * apply here: nothing validates the signature, because this proxy *is* the
 * server. The harness simply round-trips the block to us on the next turn, and
 * convertMessages drops it like any other non-text block. Measured end to end:
 * Claude Code parses the blocks, keeps the signature, and renders them.
 */

import http from "node:http";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const UPSTREAM = (process.env.UPSTREAM || "http://127.0.0.1:8089/v1").replace(/\/$/, "");
const MODEL = process.env.MODEL || "qwen-local";
const PORT = Number(process.env.PORT || 8790);
const THINK = process.env.PROXY_THINK !== "0";
// How the reasoning phase is surfaced. The model reasons on every turn either
// way — this only decides whether you get to see it happening.
//   off     nothing; the SSE pings are the only sign of life
//   status  compact heartbeat: "thinking… 640 tokens · 25s", then a one-line total
//   text    the whole chain of thought, inline as plain text
//   native  real Anthropic thinking blocks, rendered by Claude Code's own UI
// EMIT_THINKING=1 is kept as an alias for `text`.
const THINK_VIEW = (
  process.env.THINK_VIEW || (process.env.EMIT_THINKING === "1" ? "text" : "off")
).toLowerCase();
const THINK_TICK_MS = Number(process.env.THINK_TICK_MS || 10000);
const EMIT_THINKING = THINK_VIEW === "text";
const DEBUG = process.env.DEBUG === "1";

// How often to emit an SSE ping while the upstream is silent. Prefill on a large
// harness prompt can run 85 s+ with no bytes at all; without a heartbeat the
// harness concludes the connection is dead and retries.
const PING_INTERVAL_MS = Number(process.env.PING_INTERVAL_MS || 5000);

// Claude Code's WebSearch and WebFetch are Anthropic *server-side* tools: they
// arrive as versioned entries in `tools` (web_search_20260209, …) and the API
// itself runs them, feeding results back to the model before it ever answers.
// Point the harness at a local model and nobody is left to execute them — the
// model gets handed a tool whose results never arrive. So this proxy executes
// them, in the same shape: the call is intercepted here, never forwarded to the
// harness, and the model is re-prompted with the results.
const WEB_TOOLS = process.env.WEB_TOOLS !== "0";

// Claude Code does not use the API's server-side web_search tool. It ships its
// own client-side `WebSearch`/`WebFetch` (capital W, with an input_schema), and
// runs them itself. `WebFetch` works fine against a local model — it fetches
// directly and summarises with whatever small model is configured. `WebSearch`
// does not: its implementation reaches Anthropic for the actual search, so
// pointed at a local endpoint it comes back "Did 0 searches". So we intercept
// that one by name and run it here instead. Comma-separated list to override;
// empty string disables. WebFetch is deliberately absent — it already works.
const HARNESS_TOOLS = new Set(
  (process.env.PROXY_HARNESS_TOOLS ?? "WebSearch")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const SEARCH_BACKEND = (process.env.SEARCH_BACKEND || "duckduckgo").toLowerCase();
const SEARCH_RESULTS = Number(process.env.SEARCH_RESULTS || 8);
const BRAVE_API_KEY = process.env.BRAVE_API_KEY || "";
const SEARXNG_URL = (process.env.SEARXNG_URL || "").replace(/\/$/, "");
const FETCH_MAX_CHARS = Number(process.env.FETCH_MAX_CHARS || 20000);
const MAX_PROXY_HOPS = Number(process.env.MAX_PROXY_HOPS || 4);
const UA =
  process.env.WEB_UA ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Writes each translated upstream request to a file. The reason this is worth
// keeping: llama-server's prefix cache is all-or-nothing in practice, so when a
// session re-prefills 20k tokens the only way to find out *why* is to diff two
// consecutive payloads and see what moved.
const DUMP_DIR = process.env.DUMP_DIR || "";
if (DUMP_DIR) fs.mkdirSync(DUMP_DIR, { recursive: true });

const log = (...a) => console.error("[llm-proxy]", ...a);
const debug = (...a) => DEBUG && log(...a);

/* ------------------------------------------------------------------ */
/* Web tools the proxy executes on the model's behalf                   */
/* ------------------------------------------------------------------ */

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Collapse a fragment of markup to a single line of readable text. */
function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Full page -> text, keeping block structure as newlines so it stays readable. */
function htmlToText(html) {
  const spaced = html
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre|td)>/gi, "\n");
  return decodeEntities(spaced.replace(/<[^>]+>/g, " "))
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** DuckDuckGo sometimes hands back a redirector instead of the target URL. */
function normalizeDdgUrl(href) {
  try {
    const parsed = new URL(href.startsWith("//") ? `https:${href}` : href, "https://duckduckgo.com");
    return parsed.searchParams.get("uddg") || parsed.toString();
  } catch {
    return href;
  }
}

// Keyless, so it works on a fresh machine with nothing configured. It is
// scraped HTML though, so it can rate-limit or change shape — SEARCH_BACKEND
// switches to a real API when that matters.
async function searchDuckDuckGo(query, n) {
  const r = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`duckduckgo returned HTTP ${r.status}`);
  const html = await r.text();

  const titles = [];
  const titleRe = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m; (m = titleRe.exec(html)) && titles.length < n; ) {
    titles.push({ url: normalizeDdgUrl(m[1]), title: stripTags(m[2]) });
  }

  // Snippets appear once per result, in the same document order as the titles.
  const snippets = [];
  const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m; (m = snipRe.exec(html)); ) snippets.push(stripTags(m[1]));

  return titles.map((t, i) => ({ ...t, snippet: snippets[i] || "" }));
}

async function searchBrave(query, n) {
  if (!BRAVE_API_KEY) throw new Error("SEARCH_BACKEND=brave needs BRAVE_API_KEY");
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(n, 20)));
  const r = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": BRAVE_API_KEY },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`brave returned HTTP ${r.status}`);
  const j = await r.json();
  return (j.web?.results || []).slice(0, n).map((x) => ({
    url: x.url,
    title: x.title || x.url,
    snippet: stripTags(x.description || ""),
  }));
}

async function searchSearxng(query, n) {
  if (!SEARXNG_URL) throw new Error("SEARCH_BACKEND=searxng needs SEARXNG_URL");
  const url = new URL(`${SEARXNG_URL}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`searxng returned HTTP ${r.status}`);
  const j = await r.json();
  return (j.results || []).slice(0, n).map((x) => ({
    url: x.url,
    title: x.title || x.url,
    snippet: stripTags(x.content || ""),
  }));
}

function runSearch(query, n) {
  if (SEARCH_BACKEND === "brave") return searchBrave(query, n);
  if (SEARCH_BACKEND === "searxng") return searchSearxng(query, n);
  return searchDuckDuckGo(query, n);
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/** Matches a domain filter the way the harness's WebSearch describes it. */
const domainMatches = (host, filter) => {
  const f = String(filter).replace(/^www\./, "").toLowerCase();
  return host === f || host.endsWith(`.${f}`);
};

// Serves both the API's `web_search` shape and Claude Code's own `WebSearch`
// (which adds allowed_domains / blocked_domains); the union is harmless.
async function toolWebSearch(input) {
  const query = String(input?.query ?? "").trim();
  if (!query) return "ERROR: web search requires a non-empty `query`.";
  const n = Math.min(Number(input?.max_results) || SEARCH_RESULTS, 20);

  let results;
  try {
    results = await runSearch(query, n);
  } catch (e) {
    return `ERROR: web search failed (${e.message}). Answer from what you already know, and say the search was unavailable.`;
  }

  const allow = Array.isArray(input?.allowed_domains) ? input.allowed_domains : null;
  const block = Array.isArray(input?.blocked_domains) ? input.blocked_domains : null;
  if (allow?.length || block?.length) {
    results = results.filter((r) => {
      const host = hostOf(r.url);
      if (allow?.length && !allow.some((d) => domainMatches(host, d))) return false;
      if (block?.length && block.some((d) => domainMatches(host, d))) return false;
      return true;
    });
  }

  if (!results.length) return `No results for "${query}".`;

  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`)
    .join("\n\n");
}

async function toolWebFetch(input) {
  const url = String(input?.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return "ERROR: web_fetch requires an http(s) `url`.";
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return `ERROR: ${url} returned HTTP ${r.status}.`;
    const raw = await r.text();
    const text = /html|xml/i.test(r.headers.get("content-type") || "") ? htmlToText(raw) : raw.trim();
    const body =
      text.length > FETCH_MAX_CHARS
        ? `${text.slice(0, FETCH_MAX_CHARS)}\n\n[truncated at ${FETCH_MAX_CHARS} characters]`
        : text;
    return `# ${url}\n\n${body || "(page had no extractable text)"}`;
  } catch (e) {
    return `ERROR: could not fetch ${url} (${e.message}).`;
  }
}

// Keyed by the Anthropic server-tool `name`. The schemas are ours: the server
// tool arrives with no input_schema at all, since the real API knows its shape.
const PROXY_TOOLS = {
  web_search: {
    run: toolWebSearch,
    definition: {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Search the web. Returns ranked results with title, URL and snippet. Use for current events, documentation, or anything outside your training data. Call web_fetch on a result URL to read the full page.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query." },
            max_results: { type: "integer", description: `Maximum results (default ${SEARCH_RESULTS}).` },
          },
          required: ["query"],
        },
      },
    },
  },
  // Claude Code's own tool name. No `definition` — when we intercept a harness
  // tool we forward its own schema untouched, so the model sees exactly the
  // tool it was trained against and nothing about the prompt changes.
  WebSearch: { run: toolWebSearch },

  web_fetch: {
    run: toolWebFetch,
    definition: {
      type: "function",
      function: {
        name: "web_fetch",
        description: "Fetch a URL and return its main text content, with markup stripped.",
        parameters: {
          type: "object",
          properties: { url: { type: "string", description: "Absolute http(s) URL to fetch." } },
          required: ["url"],
        },
      },
    },
  },
};

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

  // Qwen 3.8's chat template raises "System message must be at the beginning" if any
  // system-role message appears after index 0. Anthropic carries the system prompt in a
  // top-level field, but a system-role turn can still reach us inside `messages`, and
  // emitting it inline puts one mid-conversation. Collect every piece of system content
  // up front and send exactly one, first — which is also what the OpenAI shape expects.
  const systemParts = [];
  if (systemText) systemParts.push(systemText);
  for (const msg of anthropicMessages || []) {
    if (msg.role !== "system") continue;
    const t = typeof msg.content === "string" ? msg.content
      : Array.isArray(msg.content) ? blocksToText(msg.content) : "";
    if (t) systemParts.push(t);
  }
  if (systemParts.length) out.push({ role: "system", content: systemParts.join("\n\n") });

  for (const msg of anthropicMessages || []) {
    if (msg.role === "system") continue;   // already hoisted above
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

/**
 * Anthropic server-side tools are identified by a dated `type`
 * (web_search_20260209, web_fetch_20250910, …) and carry no input_schema.
 * Client tools have a name and a schema, and at most `type: "custom"`.
 */
const isServerTool = (t) => typeof t.type === "string" && /_\d{8}$/.test(t.type);

function convertTools(tools, proxyTools) {
  if (!Array.isArray(tools) || !tools.length) return undefined;

  const out = [];
  for (const t of tools) {
    if (isServerTool(t)) {
      // These used to slip through — a server tool does have a `name`, so the
      // old `filter(t => t.name)` kept it and handed the model a parameterless
      // `web_search` whose calls went nowhere. Either we execute it here, or it
      // must not be offered at all.
      const handler = WEB_TOOLS ? PROXY_TOOLS[t.name] : null;
      if (handler) {
        proxyTools.add(t.name);
        out.push(handler.definition);
      } else {
        debug(`dropping server tool ${t.type} — nothing can execute it locally`);
      }
      continue;
    }
    if (!t.name) continue;

    // A harness tool we stand in for is still advertised with its own schema —
    // only the execution moves here, so the model cannot tell the difference.
    if (WEB_TOOLS && HARNESS_TOOLS.has(t.name) && PROXY_TOOLS[t.name]) {
      proxyTools.add(t.name);
      debug(`intercepting harness tool ${t.name}`);
    }

    out.push({
      type: "function",
      function: {
        name: t.name,
        description: t.description || "",
        parameters: t.input_schema || { type: "object", properties: {} },
      },
    });
  }
  return out.length ? out : undefined;
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
  const proxyTools = new Set(); // tool names this proxy executes itself
  const req = {
    model: MODEL,
    messages: convertMessages(body.messages, systemText),
    stream: !!body.stream,
  };
  if (body.max_tokens) req.max_tokens = body.max_tokens;
  if (typeof body.temperature === "number") req.temperature = body.temperature;
  if (typeof body.top_p === "number") req.top_p = body.top_p;
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length) req.stop = body.stop_sequences;

  const tools = convertTools(body.tools, proxyTools);
  if (tools) {
    req.tools = tools;
    const choice = convertToolChoice(body.tool_choice);
    if (choice) req.tool_choice = choice;
  }
  if (req.stream) req.stream_options = { include_usage: true };
  // Suppress the model's reasoning phase unless explicitly opted in.
  if (!THINK) req.chat_template_kwargs = { enable_thinking: false };
  return { req, proxyTools };
}

/* ------------------------------------------------------------------ */
/* Proxy-side tool execution                                            */
/* ------------------------------------------------------------------ */

async function callUpstream(oaiReq) {
  try {
    return await fetch(`${UPSTREAM}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(oaiReq),
    });
  } catch (e) {
    const err = new Error(`cannot reach llama-server at ${UPSTREAM} — is it running? (${e.message})`);
    err.status = 502;
    throw err;
  }
}

/**
 * Run the intercepted calls and extend the conversation with them, so the next
 * upstream round sees exactly what the real API would have shown the model:
 * its own tool call, then the result.
 */
async function runProxyCalls(calls, messages, assistantText) {
  messages.push({
    role: "assistant",
    content: assistantText || null,
    tool_calls: calls.map((c) => ({
      id: c.id,
      type: "function",
      function: { name: c.name, arguments: c.args || "{}" },
    })),
  });

  const done = [];
  for (const c of calls) {
    let input = {};
    try {
      input = JSON.parse(c.args || "{}");
    } catch {
      input = {};
    }
    log(`${c.name} ${JSON.stringify(input).slice(0, 200)}`);
    let result;
    try {
      result = await PROXY_TOOLS[c.name].run(input);
    } catch (e) {
      result = `ERROR: ${c.name} failed (${e.message}).`;
    }
    messages.push({ role: "tool", tool_call_id: c.id, content: result || "(no output)" });
    done.push({ name: c.name, input, result });
  }
  return done;
}

/** Once the hop budget is spent, stop offering the tools so the model answers. */
function dropProxyTools(oaiReq, proxyTools) {
  if (!oaiReq.tools) return;
  oaiReq.tools = oaiReq.tools.filter((t) => !proxyTools.has(t.function?.name));
  if (!oaiReq.tools.length) {
    delete oaiReq.tools;
    delete oaiReq.tool_choice;
  }
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
 *
 * One Anthropic message can span several upstream rounds. When the model calls
 * a proxy-executed tool we run it, extend the conversation and stream the next
 * round into the same message — the harness sees one continuous reply and never
 * learns a search happened, which is precisely how the server-side tools behave
 * against the real API. Tool calls are therefore buffered until a round ends:
 * only then do we know whether they are ours to run or the harness's to run.
 */
async function streamAnthropic(oaiReq, proxyTools, res, requestedModel) {
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
  let stopReason = "end_turn";
  let outputTokens = 0;
  let inputTokens = 0;
  let thinkingOpen = false;
  let thinkStart = 0;
  let thinkChunks = 0;
  let thinkLastTick = 0;

  // Idempotent: a block is stopped at most once, whatever path closes it.
  let blockOpen = false;
  const closeOpenBlock = () => {
    if (blockOpen) {
      // A native thinking block is signed before it closes. The signature is
      // normally Anthropic's proof the reasoning is unmodified; nothing
      // validates it here, and the harness only round-trips it back to us,
      // where convertMessages drops thinking blocks anyway.
      if (thinkingOpen && THINK_VIEW === "native") {
        emit("content_block_delta", {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "signature_delta", signature: `local-${randomUUID()}` },
        });
      }
      if (thinkingOpen && THINK_VIEW === "status") {
        const secs = Math.round((Date.now() - thinkStart) / 1000);
        emit("content_block_delta", {
          type: "content_block_delta",
          index: blockIndex,
          delta: {
            type: "text_delta",
            text: `\n_(thought for ${secs}s, ~${thinkChunks} chunks)_\n\n`,
          },
        });
      }
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

  for (let hop = 0; ; hop++) {
    // message_start is already on the wire, so a failure here cannot become an
    // HTTP error status — it has to be reported inside the stream instead.
    let upstream;
    try {
      upstream = await callUpstream(oaiReq);
    } catch (e) {
      log(e.message);
      if (!textOpen) {
        openBlock({ type: "text", text: "" });
        textOpen = true;
      }
      emit("content_block_delta", {
        type: "content_block_delta",
        index: blockIndex,
        delta: { type: "text_delta", text: `\n[proxy] ${e.message}` },
      });
      break;
    }

    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 400);
      log("upstream error", upstream.status, detail);
      if (!textOpen) {
        openBlock({ type: "text", text: "" });
        textOpen = true;
      }
      emit("content_block_delta", {
        type: "content_block_delta",
        index: blockIndex,
        delta: { type: "text_delta", text: `\n[proxy] upstream ${upstream.status}: ${detail}` },
      });
      break;
    }

    // Per-round buffers. OpenAI streams a tool call's name in its first chunk
    // and the arguments across later ones, so a call is only complete — and
    // only classifiable as ours or the harness's — once the round ends.
    const pending = new Map(); // upstream tool index -> { id, name, args }
    let hopText = "";
    let finish = null;
    let hopIn = 0;
    let hopOut = 0;

    const decoder = new TextDecoder();
    let buf = "";

    for await (const chunk of upstream.body) {
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
          hopIn = evt.usage.prompt_tokens ?? hopIn;
          hopOut = evt.usage.completion_tokens ?? hopOut;
        }

        const choice = evt.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta || {};

        // Reasoning arrives in its own field (--reasoning-format deepseek).
        if (THINK_VIEW !== "off" && delta.reasoning_content) {
          if (!thinkingOpen) {
            if (THINK_VIEW === "native") {
              openBlock({ type: "thinking", thinking: "" });
            } else {
              openBlock({ type: "text", text: "" });
              textOpen = true;
            }
            thinkingOpen = true;
            thinkStart = Date.now();
            thinkLastTick = thinkStart;
            thinkChunks = 0;
            if (THINK_VIEW === "text") {
              emit("content_block_delta", {
                type: "content_block_delta",
                index: blockIndex,
                delta: { type: "text_delta", text: "[thinking] " },
              });
            }
            if (THINK_VIEW === "status") {
              emit("content_block_delta", {
                type: "content_block_delta",
                index: blockIndex,
                delta: { type: "text_delta", text: "_thinking…_" },
              });
            }
          }
          thinkChunks++;

          if (THINK_VIEW === "native") {
            emit("content_block_delta", {
              type: "content_block_delta",
              index: blockIndex,
              delta: { type: "thinking_delta", thinking: delta.reasoning_content },
            });
          } else if (THINK_VIEW === "text") {
            emit("content_block_delta", {
              type: "content_block_delta",
              index: blockIndex,
              delta: { type: "text_delta", text: delta.reasoning_content },
            });
          } else if (Date.now() - thinkLastTick >= THINK_TICK_MS) {
            // status: a periodic tick, not the reasoning itself. Deltas append,
            // so this has to stay short or it becomes the very noise it replaces.
            thinkLastTick = Date.now();
            emit("content_block_delta", {
              type: "content_block_delta",
              index: blockIndex,
              delta: {
                type: "text_delta",
                text: ` ${Math.round((thinkLastTick - thinkStart) / 1000)}s…`,
              },
            });
          }
        }

        if (delta.content) {
          // A thinking block must be closed before the answer starts.
          if (thinkingOpen) closeOpenBlock();
          if (!textOpen) {
            openBlock({ type: "text", text: "" });
            textOpen = true;
          }
          hopText += delta.content;
          emit("content_block_delta", {
            type: "content_block_delta",
            index: blockIndex,
            delta: { type: "text_delta", text: delta.content },
          });
        }

        // Buffered, not emitted: see the note on this function.
        for (const tc of delta.tool_calls || []) {
          const idx = tc.index ?? 0;
          let call = pending.get(idx);
          if (!call) {
            call = { id: tc.id || `toolu_${randomUUID()}`, name: "", args: "" };
            pending.set(idx, call);
          }
          if (tc.id) call.id = tc.id;
          if (tc.function?.name) call.name += tc.function.name;
          if (tc.function?.arguments) call.args += tc.function.arguments;
        }

        if (choice.finish_reason) finish = choice.finish_reason;
      }
    }

    inputTokens = hopIn || inputTokens;
    outputTokens += hopOut;

    const calls = [...pending.values()];
    const ours = calls.filter((c) => proxyTools.has(c.name) && PROXY_TOOLS[c.name]);
    const theirs = calls.filter((c) => !(proxyTools.has(c.name) && PROXY_TOOLS[c.name]));

    // The clean case: the model only asked for things we can run. Execute them
    // and go round again, still inside the same Anthropic message.
    if (ours.length && !theirs.length && hop + 1 <= MAX_PROXY_HOPS) {
      closeOpenBlock();
      await runProxyCalls(ours, oaiReq.messages, hopText);
      if (hop + 1 === MAX_PROXY_HOPS) {
        log(`web tool budget (${MAX_PROXY_HOPS} rounds) spent — answering without them`);
        dropProxyTools(oaiReq, proxyTools);
      }
      continue;
    }

    // Otherwise the harness has tools of its own to run, so the turn has to end
    // here. Anything we ran still gets surfaced as text rather than dropped —
    // the harness round-trips assistant text, so the model sees it next turn.
    if (ours.length) {
      const done = await runProxyCalls(ours, oaiReq.messages, hopText);
      if (!textOpen) {
        openBlock({ type: "text", text: "" });
        textOpen = true;
      }
      for (const d of done) {
        emit("content_block_delta", {
          type: "content_block_delta",
          index: blockIndex,
          delta: {
            type: "text_delta",
            text: `\n\n[${d.name} ${JSON.stringify(d.input)}]\n${d.result}\n`,
          },
        });
      }
    }

    for (const c of theirs) {
      openBlock({ type: "tool_use", id: c.id, name: c.name || "unknown", input: {} });
      if (c.args) {
        emit("content_block_delta", {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "input_json_delta", partial_json: c.args },
        });
      }
    }

    stopReason = theirs.length ? "tool_use" : STOP_REASON[finish] || "end_turn";
    break;
  }

  clearInterval(heartbeat);
  // A turn that produced nothing visible (e.g. max_tokens spent entirely on the
  // reasoning phase) still owes the harness at least one content block.
  if (blockIndex === -1) openBlock({ type: "text", text: "" });
  closeOpenBlock();
  emit("message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  });
  emit("message_stop", { type: "message_stop" });
  res.end();
}

/** Same hop loop as the streaming path, for non-streaming requests. */
async function blockingAnthropic(oaiReq, proxyTools, requestedModel) {
  let inputTokens = 0;
  let outputTokens = 0;
  const ranHere = [];

  for (let hop = 0; ; hop++) {
    const upstream = await callUpstream(oaiReq);
    if (!upstream.ok) {
      const err = new Error(`upstream ${upstream.status}: ${(await upstream.text()).slice(0, 800)}`);
      err.status = upstream.status;
      throw err;
    }

    const oai = await upstream.json();
    inputTokens = oai.usage?.prompt_tokens ?? inputTokens;
    outputTokens += oai.usage?.completion_tokens ?? 0;

    const msg = oai.choices?.[0]?.message || {};
    const calls = (msg.tool_calls || []).map((tc) => ({
      id: tc.id || `toolu_${randomUUID()}`,
      name: tc.function?.name || "",
      args: tc.function?.arguments || "",
    }));
    const ours = calls.filter((c) => proxyTools.has(c.name) && PROXY_TOOLS[c.name]);
    const theirs = calls.filter((c) => !(proxyTools.has(c.name) && PROXY_TOOLS[c.name]));

    if (ours.length && !theirs.length && hop + 1 <= MAX_PROXY_HOPS) {
      await runProxyCalls(ours, oaiReq.messages, msg.content || "");
      if (hop + 1 === MAX_PROXY_HOPS) dropProxyTools(oaiReq, proxyTools);
      continue;
    }
    if (ours.length) {
      const done = await runProxyCalls(ours, oaiReq.messages, msg.content || "");
      for (const d of done) ranHere.push(`[${d.name} ${JSON.stringify(d.input)}]\n${d.result}`);
    }

    const out = toAnthropicResponse(oai, requestedModel);
    // Our own tool calls must never reach the harness — it has no such tools.
    out.content = out.content.filter(
      (b) => !(b.type === "tool_use" && proxyTools.has(b.name) && PROXY_TOOLS[b.name]),
    );
    if (ranHere.length) out.content.push({ type: "text", text: ranHere.join("\n\n") });
    if (!out.content.length) out.content.push({ type: "text", text: "" });
    out.stop_reason = theirs.length ? "tool_use" : out.stop_reason === "tool_use" ? "end_turn" : out.stop_reason;
    out.usage = { input_tokens: inputTokens, output_tokens: outputTokens };
    return out;
  }
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

  const { req: oaiReq, proxyTools } = toOpenAIRequest(body);
  debug(
    `${body.model} -> ${MODEL}  msgs=${oaiReq.messages.length} tools=${oaiReq.tools?.length ?? 0}` +
      ` proxy_tools=${[...proxyTools].join(",") || "none"} stream=${oaiReq.stream}`,
  );

  // Note the handler shadows `path` with the request path, so no node:path here.
  // Wrapped: a debug aid must never be able to take the whole proxy down, and an
  // unhandled throw in this async handler would do exactly that.
  if (DUMP_DIR) {
    const f = `${DUMP_DIR}/req-${Date.now()}-${randomUUID().slice(0, 8)}.json`;
    try {
      fs.writeFileSync(f, JSON.stringify(oaiReq, null, 2));
      log(`dumped request -> ${f}`);
    } catch (e) {
      log(`could not write dump ${f}: ${e.message}`);
    }
  }

  try {
    if (oaiReq.stream) {
      await streamAnthropic(oaiReq, proxyTools, res, body.model);
    } else {
      sendJSON(res, 200, await blockingAnthropic(oaiReq, proxyTools, body.model));
    }
  } catch (e) {
    if (e.status) log("upstream error", e.status, e.message);
    else log("translation failed:", e.stack || e.message);
    if (!res.headersSent) anthropicError(res, e.status || 500, e.status ? e.message : `proxy error: ${e.message}`);
    else res.end();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  log(`listening on http://127.0.0.1:${PORT}  ->  ${UPSTREAM}  (model: ${MODEL})`);
  log(`point a harness at it:  ANTHROPIC_BASE_URL=http://127.0.0.1:${PORT}`);
});
