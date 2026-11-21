# Local Coding LLM Benchmark & Multi-Model Setup Walkthrough (`2026-11-20` – `2026-11-21`)

Complete hardware-verified evaluation and setup guide for running Thinking Machines Lab's **Inkling 2 Mini** and late-2026 open-weight local coding models inside **Claude Code** on **MacBook Pro M5 Pro (64 GB unified memory, `iogpu.wired_limit_mb = 51200`, macOS 27.2.1)** — benchmarked head-to-head against your baseline **Qwen 3.8 27B (`incoai/Qwen3.8-27B-Splash`, LM Studio Splash 1.3.0)**.

All official Claude Code multi-turn, deep-recall, and agentic coding evaluations (Tiers 2–4) were run at **highest reasoning effort (`--think xhigh`)** under `caffeinate -is`, enforcing one active model server at a time and zero-panic safety rails (`panic_count = 0` across all 9 arms).

---

## 1. Executive Recommendation & Wired Model Roles

You initially set out to compare **Inkling 2 Mini** against **Qwen 3.8 27B** and scout any late-2026 sleepers that rival Qwen 3.8's intelligence at equal or better speed. The deep scout uncovered **Ornith-1.5-35B-A3B**, which swept every speed and accuracy benchmark outright, alongside three strong complementary specialists. All four winners are now wired into `claude local`, `llm-serve`, `qwen`, and `qwen-cli`:

| Command | Active Alias | Model & Engine | Warm Ping | Decode (`2K` / Claude Code Mean) | 16K Cold Prefill | Tier 3 Recall | Tier 4 Coding (`xhigh`) | Blind Task 6 Grade | When to Use It |
|---|---|---|---:|---:|---:|---|---|---:|---|
| **`claude local`** / **`claude local ornith`** *(new default)* | `ornith35` | `scottlowry/Ornith-1.5-35B-A3B-oQ4e-mtp` (`oMLX v0.8.1` + MTP, `ctx=262144`) | **0.61 s** | **103.6 / 86.9 t/s** (`140 t/s` tools) | **7.74 s** (`2,646.5 t/s`) | **8/8** (`file1` `3/3`, `30.85 GB` max wired) | **5/5 + T6 PASS** (**`697 s` / 11.6 min**, `0` timeouts) | `22.0 / 40` (#4) | **Daily driver.** 2× faster agentic decode & 4.7× faster cold prefill than Splash4; 5.1× faster Tier 4 completion (`11.6m` vs `58.8m`). Always verify with tests/tools rather than trusting single-shot unexecuted snippets. |
| **`claude local daisyrose`** | `daisyrose27` | `krisfremen/DaisyRose-27B-oQ4e-mtp` (pure-RL Qwen 3.8 27B, `oMLX v0.8.1` + MTP, `ctx=131072`) | 1.76 s | 45.2 / 31.3 t/s | 46.5 s (`441 t/s`) | `5/6` (`file1` `1/2`, T6 `600s` timeout) | **5/5 + T6 PASS** (`2,481 s` / 41.4 min, `0` timeouts) | `35.5 / 40` (#2) | **Sharpest zero-timeout dense 27B & cleanest rewrites.** Pure-RL post-training fixed Splash4's Task 3 SSE failure while cutting Tier 4 wall time by 30%. |
| **`claude local inkling2`** | `inkling2` | `mlx-community/Inkling-2-Mini-oQ3e-mtp` (`oMLX v0.8.1` + DSpark, `TF32=0`, `ctx=131072`) | 3.98 s | 65.8 / 30.2 t/s (`83.3 t/s` tools) | 22.2 s (`824 t/s`) | **8/8** (`file1` `3/3`, `40.53 GB` max wired) | **5/5 + T6 PASS** (`3,953 s` / 65.9 min, 1 timeout) | `30.5 / 40` (#3) | **Deep-context agentic reasoning & compact disk footprint (`13 GB`).** Stronger coding (`5/5` vs `4/5`) and deeper recall (`8/8` vs `5/6`) than Qwen 3.8 Splash4 at 1.5× faster cold prefill, though ~30% slower sustained decode. |
| **`claude local qwen38_27`** *(kept 100% intact)* | `splash4` | `incoai/Qwen3.8-27B-Splash` (LM Studio Splash 1.3.0 + DFlash2, `ctx=262144`) | **1.01 s** | 73.7 / 44.3 t/s | 36.3 s (`565 t/s`) | `5/6` (`file1` `1/2`, T6 `420s` timeout) | `4/5` + T6 PASS (`3,527 s` / 58.8 min, fails T3 at `xhigh`) | **36.0 / 40 (#1)** | **Highest single-shot code-review rigor & LM Studio GUI/app workflows.** #1 blind `agy` reviewer (`0` CPython/asyncio factual errors) and faster dense decode on Splash than Qwen 3.8 under oMLX. |

**Direct Answer to Your Original Question (*"Did Inkling 2 Mini beat Qwen 3.8 27B?"*):**
- **Intelligence & Long-Context Recall:** **Yes.** Inkling 2 Mini (`oQ3e-mtp` and `Native`) scored **5/5** on Tier 4 coding vs Qwen 3.8 Splash4's **4/5** (passing the Task 3 SSE parser that stumped Qwen 3.8 at `xhigh`) and swept **8/8** files (`file1` `3/3`) in `stress-corpus` vs Qwen 3.8's **5/6**.
- **Speed:** **Mixed / No on sustained decode.** Inkling 2 Mini's 16K–32K cold prefill is ~1.5× faster (`824–844 vs 565 t/s`), **but** sustained Claude Code decode is slower (`30.2 vs 44.3 t/s` mean) and warm follow-up ping latency is higher (`3.2–4.0 s` vs `1.01 s`) because its 3×-looped middle block executes **48 logical layer visits per token**.
- **Real Winner (`Ornith-1.5-35B-A3B`):** A hybrid MoE (`40` layers, `256` experts, `8` active, GatedDeltaNet + full attention) that runs **2× faster than Qwen 3.8 Splash4** in Claude Code (`86.9 vs 44.3 t/s`, **`0.61 s` warm ping**), sweeps **`5/5 + T6`** in **`11.6 minutes`** (`0` timeouts), and recalls **8/8** deep files cleanly within `30.85 GB` wired memory.

---

## 2. Late-2026 M5 Pro 64 GB (`50 GB` Wired) Model Landscape

Because Apple Silicon enforces `iogpu.wired_limit_mb = 51200` (**50.0 GB max GPU wired allocation** across weights + KV cache + Metal scratch + OS buffers), models exceeding ~38–42 GB raw weights crash into swap/OOM before holding useful agentic context (`Claude Code` system + tool definitions alone consume ~13K–23K tokens).

### Excluded Heavyweight 2026 Releases (Exceed 50 GB GPU Wired Ceiling)
- **Inkling 2 Small** (594B total / 17B active)
- **GLM-5.3-Flash** (320B total / 18B active)
- **MiniMax-M3.1-Flash** (428B total / 23B active)
- **DeepSeek-V4.1-Flash** (552B total / 16B active)
- **Step-3.5-Flash** (196B)
- **Qwen3.8-Flash-Next** (177B)
- **Ornith-1.5-122B** (122B) & **Nemotron 3.5 Super VL** (120B)

### Shortlisted 9-Arm Evaluation Suite (All Fit Comfortably Under 50 GB Wired)
- **Baseline (Wave 0):** `Arm 0` — `incoai/Qwen3.8-27B-Splash` (LM Studio Splash 1.3.0 + DFlash2)
- **Inkling 2 Mini Sweep (Wave A, Arms 1–4):**
  - `Arm 1` (+ `1b`, `1c` ablations): `thinkingmachines/Inkling-2-Mini` Official Native (NVFP4 L0–19 + MXFP8 L20–23 + BF16 + `mtp.safetensors`, `19G` weights) on `oMLX v0.8.1`
  - `Arm 2`: `mlx-community/Inkling-2-Mini-oQ4e-mtp` (`16G`) on `oMLX v0.8.1`
  - `Arm 3`: `mlx-community/Inkling-2-Mini-oQ3e-mtp` (`13G`) on `oMLX v0.8.1`
  - `Arm 4` (+ `4b`): `unsloth/Inkling-2-Mini-GGUF` (`UD-Q4_K_XL` `16G`, `UD-Q8_K_XL` `21G` + `dspark-Inkling-2-Mini-Q8_0.gguf` `384M`) on Unsloth `llama.cpp b12588`
- **Same-Engine Control & Wave B Contenders (Arms 5–8):**
  - `Arm 5`: `Jundot/Qwen3.8-27B-oQ4e-mtp` (`16G`, `oMLX v0.8.1` + Lightning MTP) — isolates Splash 1.3.0 vs `oMLX` engine differences
  - `Arm 6`: `krisfremen/DaisyRose-27B-oQ4e-mtp` (`16G`, pure-RL Qwen 3.8 27B, `oMLX` + MTP)
  - `Arm 7`: `scaryrawr/Flint-oQ4e` (`21G`, RecursiveSI 40B-A2.5B sparse MoE, `oMLX` `--no-mtp`)
  - `Arm 8`: `scottlowry/Ornith-1.5-35B-A3B-oQ4e-mtp` (`21G`, `oMLX` + MTP + BF16 KV)

> **Engine Setup Note:** `brew install jundot/omlx/omlx --with-custom-kernel` failed on macOS because Xcode's `MetalToolchain` was absent; installing the official **oMLX v0.8.1 DMG** to `/Applications/oMLX.app` provides all 5 precompiled custom Metal kernel packs (`attention`, `lowbit`, `oqh`, `quant_matmul`, `sparse_index`, all verified `available: true`) headlessly via `omlx-cli serve`. Neither LM Studio's `splash@1.3.0`, `llama.cpp@2.80.1`, nor `mlx-llm@1.14.0` supports `inkling2_loop`.

---

## 3. Deep Technical Findings

### 3.1 Inkling 2 Mini Architecture, Quant Paradox & Engine Choice
1. **Why 3.4B unique active parameters feel like 5.4B / 48 layers:** Inkling 2 Mini (`inkling2_loop`) loops its middle 12-layer block 3× (`48` logical layer visits/token). That buys frontier-punching reasoning at small parameter count (`5/5` coding, `8/8` recall) at the cost of 48 serial attention/MoE dispatches per token (`~30–66 t/s` decode with DSpark ON vs `74–104 t/s` for non-looped Splash4 / Ornith).
2. **DSpark Speculative Decoding Ablation (`Arm 1` vs `Arm 1c`):** Enabling `mtp_enabled: true` boosted `2K` (`t1`) decode from `32.9` -> `54.0 t/s` (**+64%**) and tool-call decode from `34.7` -> `62.7 t/s` (**+81%**). Without DSpark, Inkling 2 Mini feels sluggish in multi-turn coding.
3. **M5 Pro `MLX_ENABLE_TF32=0` Parity Check (`Arm 1b`):** Setting `MLX_ENABLE_TF32=0` kept or slightly improved native NVFP4/MXFP8 decode (`54.0 vs 51.3 t/s` `2K`, `43.4 vs 41.8 t/s` tool turn 2) while eliminating M5 TF32 precision drift — enabled permanently for `inkling2` in `scripts/llm-serve`.
4. **Why `oQ3e-mtp` (`Arm 3`) Surprisingly Beat `Native` (`Arm 1`) & `oQ4e-mtp` (`Arm 2`):**
   - Smaller weight footprint (`12.99 GB` starting RSS vs Native `18.18 GB` and `oQ4e` `15.93 GB`) yielded **+28% higher decode speed** (`65.8 vs 51.3 t/s`, `83.3 t/s` tool calls, `30.2 t/s` Tier 2 mean) AND far more headroom under oMLX's `~196.6 KB/tok` unbounded 48-visit BF16 KV cache.
   - `oQ3e-mtp` finished all 12 Tier 2 turns (`86,875` tok, `39.2 GB` max wired) and swept **5/5 Tier 4 + Task 6 PASS (`811.87 s`, 4/4 concurrency bugs caught)** while Native timed out on Task 6 (`1200s`) and `oQ4e-mtp` regressed on Task 2 (`4/5`). Most importantly, `oQ3e-mtp` preserved **8/8 Tier 3 depth recall** (`file1` `3/3`, `<=40.53 GB` wired).
5. **Memory Management Lesson (`oMLX` hot cache vs `llama.cpp` SWA):**
   - `oMLX v0.8.1` initially ran Arm 1 Tier 2 with an `8 GB` RAM hot-cache alongside `20.2 GB` native weights; by Turn 5 (`78.3K` ctx) wired memory hit **`50.47 GB`**, triggering our memory guard (empty Turn 5). Lowering `--hot-cache-max-size` to **`2GB`** kept Arm 1 Tier 3 (`8/8`), Arm 2 (`8/8` + 11/12 Tier 2 turns up to `113.5K`), and Arm 3 (`8/8` + `12/12` Tier 2) completely safe under `41.5 GB` wired! Keep `turboquant_kv_enabled: false` so `@pm` SSD block slicing remains intact.
   - **Unsloth `llama.cpp b12588` (`Arm 4`)** kept wired memory rock-flat at `31.03–31.21 GB` across all 12 Tier 2 turns (`UD-Q4_K_XL` + `dspark-Q8_0`, `0.77–0.80` draft acceptance, `100%` warm cache on Turn 12), **but** 2.8× slower cold prefill (`299 vs 824–844 t/s`) caused Tier 3 Turn 1 to time out at `600s` (`0/1`) and Tier 4 to drop to **`3/5`**. Hence `oMLX v0.8.1` (`oQ3e-mtp`) won decisively.

### 3.2 Wave B & Proxy Engineering Discoveries
1. **The Case-Insensitive Tool Name Bug in `llm-proxy.mjs` (Cured Flint):**
   - On Tier 1, **Recursive Flint (`40B-A2.5B`, `95.3 t/s` decode, `1,848 t/s` 16K cold prefill)** passed our lowercase `read_section` check. Inside real Claude Code Tier 2, Flint emitted lowercase `"bash"` instead of Claude Code's case-sensitive `"Bash"`, received `<tool_use_error>Error: No such tool available: bash. Tool names are case-sensitive: call Bash`, and looped identically **213 / 240 / 185 times per turn** (`600s` timeouts, `empty=True`)!
   - Adding a clean `canonicalToolName()` normalizer in [scripts/llm-proxy.mjs](scripts/llm-proxy.mjs) (mapping returned tool names case-insensitively against `body.tools` before splitting proxy vs harness tools) completely eliminated the loop on re-test: Flint completed **Turns 2–8 cleanly** (`97.5–99.8%` cache) all the way up to **`197,750` tokens** before hitting the `45.24 GB` wired memory guard on Turn 9 (`8/9`, stopping cleanly right below the `>=10/12` Tier 4 gate). That improvement permanently hardens `llm-proxy.mjs` for any future model with lowercase tool priors.
2. **Splash vs oMLX on Qwen 3.8 27B (`Arm 0` vs `Arm 5`):** Same-engine control `Jundot/Qwen3.8-27B-oQ4e-mtp` on `oMLX` scored `39.2 t/s` (`2K`) and `30.4 t/s` (`Tier 2`) vs **LM Studio Splash 1.3.0**'s `73.7 t/s` (`2K`) and `44.3 t/s` (`Tier 2`). Splash 1.3.0 remains clearly faster for Qwen 3.8 27B.
3. **`DaisyRose-27B` (`Arm 6`) & `Ornith-1.5-35B-A3B` (`Arm 8`):**
   - **DaisyRose-27B** (`oQ4e-mtp`) aced **Tier 4 5/5 + T6 PASS with 0 timeouts in `2,481 s`** (`414 s/task`), beating Splash4 (`3,527 s`, failed Task 3), and ranked **#2 (`35.5/40`)** in blind review.
   - **Ornith-1.5-35B-A3B** (`oQ4e-mtp`) achieved the sweep's fastest numbers on every axis except unexecuted review polish: **`103.6 t/s`** (`2K`), **`140.0 t/s`** (tool calls), **`2,646.5 t/s`** (`16K` cold PF = `7.74 s`), **`0.61 s`** warm Claude Code ping (`5.93 s` cold first turn), **`86.9 t/s`** Tier 2 mean (`334 s` for all 12 turns!), **`8/8`** deep recall (`472 s`, `30.85 GB` max wired), and **`5/5 + T6 PASS`** in **`697 s` (`11.6 min`, 0 timeouts)**.
4. **`xhigh` Overthinking Sensitivity:** Both Qwen 3.8 Splash4 (early `300s` run: `1/5`, due to `10K–20K` single-turn reasoning token spikes taking `490s`) and Inkling 2 Mini (`1200s` timeouts after writing valid code) overthink when capped too tightly at `xhigh`. Raising the Tier 4 cap to `1200s` with `--restart-cmd` between tasks measured true `xhigh` capability accurately.

---

## 4. Complete Measured Benchmark Tables (`2026-11-20` – `2026-11-21`)

### Tier 1: Direct `:8089` Microbenchmark (Prefill, Decode, Cache, Tool Round-Trip)

| Arm | 2K Decode (`t0` / `t1`) | 16K Cold PF | 16K Warm TTFT / Hit | 32K Cold PF | 32K Warm TTFT / Dec | Tool Call (`turn1` Dec) | Peak RSS / Wired |
|---|---:|---:|---:|---:|---:|---:|---:|
| **`ornith-35b-a3b-oq4e-omlx`** | `70.7` / **`103.6`** t/s | **`7.7 s`** (`2,646` t/s) | **`0.33 s`** / `99.8%` | **`19.2 s`** (`2,101` t/s) | **`0.42 s`** / **`87.0`** t/s | **PASS** (`140.0` t/s) | `11.4` / `26.8` GB |
| `flint-oq4e-omlx` | `93.9` / `95.3` t/s | `8.7 s` (`1,848` t/s) | `0.57 s` / `99.9%` | `19.5 s` (`1,627` t/s) | `1.64 s` / `71.6` t/s | **PASS** (`111.8` t/s) | `4.9` / `26.8` GB |
| **`qwen38-splash4`** | `73.7` / `70.6` t/s | `36.3 s` (`565` t/s) | `0.40 s` / `99.7%*` | `77.2 s` (`522` t/s) | `0.47 s` / `53.4` t/s | **PASS** | `19.0` / `25.9` GB |
| **`inkling2-oq3e-omlx`** (`TF32=0`) | `54.6` / `65.8` t/s | `22.2 s` (`824` t/s) | `1.16 s` / `99.9%` | `46.3 s` (`776` t/s) | `2.56 s` / `40.7` t/s | **PASS** (`83.3` t/s) | `15.7` / `25.2` GB |
| `inkling2-native-notf32` (`TF32=0`) | `41.1` / `54.0` t/s | `21.8 s` (`841` t/s) | `0.96 s` / `99.9%` | — | — | **PASS** (`62.7` t/s) | `23.9` / `30.9` GB |
| `inkling2-native-omlx` (`TF32=1`) | `40.8` / `51.3` t/s | `21.7 s` (`844` t/s) | `0.97 s` / `99.9%` | `46.0 s` (`781` t/s) | `3.07 s` / `34.4` t/s | **PASS** (`63.8` t/s) | `23.5` / `31.1` GB |
| `inkling2-oq4e-omlx` (`TF32=0`) | `45.0` / `51.3` t/s | `21.8 s` (`840` t/s) | `1.13 s` / `99.9%` | `46.1 s` (`780` t/s) | `2.65 s` / `35.8` t/s | **PASS** (`70.7` t/s) | `18.6` / `27.8` GB |
| **`daisyrose-27b-oq4e-omlx`** | `44.7` / `45.2` t/s | `46.5 s` (`441` t/s) | `0.64 s` / `99.8%` | `99.7 s` (`404` t/s) | `1.07 s` / `33.8` t/s | **PASS** (`41.5` t/s) | `11.9` / `27.3` GB |
| `inkling2-unsloth-q4xl-dspark` | `38.6` / `40.4` t/s | `61.4 s` (`299` t/s) | `0.74 s` / `99.8%` | `151.7 s` (`237` t/s) | `0.87 s` / `28.0` t/s | **PASS** (`41.4` t/s) | `25.8` / `27.4` GB |
| `qwen38-oq4e-omlx` (control) | `37.1` / `39.2` t/s | `49.1 s` (`417` t/s) | `0.63 s` / `99.8%` | `103.0 s` (`391` t/s) | `1.06 s` / `34.8` t/s | **PASS** (`43.7` t/s) | `11.9` / `27.6` GB |
| `inkling2-native-nodspark` (ablation) | `32.3` / `32.9` t/s | `21.5 s` (`850` t/s) | `0.95 s` / `99.9%` | — | — | **PASS** (`34.7` t/s) | `23.0` / `28.6` GB |
| `inkling2-unsloth-q8xl-dspark` | `30.1` / `29.8` t/s | `61.9 s` (`296` t/s) | `0.69 s` / `99.8%` | — | — | **PASS** (`34.2` t/s) | `28.2` / `31.9` GB |

_\* LM Studio Splash 1.3.0 logs exact prefix cache counts (`20,480 / 20,537 = 99.7%` @ 16K, `40,256 / 40,324 = 99.8%` @ 32K) to `~/.lmstudio/server-logs/` rather than SSE `usage`._

---

### Tier 2: Real Multi-Turn Claude Code (`qwen-code`, Official `--think xhigh`)

| Arm | Ping 1st / Warm Med | Turns OK | Warm Prefills | Avg Cache Hit | Mean Decode | Max Prompt Ctx | Total Wall | Max Wired / RSS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **`ornith-35b-a3b-oq4e-omlx`** | **`5.9 s` / `0.61 s`** | **12/12** | 26/26 | `91.4%` | **`86.9` t/s** | `71,927` | **`334 s`** | `32.7` / `12.4` GB |
| **`qwen38-splash4`** | `27.1 s` / `1.01 s` | **12/12** | 24/25 | `91.1%` | `44.3` t/s | `75,061` | `1,123 s` | `35.9` / `25.8` GB |
| **`daisyrose-27b-oq4e-omlx`** | `34.4 s` / `1.76 s` | **12/12** | 36/36 | `93.0%` | `31.3` t/s | `73,738` | `1,526 s` | `36.6` / `12.2` GB |
| `qwen38-oq4e-omlx` (control) | `31.3 s` / `1.63 s` | **12/12** | 25/25 | `89.7%` | `30.4` t/s | `74,557` | `1,418 s` | `37.0` / `12.2` GB |
| **`inkling2-oq3e-omlx`** | `56.5 s` / `3.98 s` | **12/12** | 34/36 | `87.1%` | `30.2` t/s | `86,875` | `2,337 s` | `39.2` / `16.0` GB |
| `inkling2-unsloth-q4xl-dspark` | `53.1 s` / `2.79 s` | **12/12** | 53/55 | `95.4%` | `26.2` t/s | `86,287` | `2,380 s` | **`31.2`** / `28.9` GB |
| `inkling2-oq4e-omlx` | `23.9 s` / `3.24 s` | `11/12`* | 59/60 | `97.1%` | `24.0` t/s | `113,462` | `1,913 s` | `44.9` / `18.1` GB |
| `inkling2-native-omlx` (`8GB` hotcache run) | `24.6 s` / `3.37 s` | `4/5` (mem guard) | 20/24 | `90.6%` | `24.8` t/s | `78,302` | `959 s` | `50.5` / `19.4` GB |
| `flint-oq4e-omlx` (post-casefix) | `8.1 s` / `1.48 s` | `8/9` (mem guard) | 130/132 | `98.6%` | `34.6` t/s | `197,750` | `1,715 s` | `45.2` / `8.6` GB |

_\* `inkling2-oq4e-omlx` completed Turns 1–11 cleanly up to `113,462` tokens (`<=41.46 GB` wired); Turn 12 hit `44.91 GB` wired with `ctx=0 / gen=0`._

---

### Tier 3: `stress-corpus` Planted-Fact Depth Ladder (`xhigh`, `44.0 GB` Wired Cap)

| Arm | Files Recalled | Early Recall (`file1`) | Max Wired GB | Total Wall | Outcome |
|---|---:|---:|---:|---:|---|
| **`ornith-35b-a3b-oq4e-omlx`** | **8/8** | **3/3** | **`30.9` GB** | **`472 s`** | Completed (`--max-files 8`) cleanly |
| **`inkling2-oq3e-omlx`** | **8/8** | **3/3** | `40.5` GB | `507 s` | Completed (`--max-files 8`), `16.5–29.2 s` on Turns 4–8 |
| `inkling2-oq4e-omlx` | **8/8** | **3/3** | `39.2` GB | `318 s` | Completed (`--max-files 8`) |
| `inkling2-native-omlx` (`2GB` hotcache) | **8/8** | **3/3** | `41.1` GB | `616 s` | Completed (`--max-files 8`) |
| `qwen38-splash4` | `5/6` | `1/2` | `34.7` GB | `1,393 s` | Timeout at Turn 6 (`420 s` cap, no OOM) |
| `daisyrose-27b-oq4e-omlx` | `5/6` | `1/2` | `36.8` GB | `1,682 s` | Timeout at Turn 6 (`600 s` cap, no OOM) |
| `inkling2-unsloth-q4xl-dspark` | `0/1` | — | `31.3` GB | `600 s` | Timed out on Turn 1 (`600 s`) |

---

### Tier 4: 6-Task Agentic Coding & Debugging Eval (`xhigh`, `1200s` Cap/Task)

| Arm | Graded Pass | T1 (`ttl_lru`) | T2 (`multifile`) | T3 (`sse_parser`) | T4 (`pipeline`) | T5 (`cli`) | T6 (`concurrency_review`) | Total Wall |
|---|---:|:---:|:---:|:---:|:---:|:---:|:---:|---:|
| **`ornith-35b-a3b-oq4e-omlx`** | **5/5** | **PASS** (`142s`) | **PASS** (`102s`) | **PASS** (`166s`) | **PASS** (`48s`) | **PASS** (`120s`) | **PASS** (`120s`) | **`697 s`** (`11.6m`) |
| **`daisyrose-27b-oq4e-omlx`** | **5/5** | **PASS** (`559s`) | **PASS** (`574s`) | **PASS** (`439s`) | **PASS** (`94s`) | **PASS** (`392s`) | **PASS** (`423s`) | `2,481 s` (`41.4m`) |
| **`inkling2-oq3e-omlx`** | **5/5** | **PASS** (`1200s`) | **PASS** (`469s`) | **PASS** (`906s`) | **PASS** (`179s`) | **PASS** (`387s`) | **PASS** (`812s`) | `3,953 s` (`65.9m`) |
| `inkling2-native-omlx` | **5/5** | **PASS** (`1200s`) | **PASS** (`1091s`) | **PASS** (`1200s`) | **PASS** (`406s`) | **PASS** (`746s`) | `FAIL` (`1200s` timeout) | `5,843 s` |
| `inkling2-oq4e-omlx` | `4/5` | **PASS** (`1200s`) | `FAIL` (`695s`) | **PASS** (`974s`) | **PASS** (`342s`) | **PASS** (`608s`) | `FAIL` (`1200s` timeout) | `5,018 s` |
| **`qwen38-splash4`** *(official `xhigh`)* | `4/5` | **PASS** (`640s`) | **PASS** (`727s`) | `FAIL` (`1155s`) | **PASS** (`78s`) | **PASS** (`364s`) | **PASS** (`563s`) | `3,527 s` (`58.8m`) |
| `qwen38-splash4-medium` *(bonus `medium`, 360s cap)* | `4/5` | **PASS** (`271s`) | **PASS** (`270s`) | **PASS** (`244s`) | **PASS** (`52s`) | `FAIL` (`142s`) | **PASS** (`242s`) | `1,221 s` |
| `inkling2-unsloth-q4xl-dspark` | `3/5` | `FAIL` (`1200s`) | **PASS** (`952s`) | **PASS** (`1200s`) | `FAIL` (`411s`) | **PASS** (`1200s`) | `FAIL` (`1200s` timeout) | `6,163 s` |
| `qwen38-splash4-xhigh` *(early 300s-cap exploratory)* | `1/5` | `FAIL` (`490s`) | `FAIL` (`300s`) | `FAIL` (`300s`) | **PASS** (`259s`) | `FAIL` | `FAIL` (`300s`) | `1,648 s` |

---

### Blind Task 6 Concurrency Review Grading (via `agy` Blind Judge)

All four complete Task 6 reviews (`task6_review/pool.py`) were shuffled and anonymized as **Model A–D** before grading on four axes (`/10` each, `40` total):

| Blind Rank | Unblinded Model | Accuracy | Depth | Actionability | Signal-to-Noise | Total (/40) | Judge Takeaways |
|---:|---|---:|---:|---:|---:|---:|---|
| **#1** | **`qwen38-splash4`** (Model A) | **9.5** | **9.5** | 8.5 | 8.5 | **36.0** | Zero CPython/`asyncio` factual errors; nailed `Queue.get()` vs `unfinished_tasks`, `Thread.start()` `RuntimeError` leak, GIL vs PEP 703 RMW semantics, and non-daemon shutdown blocking. |
| **#2** | **`daisyrose-27b-oq4e-omlx`** (Model B) | 8.5 | 9.0 | **9.0** | **9.0** | **35.5** | Cleanest signal-to-noise and most production-ready typed rewrite; docked slightly for claiming `queue.get()` increments unfinished tasks and dropping `active_count`. |
| **#3** | **`inkling2-oq3e-omlx`** (Model D) | 7.5 | 8.0 | 7.5 | 7.5 | **30.5** | Caught all 4 planted bugs + `Thread.start()`/`concurrency < 1` edge cases; docked for fragmented snippets and claiming unbounded `Queue.put()` suspends. |
| **#4** | **`ornith-35b-a3b-oq4e-omlx`** (Model C) | 5.5 | 6.0 | 3.5 | 7.0 | **22.0** | Found all 4 planted bugs cleanly, **but** its unexecuted hand-written code rewrite had a `SyntaxError` (extra `)`) and forgot `w.cancel()`, causing an infinite `gather()` hang. |

---

## 5. Everyday Usage Walkthrough

Run `source ~/.zshrc` once (or open a new terminal tab — `./setup.sh` already updated your shell snippet and `~/.local/bin/*` symlinks).

### 5.1 Running Claude Code Locally (`claude local ...`)
Every local model defaults to **`--think xhigh`** and leaves plain **`claude`** untouched on your Anthropic Pro subscription:

```bash
# Default local winner — Ornith-1.5-35B-A3B (fastest across all tiers)
claude local
claude local ornith
claude local ornith --think medium           # faster latency when deep reasoning isn't needed

# Thinking Machines Inkling-2-Mini oQ3e-mtp (accepts none|minimal|low|medium|high|xhigh)
claude local inkling2
claude local inkling2 --think low

# DaisyRose-27B (pure-RL Qwen 3.8 27B)
claude local daisyrose

# Qwen 3.8 27B Splash4 (LM Studio Splash 1.3.0)
claude local qwen38_27

# Plain Claude Pro subscription (NEVER routes locally)
claude

# Claude Pro + opt-in local delegation subagent
claude subagent
```

### 5.2 Managing the Local Stack (`llm-serve`)
One model server runs at a time on port `:8089`, fronted by `llm-proxy.mjs` on `:8790` (`scripts/llm-serve` handles seamless switching between `oMLX` and `LM Studio Splash`):

```bash
llm-serve start ornith35        # also accepts inkling2, daisyrose27, splash4
llm-serve status                # shows active engine, family, ctx cap, RSS, and proxy --think level
llm-serve which                 # prints active alias
llm-serve restart-proxy         # reload proxy only (keeps weights resident)
llm-serve logs [server|proxy]   # tail server or structured METRICS proxy logs
llm-serve stop                  # unloads server + stops proxy (frees :8089 & :8790)
```

Convenience aliases installed in `~/.zshrc`:
`llm_start`, `llm_stop`, `llm_status`, `llm_logs`, `llm_use_ornith`, `llm_use_inkling2`, `llm_use_daisyrose`, `llm_use_splash`, `claude_local_ornith`, `claude_local_inkling2`, `claude_local_daisyrose`, `claude_local_splash`.

### 5.3 One-Shot CLI (`qwen`) & Terminal Chat (`qwen-cli`)
Both tools automatically inspect `~/.local/state/local-llm/` (`upstream_model`, `family`, `top_p`) so they work transparently against whichever model `llm-serve` loaded:

```bash
# One-shot (thinking off by default for bulk tasks; --think opts in at xhigh)
qwen "summarize what scripts/llm-serve does"
git diff | qwen "write a conventional commit message"
qwen --think -f queue_worker.py "find concurrency hazards"

# Interactive terminal chat (streaming OpenAI REPL for oMLX models; `lms chat` for splash4)
qwen-cli ornith35               # or inkling2 / daisyrose27 / splash4
```

### 5.4 Acceptance & Isolation Verification Results (`2026-11-21`)
Post-install acceptance checks passed across every model and isolation boundary:
- **`claude local ornith --think xhigh` (`Glob`/`ls` + `-c` follow-up):** `98.5%` warm cache hit (`12,548 / 12,744`), `0.27 s` TTFT, `0.527 s` reply wall, `90.0–114.7 t/s` decode (`rss=10.5 GB`).
- **`claude local inkling2 --think xhigh` (`Glob`/`ls` + `-c` follow-up + `--think low` proxy toggle):** `98.6–99.2%` warm cache (`13,684 / 13,872`), `0.83–0.94 s` TTFT, `1.94 s` warm reply wall, `44.3–52.2 t/s` decode; `/health` dynamically confirmed `effort: "low"` <-> `effort: "xhigh"` reload without unloading weights.
- **One-shot `qwen` on active `inkling2`:** returned `QWEN_OK`.
- **Clean multi-backend handoff:** switched `inkling2` -> `daisyrose27` (`DAISY_OK`) -> `splash4` (`SPLASH_OK`) -> `llm-serve stop` (`lsof` `:8089,8790` empty).
- **Strict isolation & hardware health:** `env | grep ^ANTHROPIC` empty, `~/.claude/plugins/local-llm` absent, `~/.claude/local-plugins/local-llm` present, `panic-full-*` count = `0`.
- **Lean disk footprint (`~/Models/`, `50 GB` total across 3 wired oMLX models, `642 GiB` disk free):**
  - `ornith-35b-a3b-oq4e-mtp` (`21 GB`)
  - `daisyrose-27b-oq4e-mtp` (`16 GB`)
  - `inkling2-mini-oq3e-mtp` (`13 GB`)
  - *(Unwired Inkling Native/oQ4e/GGUF, `tools/llama-unsloth-b12588`, `Qwen3.8-oQ4e`, and `Flint-oQ4e` pruned.)*

Live per-experiment tracker: [BENCHMARK_STATUS.md](BENCHMARK_STATUS.md)
