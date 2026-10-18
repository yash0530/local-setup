# PCSX2 — Need for Speed: Most Wanted (Black Edition)

Tuned setup for NFS MW on a MacBook Pro (M5 Pro, 64 GB) running PCSX2 v2.6.3 **under Rosetta
(x86_64)** — there is no native ARM PCSX2 build, so Rosetta is mandatory.

## Files here

- `PCSX2.ini` — the full live config (pad bindings, Metal renderer, QHD-optimized settings).
  The live copy is `~/Library/Application Support/PCSX2/inis/PCSX2.ini`.

## Restoring

```sh
mkdir -p "$HOME/Library/Application Support/PCSX2/inis"
cp emulators/PCSX2.ini "$HOME/Library/Application Support/PCSX2/inis/PCSX2.ini"
```

(Back up whatever is currently there first. The config also carries window geometry,
memcard slots, and all other PCSX2 settings from this machine.)

## The game

- `~/Documents/PS2Games/Need for Speed - Most Wanted - Black Edition.iso` — SLUS-21351, CRC 0518D274.
- GameDB auto-applies the known rendering fixes (bilinear upscale, half-pixel offset,
  native scaling) — leave them on.

## Controls (final, working layout — DualSense on Port 1)

The PS2 game reads *buttons/sticks*; the controller config remaps physical controls to what
the game polls. Verified against the game's published PS2 control list:

| Physical | Sends | Game action |
|---|---|---|
| Right trigger | R-stick up | **throttle** |
| Left trigger | R-stick down | **brake / reverse** |
| Left stick | L-stick | **steer** |
| R1 | virtual L1 | **nitro** |
| L1 | virtual R1 | e-brake |
| D-pad | D-pad | menus, enter shop (up) |
| X / Square / Circle / Triangle | Cross / Square / Circle / Triangle | boost-confirm / speedbreaker / look-back / nitro-alt |
| Start | Start | pause |

Notes:

- The game's *own* right-stick throttle/brake inputs are deliberately **unbound**
  (`L2`/`R2` empty) so pushing the right stick does nothing — only the triggers drive.
- Connect the DualSense **before** launching PCSX2 so it is `SDL-0`; the bindings
  are player-indexed.
- A keyboard fallback layout exists in the backups in `~/Library/Application
  Support/PCSX2/inis/` (`PCSX2.ini.bak-20261016`, `.bak2-20261017`) if needed.

## Performance (why it's configured this way)

Symptom that led here: 4K window at 100%/60 fps, dropping to 1080p made it *slower*
(60%, 45 fps). Lower resolution making things slower proves the **CPU (Rosetta), not the
GPU**, is the bottleneck — NFS MW is one of the heaviest PS2 games (interlaced 2:1,
pursuits, particles) and Rosetta adds 20–50% translation overhead.

The fix in `PCSX2.ini` ([EmuCore/GS]):

- `Renderer = 2` (Metal, explicit)
- `upscale_multiplier = 3` → internal render buffer 1920×1344, stretched to the QHD window
  (window size alone does nothing in PCSX2; the internal buffer is what the GPU renders).
  Ladder if a scene dips: 3× (sharpest) → 2× (1280×896, slight softness) → F4 frame-limit.
- `deinterlace_mode = 0`, `linear_present_mode = 1` — MW is 60 fps progressive; no
  deinterlace cost.
- VSync off, `FramerateNTSC = 59.94`.
- OsdShow* flags on — the on-screen speed/FPS/CPU/GPU/frametime readout makes any future
  tuning data-driven instead of guesswork.

**Play on the power adapter.** On battery the M5 Pro throttles, and heat throttles too —
the most common cause of "fine at the start, degrades after a few minutes".

## PCSX2 config gotchas (learned the hard way)

1. **SDL axis syntax**: sign goes *after* the slash — `SDL-0/+LeftY`, not `+SDL-0/LeftY`.
   `+SDL-0/...` parses as device `+SDL-0`, fails, and is silently dropped. (Verified in
   `pcsx2/Input/SDLInputSource.cpp` at the v2.6.3 tag: `ParseKeyString`.)
2. Button tokens: `SDL-0/DPadUp`, `SDL-0/FaceSouth` (Cross), `SDL-0/FaceWest` (Square),
   `SDL-0/FaceEast` (Circle), `SDL-0/FaceNorth` (Triangle), `SDL-0/LeftShoulder`, etc.
   Triggers: `SDL-0/+RightTrigger` / `SDL-0/-RightTrigger` (full-press with the axis sign).
3. One PS2 button must have exactly one effective source — binding Enter to both Start
   (pause) and D-pad-up (enter shop) made Enter open the pause menu on top of the shop.
4. The keyboard pad and SDL gamepads coexist per port; Port 1 currently points at the
   DualSense, which is why keyboard no longer works in-game (by design here).

## Reference

- Game controls (PS2): GameFAQs NFS Most Wanted FAQ — throttle X/R-stick-up, brake
  Square/R-stick-down, steer L-stick, nitro L1, shifts R2/L2, e-brake R1, D-pad menus.
- Rosetta: PCSX2 emulog line `Processor: ... (Rosetta)`; stenzek's native-ARM PR —
  x86 JIT recompiler is x86-only, so no ARM build yet.
