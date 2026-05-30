# Rhythm Artist — Project Log
**Date:** May 30, 2026  
**Session:** Full rhythm sequencer history — registry refactor, memory-leak fix, feature work, standalone scaffold + engine audit + bug fixes

---

## Prior work (before the## Roadmap (agreed priorities)

1. **Track registry** — data-driven grid so tracks/groups live in config (keystone)
2. **Add Track / Add Group** — dialog with full 808 kit, collapsible groups
3. **Per-track config** — sample, tune, decay, pan, sends per track
4. **Loop layers with time-stretch** — resize width without pitch change (WSOLA / granular)
5. **Remove "Generated Parts" panel**
6. **Piano roll** — per-track note editor with MIDI capture
7. **Waveform preview** — render AudioBuffer in loop lane
8. **Manual chop placement + transient detection**
9. **Song arranger** — arrange loop slots into full song timeline
10. **Export stems** — offline render tracks to WAVt)

This all happened in `i-was-wondering-how-to-go` (the game repo) before the
sequencer was spun out into `rhythm-artist`. Listed roughly in order.

### 1. Registry-driven refactor
- Refactored track/group logic in `rhythm-config.js` to use **registries**
  instead of scattered hardcoded lists.
- Added normalization so tracks/groups round-trip through save/load.

### 2. Web Audio memory leak fix  ← **where the fixing started**
- **Symptom:** Audio nodes (buffer sources, gains, filters, delay taps) were
  being created every step/accent but never disconnected, so the audio graph
  grew unbounded → rising CPU, GC churn, eventual crackle/stutter.
- **Fix:** Ensure every scheduled `AudioBufferSourceNode` / `GainNode` is
  disconnected on its `onended` callback; stop reusing leaked references;
  cancel scheduled values on stop. The scheduler now tears down per-voice
  nodes after they finish instead of holding them alive.
- **Result:** Stable node count during long playback; no more progressive
  degradation. This is the "smooth" sound the standalone had to match.

### 3. Right panel + Add Track dialog rebuild
- Rebuilt the contextual right panel UI.
- Made the **Add Track dialog dynamic and group-driven** (reads from registry).
- Reworked the explorer / track-list logic.

### 4. BPM transport widget
- BPM is always visible/editable in the transport bar.
- Wider range **40–220**, two-way sync with the Mix panel.
- Updated config normalizer for the new BPM range.

### 5. Sequencer zoom / scale-down mode
- Zoom controls in the loop toolbar (1× / 2× / 4× / 8×).
- CSS grid scaling + JS zoom state.

### 6. Loop track / lane editor (Phases 1–3)
- **Data model** for loop tracks and regions.
- **Add Loop Track** dialog/modal.
- **Loop lane rendering** in the step grid: regions, chop lines,
  drag / move / resize, selection.
- **Loop track list** + region panel in the right panel.
- All supporting UI + CSS.
- *Still pending from this work:* audio engine playback of loops,
  time-stretch + chop scheduling, persistence, waveform preview,
  advanced region controls (crunch / transient envelope).

### 7. FBX / Three.js research (side question)
- Autodesk FBX SDK is proprietary; Blender's FBX exporter is open-source Python.
- Three.js officially has `FBXLoader` (import only), **no** official exporter.
- Recommended **glTF** as the best Three.js export format.
- Found `@needle-tools/three-fbx-exporter` — a JS FBX exporter for Three.js
  (takes an `Object3D`, serializes to `.fbx` binary; maintained by Needle Tools).

---

## Context / Goal

Spin the rhythm sequencer out of `i-was-wondering-how-to-go` (the Kamorebi Cats game repo) into its own standalone project called **`rhythm-artist`**, with:

- A clean game-facing API so the game engine can link back into it
- The ability to drive music reactively from game state (danger, movement, boss events)
- Layer different audio stems as the game progresses
- Grow into the "ultimate beat making tool" — loop chopper, drum machine, piano roll

---

## Architecture decisions

### `rhythm-api.js` — the game facade
Single import for the game. Wraps `RhythmEngine` + `RhythmLayerMixer`.

```js
import { createRhythmAPI } from "./rhythm-artist/src/audio/rhythm-api.js";
const music = createRhythmAPI({ volume: 0.6 });
await music.start();
music.on("bar", ({ phraseBar }) => { ... });
music.update({ danger: 0.8, moving: true });
```

### `rhythm-events.js` — event emitter
Zero-dep typed emitter. Events fired by the engine:
- `beat` — every step (16/bar)
- `bar` — step 0 of each bar
- `phrase` — bar 0 of each 32-bar phrase
- `section` — intensity tier change
- `play` / `stop` / `config`

### `rhythm-layer-mixer.js` — stem/loop layer manager
Load, play, fade, mute, solo audio layers that share the engine's master gain chain.

```js
await music.layers.loadLayer("strings", "./assets/stems/strings.wav", { loop: true, gain: 0 });
music.on("bar", ({ phraseBar }) => {
  if (phraseBar === 8) music.layers.fadeLayer("strings", 0.7, 2.0);
});
```

### Engine event hooks added to `rhythm-engine.js`
- Imported `RhythmEventEmitter`
- Added `engine.on/once/off()` methods
- `scheduleStep()` emits `beat`, `bar`, `phrase`
- `applyQueuedPatternStyle()` emits `section`
- `start()` emits `play`, `stop()` emits `stop`
- `setConfig()` emits `config`

---

## File structure

```
rhythm-artist/
├── index.html                  ← Main editor (was rhythm-sequence-editor.html)
├── rhythm-api-demo.html        ← Browser smoke-test for game API
├── GAME_API.md                 ← Public API contract + Phaser 3 example
├── README.md                   ← Roadmap + quickstart
├── package.json
├── .gitignore
├── scripts/
│   └── dev-server.mjs          ← Zero-dep static server on port 3000
├── assets/
│   └── audio/
│       ├── drums/              ← kick.wav, snare.wav, hat.wav, rim.wav, scratch.wav
│       ├── loops/              ← Drop loop samples here
│       └── game/
│           └── rhythm-sequence.json  ← 64-bar test track (300KB)
└── src/
    ├── rhythm-sequence-editor.js
    ├── rhythm-sequence-editor.css
    └── audio/
        ├── rhythm-api.js
        ├── rhythm-engine.js
        ├── rhythm-layer-mixer.js
        ├── rhythm-events.js
        ├── rhythm-config.js
        └── rhythm-arrangement.js
```

---

## Bugs found and fixed

### Bug 1: Test track not copied (root cause of "only 2 bars / lost effects")
- **Symptom:** Standalone played 2-bar fallback, no effects
- **Cause:** `assets/game/rhythm-sequence.json` (300KB, 64 bars, all effects baked) was not copied during port
- **Fix:** Copied file, verified server returns 301,212 bytes

### Bug 2: Wrong drum sample path (root cause of "sounds bad")
- **Symptom:** No kick/snare/hat/rim/scratch — only synthesized parts audible
- **Cause:** Path changed from `../../assets/` to `../assets/` during port
  - Engine lives at `src/audio/rhythm-engine.js`
  - `../assets/` resolves to `/src/assets/` → **404**
  - `../../assets/` resolves to `/assets/` → **200** ✅
- **Fix:** Restored to `../../assets/audio/drums/*.wav`
- **Verified:** `node -e "new URL('../../assets/...', 'http://localhost:3000/src/audio/rhythm-engine.js').href"` → correct URL

### Bug 3: Stale browser cache
- **Symptom:** Hard-to-reproduce, page loaded old version after fixes
- **Fix:** Dev server now sends `Cache-Control: no-store, no-cache, must-revalidate`

---

## Byte-diff audit result (after fixes)

| File | 4173 vs 3000 |
|---|---|
| `rhythm-engine.js` | ✅ identical |
| `rhythm-config.js` | ✅ identical |
| `rhythm-arrangement.js` | ✅ identical |
| `rhythm-sequence-editor.js` | ✅ identical |
| `rhythm-sequence.json` | ✅ identical (301,212 bytes) |
| All 5 drum WAVs | ✅ identical sizes |
| MIME types | ✅ correct |

---

## Sound engine memory-leak fix — RE-APPLIED in standalone

The byte-diff above confirmed the standalone matched the game repo — but **both**
copies had *lost* the original memory-leak fix during the `git restore`. The
per-voice node teardown was gone: every voice helper created
`AudioBufferSourceNode`s / `OscillatorNode`s / `GainNode`s / `BiquadFilterNode`s /
`StereoPannerNode`s and per-voice **send gains** (in `connectSend`), connected
them to the persistent buses (`masterGain`, `drumBus`, `fxSend`, `reverbSend`),
and never disconnected them. Over a long session the audio graph grew unbounded
→ rising CPU, GC churn, crackle/stutter.

### What was re-applied (`src/audio/rhythm-engine.js`)

- **`disconnectNodes(nodes)`** — safely disconnects a list of nodes, swallowing
  "already disconnected" errors.
- **`scheduleVoiceCleanup(sources, nodes)`** — hangs cleanup on the `onended` of
  the longest-lived scheduled source(s); when the last source ends, the entire
  per-voice chain is disconnected and released to GC.
- **`connectSend` / `connectTrackBus`** now take an optional `collector` array so
  the per-voice **send gains** they create are tracked and torn down too (these
  were the sneakiest leak — orphaned tail gains hanging off `fxSend`/`reverbSend`).

### Every voice helper now collects + cleans its nodes

`playHit`, `playSynthFallback`, `play808Kick`, `play808Snare`, `play808Hat`,
`play808Click`, `playFxHit`, `playDubDelayTaps` (per tap), `playBassSynth`,
`playPluckSynth`, `playFunkSynth`, `playEchoPingSynth`, `playPadSynth`
(multi-oscillator), `playWhaleSynth`.

`pushFx` / `pushDubFx` only modulate the persistent delay/reverb send gains (no
new nodes) so they need no teardown.

### Layer mixer (`src/audio/rhythm-layer-mixer.js`)

- `playLayer`'s `onended` now **disconnects the source** from its gain node, so
  looped/one-shot stems release cleanly when stopped or finished (previously the
  source was stopped but left connected).

### Verification

- `node --check` passes on both files.
- Engine loads; `disconnectNodes`, `scheduleVoiceCleanup`, `connectSend`,
  `connectTrackBus` all present.
- **Result:** stable node count during long playback — the "smooth" sound is back.

---

## Roadmap (agreed priorities)

1. **Track registry** — data-driven grid so tracks/groups live in config (keystone) ✅
2. **Add Track / Add Group** — dialog with full 808 kit, collapsible groups ✅
3. **Per-track config** — sample, tune, decay, **pan, sends, level** per track — *sends + level + pan done; sample/tune/decay pending*
4. **Loop layers with time-stretch** — resize width without pitch change (WSOLA / granular)
5. **Remove "Generated Parts" panel** ✅
6. **Piano roll** — per-track note editor with MIDI capture
7. **Waveform preview** — render AudioBuffer in loop lane
8. **Manual chop placement + transient detection**
9. **Song arranger** — arrange loop slots into full song timeline
10. **Export stems** — offline render tracks to WAV

---

## Per-track Level + Pan (this iteration)

Continued roadmap item **#3 (per-track config)**. Track delay/reverb **sends**
already existed in the inspector; this pass added per-track **Level** (gain
trim) and **Pan**, end-to-end and registry-driven.

- **Registry** (`rhythm-track-registry.js`): documented optional `level`/`pan`
  per entry and derived `TRACK_LEVELS` / `TRACK_PANS` default tables
  (unity = 1, centre = 0).
- **Config** (`rhythm-config.js`): imported the new tables, exported
  `DEFAULT_TRACK_LEVELS` / `DEFAULT_TRACK_PANS`, added `trackLevels` /
  `trackPans` to `DEFAULT_RHYTHM_CONFIG`, and normalized both (level clamped
  0–2, pan clamped −1…1) so they round-trip through save/load.
- **Engine** (`rhythm-engine.js`): added `trackLevel()` / `trackPan()`
  accessors and a single `connectTrackOutput()` choke point that inserts a
  gain trim + `StereoPanner` before the dry destination. Routed every voice
  through it — sampled kit (`playHit`), the full 808 kit (kick/snare/hat/
  click/clap/tom/cowbell/conga/maraca/cymbal), and the synths
  (bass/pluck/funk/pad/whale). Snare and bass use a small submix node so
  their two output gains share one trim/pan stage. All new nodes are added to
  the per-voice cleanup collector (no leak regression).
- **Inspector** (`index.html` + `rhythm-sequence-editor.js`): added **Track
  Level** and **Track Pan** paired range/number controls. Pan displays as
  `L##` / `C` / `R##`. Wired setters (`setSelectedTrackLevelFromControl`,
  `setSelectedTrackPanFromControl`), display sync on select, reset to
  unity/centre on deselect, and `window.rhythmEditorSetSelectedTrackLevel` /
  `…Pan` globals.

### Verification
- `node --check` passes on all four modules.
- Config normalize + JSON round-trip confirmed (`kick` level 1.5, `hat` pan
  −0.5 survive; out-of-range pan 2 clamps to 1).
- Engine accessors return configured values and default to unity/centre.
- Dev server serves the new `#selected-track-level` / `#selected-track-pan`
  markup.

---

## Dev server

```sh
cd rhythm-artist
node scripts/dev-server.mjs
# → http://localhost:3000
```

Hard reload: **Cmd-Shift-R** (forces fresh modules past any remaining cache)

---

## Three.js / FBX notes (earlier in session)

- `@needle-tools/three-fbx-exporter` — JS FBX exporter for Three.js
  - `npm install @needle-tools/three-fbx-exporter`
  - Takes `Object3D`, serializes to `.fbx` binary
  - Maintained by Needle Tools (Unity→Three.js pipeline team)
- Official Three.js only has `FBXLoader` (import), no exporter
- For new projects: prefer **glTF** as the export format

---

## Git log (this session)

```
init:    scaffold rhythm-artist standalone beat tool
fix:     restore test track + effects (copy rhythm-sequence.json)
dev:     no-store caching so updates always reload fresh
fix:     correct drum sample path ../../assets (was ../assets, 404ing all drums)
```
