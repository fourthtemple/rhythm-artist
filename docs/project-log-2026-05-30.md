# Rhythm Artist — Project Log
**Date:** May 30, 2026  
**Session:** Full rhythm sequencer history — registry refactor, memory-leak fix, feature work, standalone scaffold + engine audit + bug fixes

---

## 808 Shaping — Miami-bass voice controls (latest)

Added a global **808 Shape** control group (Mix panel) plus a `get808Shape()`
helper in `rhythm-engine-808.js` so a single "machine character" drives every
808 voice consistently. New config fields (clamped in `rhythm-config.js`,
persist with the project):

- **Drive** (`eightOhEightDrive`) — analog-style waveshaper grit, strongest on
  the kick, for the saturated low-end of classic Miami-bass records.
- **Punch** (`eightOhEightPunch`) — sharpens the attack/click transient on
  kick, toms and conga for a snappier hit.
- **Decay** (`eightOhEightDecay`) — global tail-length multiplier (0.3–2.5×);
  crank it for the long booming 808 sustain (kick/tom/snare/clap/cymbal/conga
  ring and the kick pitch sweep).
- **Tone** (`eightOhEightTone`) — brightness tilt on the noise/metal voices
  (snare, hat, clap, cymbal) so the kit can go dark or sizzly.
- **Sub** (`eightOhEightSub`) — extra low-end weight on the kick: deeper start
  pitch, slower sweep, wider low-pass — the sub-bass boom.
- **Choke** (`eightOhEightChoke`, on/off) — circuit-style mono behaviour. Hat
  and cymbal share one **"metal" choke group** (like a real 808's open/closed
  hat circuit) and the kick chokes itself, so retriggers cut the previous voice
  instead of stacking. Implemented via `choke808Group()` which fast-fades the
  previous voice's gain.

The choke slider renders **on/off** in `syncSliders()` like the Auto-Echo
toggle. All voices read shaping through `get808Shape()`, so the controls work
live during playback and round-trip through save/load.

---

## Track Explorer / Add-Track / Sampler fixes

Round of UI/engine fixes driven by user feedback:

- **Added tracks now appear + make sound.** The root bug: `EDITABLE_GENERATED_ROWS`
  was bound to `GENERATED_TRACK_IDS` (only `addByDefault` tracks), so extra 808
  voices and samplers were never scheduled by the engine. Added
  `ALL_GENERATED_TRACK_IDS` to the registry and pointed `EDITABLE_GENERATED_ROWS`
  at it. Also fixed `addGridTrack`/`removeGridTrack` to call `buildStepGrid()`
  (rebuilds rows) instead of `renderStepGrid()` (only updates states) — that's
  why a newly added "808 Clap" never showed up in the grid.
- **Removed the duplicate "+ Add Track" button** under the loop toolbar / Fill
  Rest. Adding tracks is now only done from the right-side Track Explorer.
- **Removed the inline "×" on grid rows and the Track Explorer rows.** Deleting a
  track is now a track-level action: select the track, then **Delete Track** in
  the Track Inspector (disabled for non-removable core kit).
- **Unified the drum-machine button look.** Generated rows (synths/808/samplers)
  now share the same cell style, fill color, and label treatment as pattern
  rows — no more dashed teal cells or per-cell track names. Only the bass row
  shows pitch text.
- **New Sampler tracks.** Added a "Samplers" group with `sampler1..4`
  (voice `"sampler"`). They start empty; assign a sample from the Sample Browser
  (＋) and the engine plays the loaded buffer, pitched by the step's pitch
  offset. Auditioning and per-track sends/level/pan all work.

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

## Engine modularization (`rhythm-engine.js` → focused mixins)

The sound engine had grown to ~2,150 lines. It's now split so each file is
focused, while staying a single `RhythmEngine` class via prototype mixins:

- **`rhythm-engine-808.js`** (`EightOhEightVoices`) — the full 808 drum-machine
  kit: `play808Overlay`, `play808Kick`, `play808Snare`, `play808Hat`,
  `play808Click`, `play808Clap`, `play808Tom`, `play808Cowbell`,
  `play808Conga`, `play808Maraca`, `play808Cymbal`.
- **`rhythm-engine-synth.js`** (`SynthVoices`) — pitched/melodic voices:
  `playBassSynth`, `playPluckSynth`, `playFunkSynth`, `playEchoPingSynth`,
  `playPadSynth`, `scheduleWhaleLayer`, `playWhaleSynth`, `playSynthFallback`.
- **`rhythm-engine.js`** keeps the scheduler, graph wiring, track-routing
  helpers (`connectTrackOutput` / `connectTrackBus` / `scheduleVoiceCleanup`),
  FX, and config plumbing, then mixes the voice modules onto the prototype:

  ```js
  Object.assign(RhythmEngine.prototype, EightOhEightVoices);
  Object.assign(RhythmEngine.prototype, SynthVoices);
  ```

Result: `rhythm-engine.js` dropped from ~2,150 → ~1,460 lines, with 288-line
(808) and 446-line (synth) companion modules. Verified with `node --check` on
all modules and a runtime prototype check confirming every voice method is
present; all modules serve `200` from the dev server.

### Right-side track UI (status)
- Add Track dialog is registry-driven, grouped by `tracksByGroup()` with group
  accents; chips toggle add/remove and disable core (non-removable) tracks.
- Grid rows carry inline `×` remove buttons for removable tracks; selecting a
  row surfaces per-track bus send, reverb send, level, and pan, all of which
  round-trip through save/load and drive the live engine.

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

---

## Right-side panels + custom samples (latest pass)

Moved all per-track work out of the bottom "Selected" strip into three
right-side panels, and added user-sample support end-to-end.

### Track Explorer (`#track-explorer-list`)
- Grouped, registry-driven list of grid tracks (Core / Synths / 808 / FX).
- Click a track name to select its **row** (toggles off when re-clicked).
- Per-row **solo** toggle + inline **×** remove for removable tracks.
- Green dot marks tracks with a custom sample assigned.
- `renderTrackExplorer()` is refreshed from `selectStep`, `resetSelectedPanel`,
  `addGridTrack`, `removeGridTrack`, and load/reset.

### Track Inspector (`#track-inspector-section`)
- Header shows the selected track name + a **Sample row**
  (name · ▶ audition · ⟲ reset-to-built-in).
- Body holds Level / Pan / Delay / Verb (the per-track controls that used to
  live at the bottom). Hidden when nothing is selected.
- `renderTrackInspector()` keeps the header/sample label in sync.

### Sample Browser (`#sample-browser-section`)
- Root `<select>` populated from `GET /api/sample-roots`.
- Folder navigation via `GET /api/sample-browse` with a clickable breadcrumb
  and a `..` row.
- Each file: **▶** auditions via a throwaway `<Audio>` element; **＋** loads it
  into the currently-selected track.
- Verified live against the `drummy` root (Kick/808/909 → `808_01.wav` serves
  `audio/wav`, 90 KB).

### Custom-sample engine support (`rhythm-engine.js`)
- `customSampleBuffers` / `customSampleUrls` maps on the engine.
- `setTrackSample(track, url)` decodes + caches; `clearTrackSample(track)`
  reverts; `trackSampleUrl` / `hasCustomSample` accessors.
- `playHit` now prefers a track's custom buffer over the built-in kit.
- `auditionTrack` / `previewTrackVoice` fire a single hit of either the custom
  sample or the built-in voice (covers every registry voice).

### Config round-trip (`rhythm-config.js`)
- New `trackSamples` map: `{ trackId: { url, label, root, path } }`,
  normalized + filtered so only valid string-url entries persist.
- Editor `assignSampleToTrack` / `clearTrackSample` write config + engine;
  `reapplyTrackSamples()` re-decodes on load/reset/restart (and prunes engine
  entries dropped from config).

### Bug fixes
- **Click-to-deselect:** clicking the already-selected step (or its row, or its
  Explorer entry) now clears the selection without wiping the note.
- Per-track Level/Pan/Delay/Verb update + apply live again now that they're
  wired through the inspector.
```
