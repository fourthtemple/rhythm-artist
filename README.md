# Rhythm Artist

> The ultimate browser-based beat making tool — drum machine, step sequencer,
> loop chopper, piano roll, and a clean game-engine API.

## Quick start

```sh
cd rhythm-artist
node scripts/dev-server.mjs
# open http://localhost:3000
```

No build step. Pure ES modules. No framework dependencies.

---

## Project structure

```
rhythm-artist/
├── index.html                  ← Main editor UI
├── rhythm-api-demo.html        ← Game API smoke-test
├── GAME_API.md                 ← Public API contract (game integration docs)
├── README.md
├── package.json
├── scripts/
│   └── dev-server.mjs          ← Zero-dep static server
├── assets/
│   └── audio/
│       ├── drums/              ← Kick, snare, hat, rim, scratch .wav
│       └── loops/              ← (drop loop samples here)
└── src/
    ├── rhythm-sequence-editor.js    ← Editor UI controller
    ├── rhythm-sequence-editor.css   ← Editor styles
    └── audio/
        ├── rhythm-api.js            ← ★ Game-facing API (only import needed by game)
        ├── rhythm-engine.js         ← Core scheduling engine (Web Audio)
        ├── rhythm-layer-mixer.js    ← Multi-stem layer manager
        ├── rhythm-events.js         ← Event emitter (beat/bar/phrase/section)
        ├── rhythm-config.js         ← Config schema, normalizers, constants
        └── rhythm-arrangement.js    ← Velocity / groove / arrangement curves
```

---

## Roadmap

### ✅ Done
- [x] Step sequencer — 16 steps × N bars × 8 loop slots
- [x] Pattern tracks: Bass, Kick, Snare, Hat, Rim
- [x] Generated tracks: Pluck, Funk, Pad, LFO, 808 variants, Echo, Space
- [x] Per-step controls: velocity, pitch, offset, attack, delay, LFO, dub echo
- [x] BPM transport widget (40–220, always visible, two-way sync)
- [x] Swing, humanize, dub throw, duck-hold echo
- [x] Zoom controls (1×/2×/4×/8×)
- [x] Save / Load / Copy JSON
- [x] Loop region editor UI (drag, resize, chop lines)
- [x] Game API facade (`rhythm-api.js`) with beat/bar/phrase events
- [x] Multi-stem layer mixer (`rhythm-layer-mixer.js`)
- [x] Standalone server + project separation from game repo

### 🔜 Next
- [ ] **Loop chopper** — audio engine playback of loop regions with time-stretch
- [ ] **Piano roll** — per-track note capture, MIDI-style lane editor
- [ ] **Waveform preview** — render AudioBuffer waveform in loop lane
- [ ] **Manual chop placement** — click-to-add chop lines in waveform view
- [ ] **Transient detection** — auto-chop on transients
- [ ] **Per-region pitch/stretch** — crunch, granular time-stretch
- [ ] **MIDI input** — live note capture from external controller
- [ ] **Song arranger** — arrange loop slots into a full song timeline
- [ ] **Export stems** — offline render individual tracks to WAV
- [ ] **Preset browser** — save / recall / share beat presets

---

## Game integration

See [GAME_API.md](./GAME_API.md) for the full public API contract.

```js
import { createRhythmAPI } from "./rhythm-artist/src/audio/rhythm-api.js";

const music = createRhythmAPI({ volume: 0.6 });
await music.start();

music.on("bar", ({ phraseBar }) => {
  if (phraseBar === 16) music.layers.fadeLayer("choir", 1, 2);
});

music.update({ danger: 0.8, moving: true });
```
