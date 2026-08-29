# New-model integration playbook

What to do when a new local model drops (e.g. Qwen4 27B) and you want it serving
Claude Code on this machine (M5 Pro, 64 GB). Distilled from the Qwen 3.6/3.8
campaigns (Aug 2026); every rule below was paid for with a measurement, an OOM,
or a kernel panic. Companion data: `local_llm_bench/results/vacation-run/`.

## What we optimize for (in order)

1. **Warm multi-turn latency under real Claude Code** — follow-ups in seconds,
   not re-prefills. This dominates everything; a model that decodes 2× faster
   but re-prefills 20k tokens every turn loses.
2. **No crashes** — kernel panics and silent OOMs disqualify a config outright.
3. **Quality** — prefer the largest quant *that still meets 1 and 2*. History:
   the 8>6>4 preference gets overruled by measurement more often than not.
4. **MTP/speculative decode working** — ~1.5–3× decode when acceptance is high.

## Step 0 — Identify the architecture FIRST

Everything branches on one question: **pure attention, or hybrid/recurrent**
(GatedDeltaNet/Mamba/SSM layers)? Check the HF config (`layer_types`,
`linear_attention`, `gdn`, `mamba`) or range-fetch the GGUF header.

- **Pure attention / MoE** (like Qwen 3.6 35B A3B): easy mode. llama.cpp's
  in-place slot cache just works; strict-prefix appends are free; expect
  2-second follow-ups with zero patches. Start with llama.cpp.
- **Hybrid/recurrent** (like Qwen 3.8 27B): the recurrent state cannot be
  rolled back to an earlier token. Cache warmth then depends entirely on
  engine checkpoint support, and this file's remaining steps apply in full.

Also note: MoE decodes disproportionately fast per GB (35B A3B: 67 t/s vs
dense 27B: 13–26 t/s). If a new MoE variant exists, test it first — it will
probably win the daily-driver slot on latency alone.

## Step 1 — Update the engines before judging anything

Both engines move fast and verdicts go stale in WEEKS:

- `brew upgrade llama.cpp` — hybrid checkpoint restore went from 0/29 warm
  hits (b9620, June) to 11/11 warm (b10621, Aug) with no config change.
  A "GGUF can't cache" conclusion from an old build is worthless.
- mlx / mlx-vlm: new venv per version (`local_llm_bench/.mlxenv-<ver>`), never
  mutate the working one. Re-apply local patches with
  `LLM_MLX_VENV=<new venv> apply-latest-only-patch && apply-single-clone-patch`
  — both are string-matched and will refuse loudly if upstream changed the
  code; check whether upstream merged their equivalents first
  (mlx-vlm PR #2072 = single-clone; also recheck the kv-bits streaming bug
  and llama.cpp PR #25592 status).

## Step 2 — Download the minimum gate set, not everything

From the new model's repos (order of preference learned here):

- **GGUF**: unsloth first (inline MTP/nextn head — no sidecar needed), one
  mid quant (UD-Q4_K_XL-equivalent) as the gate. ggml-org as cross-uploader
  control later; its MTP ships as separate `mtp-*.gguf` sidecars.
- **MLX**: mlx-community 4-bit as the gate + the matching MTP drafter repo
  (a separate ~0.5 GB checkpoint; held at 8-bit regardless of target quant).
- Verify the MTP head exists before committing to big downloads: range-fetch
  the first ~20 MB of the GGUF and grep tensor names for `nextn`.

Gate each engine with a 5-minute smoke before downloading the full quant
ladder. Wire new aliases into `scripts/llm-serve` (model_path/engine/family/
temp/draft_n cases) — check the new model's recommended sampling params
(temp/top-p) from its model card; serving a model at another model's temp is
a silent quality bug.

## Step 3 — Test through REAL Claude Code sessions, nothing else

The single most important lesson. Synthetic single-request replays lie:
Claude Code issues several requests per turn (tool calls, background recaps),
mutates the system prompt mid-session, and interleaves requests — that access
pattern is what kills caches. Method:

- `./scripts/qwen-code --dangerously-skip-permissions -p "<q>"` for turn 1,
  `-c -p` for continuations, `</dev/null`, capture stdout/err per turn.
- Warmth is read from the SERVER log, not wall clock:
  - mlx_vlm: `Prefill completed ... cached_tokens=N` (warm when ≈ prompt);
    `/v1/cache/stats` for exact_hits / token_hit_rate.
  - llama.cpp: `restored context checkpoint` and `f_keep` fractions.
- A 12-turn session (`scripts/llm-bench-turns`) is the standard arm; 15 turns
  with zero panics was the historical stability bar.
- Depth ladder: generate ~120 KB text files with planted unique facts; turn N
  reads file N and answers the planted question — verifies recall, not just
  survival, as context climbs toward the window limit.

## Step 4 — Watch the RIGHT memory signal per engine

- **MLX**: `ps` RSS is BLIND (weights are mmap'd, Metal buffers invisible).
  Watch `vm_stat` wired pages. OOMs/panics begin where wired crosses
  `sysctl iogpu.wired_limit_mb` (50 GB here). Transient prefill/store
  allocations dominate (~280 KB/token observed), not resident state.
- **llama.cpp**: inverted. KV is preallocated at load (`-c` × ~64 KB/token
  for this arch class) so wired is FLAT; RSS tracks depth. `-c` is a real
  memory dial — budget weights + KV + ~3 GB system against the wired limit.
  `--cache-ram` (host RAM) caps how large a slot state can be SAVED
  (~103 KB/token here); the 8 GB default silently discards deep states
  (`exceeds cache size limit ... skipping` in the log) — size it explicitly.
- Failures are SILENT in Claude Code: an OOM'd request comes back as a
  normal-looking empty turn (no error, `stop_reason=end_turn`). Grep the
  server log for `kIOGPUCommandBufferCallbackErrorOutOfMemory`; never trust
  the client's happy exit code.

## Step 5 — Safety rails (a panic costs a day; these are cheap)

- Baseline before any GPU work: `ls /Library/Logs/DiagnosticReports/panic-full-*`
  count + `sysctl kern.boottime` + `uptime`. Re-check after every arm. An
  uptime reset without a new panic file can be a battery death — check
  `pmset -g log` before blaming the workload (it happened here).
- Machine plugged in; `caffeinate -is` for unattended runs.
- One model server at a time, ever. A forgotten `claude -p` serializes on the
  single slot and wrecks both latency and measurements.
- Write findings to disk INCREMENTALLY (append after every turn) so a panic
  loses nothing. Commit + push before risky arms.
- The panic class seen here: `IOGPUMemory.cpp:550` / `IOGPUGroupMemory.cpp:528`
  — an Apple driver assert reached by large transient GPU allocations near the
  wired limit. Graceful OOM errors at a smaller quant are the warning shot for
  a panic at a bigger one.

## Step 6 — The known traps checklist

- **Proxy quirks** (`llm-proxy.mjs` handles these; verify they still apply):
  Claude Code's volatile prompt blocks (`<total_tokens>`, the task-tools
  nudge) must be stripped or every ~5th request cold-prefills; a second
  system-role message must be hoisted for strict Jinja templates; SSE
  heartbeats + both idle-timeout env vars (chunk watchdog min 300 s, byte max
  1800 s) or long prefills look like dead connections.
- **Context caps**: `CLAUDE_CODE_MAX_CONTEXT_TOKENS` is in ESTIMATED tokens
  (chars/3.5, overshoots real by ~1.5–2×). Too low blocks session start
  ("Prompt is too long" with zero server requests); set it so compaction
  fires below the measured OOM/quality ceiling (mlx4 today: 81920 est).
- **Drafter interactions**: verify "speculative decoding enabled" in the log
  AND that the cache still works with it (DFlash2 silently zeroed APC), AND
  that acceptance is healthy per quant (MTP on a 6-bit MLX target decoded
  SLOWER than no drafter). Log acceptance %, don't assume.
- **kv-bits / quantized KV on MLX**: check upstream bug status before using;
  historically corrupted context and truncated streaming tool calls.
- **thinking/effort**: `--enable-thinking` must be explicit on mlx_vlm (the
  chat template silently disables reasoning otherwise); reasoning effort
  defaults matter (`LLM_EFFORT=medium` here — xhigh burns a minute per turn).
- **Verify planted-fact recall at depth**, not just non-crashing — quantized
  KV once passed every latency check while losing the prompt content.

## Step 7 — Grade quality LAST, and cheaply

Only after speed/safety prune the field (they usually leave 1–2 candidates).
Low-ctx, cache and drafter off (the stable path), same 6 questions across
quants, judge via agy against `local_llm_bench/RUBRIC.md` with the biggest
quant as reference. n=1 at temp 1.0 has sampling variance larger than the
quant effect — treat scores as a weak prior and only act on big gaps or
mechanical failures. Watch the thinking-budget share: a quant that spends
50%+ of its budget reasoning delivers thin answers at real latency cost.

## Step 8 — Adopt, document, leave it clean

- Winner's config becomes `llm-serve` defaults (env-overridable, never
  hand-passed flags). Update `LOCAL_LLM_HARNESS.md` §3, the memory file
  (`local-llm-qwen38-stack` or successor), and the results STATUS table.
- Final acceptance test is the user's own bar: a real Claude Code session
  where trivial warm follow-ups land in ~2–5 s. If that fails, the
  integration is not done, whatever the benchmarks say.
- Commit + push both repos; engines stopped; one `llm-serve start <alias>`
  from working.

## Current reference numbers (Aug 2026, for calibration)

| Config | Warm follow-up | Decode | Ceiling |
|---|---|---|---|
| qwen3.6-35b (GGUF Q8, MTP n=1) | ~2 s | 67 t/s | 262k native |
| qwen3.8-27b mlx4 (MTP, APC=2, patches) | 2–4 s | 21–26 t/s | healthy ~58k, OOM 80k |
| qwen3.8-27b gguf4 (b10621, MTP n=2) | 8 s | ~13–20 t/s | TBD (STRESS-GGUF.md) |

A new model should beat the relevant row here or it isn't worth switching.
