# New-model integration playbook

What to do when a new local model drops (e.g. Qwen4 27B) and you want it serving
Claude Code on this machine (M5 Pro, 64 GB). Every rule below was paid for with a
measurement, an OOM, or a kernel panic.

## What we optimize for (in order)

1. **Warm multi-turn latency under real Claude Code** — follow-ups in seconds, not
   re-prefills. A model that decodes 2× faster but re-prefills 20k tokens every turn loses.
2. **No crashes** — kernel panics and silent OOMs disqualify a config outright.
3. **Quality** — prefer the largest quant *that still meets 1 and 2*.
4. **Speculative decoding working** — ~1.5–3× decode when acceptance is high.

## Step 0 — Identify the architecture first

**Pure attention, or hybrid/recurrent** (GatedDeltaNet/Mamba/SSM layers)? Check the HF
config (`layer_types`, `linear_attention`, `gdn`, `mamba`) or range-fetch the GGUF header.

- **Pure attention / MoE:** easy mode. llama.cpp's slot cache just works and
  strict-prefix appends are free. MoE decodes disproportionately fast per GB, so test
  a MoE variant first if one exists.
- **Hybrid/recurrent** (like Qwen 3.8 27B): the recurrent state cannot be rolled back,
  so cache warmth depends entirely on engine checkpoint support. Everything below applies.

## Step 1 — Update the engines before judging anything

Verdicts go stale in weeks. `brew upgrade llama.cpp` (hybrid checkpoint restore went
from 0/29 warm hits to 11/11 between builds with no config change) and update LM Studio
and its runtimes (`lms runtime get …`). A "can't cache" conclusion from an old build
is worthless.

## Step 2 — Download the minimum gate set

- **GGUF:** unsloth first (inline MTP/nextn head, no sidecar), one mid quant as the
  gate. Verify the MTP head exists before big downloads: range-fetch the first ~20 MB
  and grep tensor names for `nextn`.
- **LM Studio engine builds** (e.g. Splash): check hardware/OS requirements; download
  with the full HF URL (`lms get https://huggingface.co/<org>/<repo>`).

Gate each engine with a 5-minute smoke before downloading the full quant ladder. Wire
new aliases into `scripts/llm-serve` (`MODEL_ALIASES`, `model_key`; it is LM Studio-only
since the GGUF/llama.cpp path was removed on 2026-10-01 — restore it from git history
for a llama.cpp model), `scripts/qwen-cli`, and the `claude()` dispatcher in
`dotfiles/zshrc_snippet`. Take sampling params (temp/top-p) from the model card —
serving at another model's temp is a silent quality bug. If LM Studio drops a request
field the template needs (as with `reasoning_effort`), add a virtual model under
`dotfiles/lmstudio/`.

## Step 3 — Test through real Claude Code sessions

Synthetic single-request replays lie: Claude Code issues several requests per turn,
mutates the system prompt mid-session, and interleaves requests.

- `./scripts/qwen-code --dangerously-skip-permissions -p "<q>"` for turn 1, `-c -p` for
  continuations, `</dev/null`, capture stdout/err per turn.
- Read warmth from the **server** log, not wall clock: llama.cpp `restored context
  checkpoint` / `f_keep`; LM Studio `Done · input N · cached M`.
- A 12–15 turn session with zero panics is the stability bar.
- **Depth ladder:** ~120 KB text files with planted unique facts; turn N reads file N
  and answers the planted question. Verifies recall, not just survival, toward the
  window limit.

## Step 4 — Watch the right memory signal

- **llama.cpp:** KV is preallocated at load (`-c` × per-token KV), so wired memory is
  flat and RSS tracks depth. Budget weights + KV + ~3 GB system against
  `sysctl iogpu.wired_limit_mb`. `--cache-ram` caps how large a slot state can be
  *saved*; the 8 GB default silently discards deep states (`exceeds cache size limit
  ... skipping`) — size it explicitly.
- **LM Studio:** weights may be mapped from disk, so wired stays low; watch `vm_stat`.
- Failures are silent in Claude Code: an OOM'd request looks like a normal empty turn.
  Grep the server log for `kIOGPUCommandBufferCallbackErrorOutOfMemory`.

## Step 5 — Safety rails

- Baseline before GPU work: count of `/Library/Logs/DiagnosticReports/panic-full-*`,
  `sysctl kern.boottime`, `uptime`. Re-check after every arm. An uptime reset without a
  panic file can be a battery death — check `pmset -g log`.
- Plugged in; `caffeinate -is` for unattended runs.
- One model server at a time. A forgotten `claude -p` serializes on the single slot.
- Write findings to disk after every turn so a panic loses nothing.
- The panic class seen here (`IOGPUMemory.cpp:550`, `IOGPUGroupMemory.cpp:528`) is an
  Apple driver assert reached by large transient GPU allocations near the wired limit.
  Graceful OOMs at a smaller quant are the warning shot for a panic at a bigger one.

## Step 6 — Known traps

- **Proxy quirks** (`llm-proxy.mjs` handles these; verify they still apply): volatile
  prompt blocks (`<total_tokens>`, the task-tools nudge) must be stripped; a second
  system-role message must be hoisted for strict templates; SSE heartbeats + both
  idle-timeout env vars, or long prefills look like dead connections.
- **Context cap:** `CLAUDE_CODE_MAX_CONTEXT_TOKENS` is in *estimated* tokens (chars/3.5,
  overshoots real). Too low (<65536) blocks session start; set it so compaction fires
  below the measured OOM/recall ceiling.
- **Drafters:** confirm speculative decoding is enabled in the log, that the cache
  still works with it, and that acceptance is healthy per quant. Log acceptance %.
- **Quantized KV:** has historically corrupted context and truncated streaming tool
  calls; verify planted-fact recall before adopting it.
- **Reasoning effort:** confirm the effort field actually reaches the template (it
  silently didn't on LM Studio until the virtual model).

## Step 7 — Grade quality last

Only after speed/safety prune the field. Same questions across quants, biggest quant as
reference, judged via agy. n=1 at temp 1.0 has variance larger than the quant effect —
only act on big gaps or mechanical failures. A quant that spends 50%+ of its budget
reasoning delivers thin answers at real latency cost.

## Step 8 — Adopt, document, leave it clean

- The winner's config becomes `llm-serve` defaults (env-overridable). Update README §5,
  `LOCAL_LLM_HARNESS.md` §3, and the `local-llm` plugin docs.
- Final acceptance: a real Claude Code session where trivial warm follow-ups land in
  ~2–5 s.
- Commit; engines stopped; one `llm-serve start <alias>` from working.

## Current reference numbers (2026-09, for calibration)

| Config | Warm follow-up | Decode | Deepest verified recall |
|---|---|---|---|
| splash4 (LM Studio Splash, DFlash2) | **1–2 s** (97–99% cached) | 35–84 t/s | **227,078** tokens (stopped at 44.8 GB wired) |
| gguf5 (llama.cpp, MTP n=2; removed 2026-10-01) | ~8 s | ~13–20 t/s | 158,766 tokens |

A new model should beat the relevant row or it isn't worth switching.
