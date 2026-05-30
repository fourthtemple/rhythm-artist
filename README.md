# Rhythm Artist

A browser-based beat making tool. Build drum patterns and basslines on a step sequencer, shape each hit with per-note controls (velocity, pitch, offset, attack, delay, LFO wobble, dub echo), and mix everything through a global EQ and per-track send/return effects (delay, reverb). Load audio loops, chop them into regions, and layer them alongside the sequenced tracks. BPM, time signature, and bar count are all adjustable on the fly. Patterns are saved as plain JSON and can be loaded straight into a game via the included API.

## Quick start

```sh
node scripts/dev-server.mjs
# open http://localhost:3000
```

No build step. Pure ES modules. No framework dependencies.

## Game integration

See [GAME_API.md](./GAME_API.md) for the full public API.

```js
import { createRhythmAPI } from "./rhythm-artist/src/audio/rhythm-api.js";

const music = createRhythmAPI({ volume: 0.6 });
await music.start();

music.on("bar", ({ phraseBar }) => {
  if (phraseBar === 16) music.layers.fadeLayer("choir", 1, 2);
});

music.update({ danger: 0.8, moving: true });
```
