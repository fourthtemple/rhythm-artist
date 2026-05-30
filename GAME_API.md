# Kamorebi Cats – Rhythm Engine Game API

This document is the public contract between the **rhythm sequencer** and any
game (or other consumer) that drives it at runtime.

---

## Import

```js
import { createRhythmAPI } from "./src/audio/rhythm-api.js";
```

The sequencer's editor UI, config files, and internal engine are all separate
concerns. The game only needs this single entry point.

---

## Quick-start

```js
const music = createRhythmAPI({ volume: 0.6 });

// Must be called from a user gesture (click / keydown)
await music.start();

// React to the timeline
music.on("bar", ({ phraseBar, bpm }) => {
  console.log(`bar ${phraseBar} at ${bpm} BPM`);
});

// Drive intensity each frame
requestAnimationFrame(function loop() {
  music.update({
    moving:   player.isMoving,
    airborne: player.isAirborne,
    danger:   enemies.nearbyCount / 10,
    progress: level.completionRatio
  });
  requestAnimationFrame(loop);
});
```

---

## API reference

### `createRhythmAPI(opts?) → RhythmAPI`

Factory function. `opts` are all optional:

| Field    | Type     | Default          | Description                            |
|----------|----------|------------------|----------------------------------------|
| `config` | `object` | built-in default | Full rhythm config (patterns, BPM, FX) |
| `style`  | `string` | `"jazz"`         | Starting pattern style                 |
| `volume` | `number` | `0.55`           | Master volume 0–1                      |

---

### Lifecycle

| Method                            | Description                                              |
|-----------------------------------|----------------------------------------------------------|
| `start({ style?, volume?, phraseBar? })` | Begin playback. Resume if already started.     |
| `stop()`                          | Fade out and halt the scheduler.                         |
| `pause()`                         | Alias for `stop()`.                                      |
| `seekToBar(phraseBar)`            | Jump to a bar number inside the current loop.            |

---

### Game-state integration

```js
music.update(gameState)
```

Call every frame (or on state changes). All fields are optional:

| Field           | Type      | Effect                                        |
|-----------------|-----------|-----------------------------------------------|
| `enabled`       | `boolean` | `false` → stops music                         |
| `style`         | `string`  | Change pattern style (queued to next section) |
| `moving`        | `boolean` | +intensity                                    |
| `airborne`      | `boolean` | +intensity (jump)                             |
| `danger`        | `0–1`     | +intensity (scales with enemy proximity)      |
| `progress`      | `0–1`     | +intensity (level progress)                   |
| `ducking`       | `boolean` | Triggers duck-hold echo effect                |
| `duckResetReady`| `boolean` | Re-arms the duck effect                       |
| `bossLanded`    | `boolean` | Triggers boss-landed accent                   |

Intensity is smoothly interpolated frame-to-frame. It drives BPM
micro-variation, pattern density tiers, and FX depth.

---

### Transport & volume

| Method/Getter              | Description                                      |
|----------------------------|--------------------------------------------------|
| `isPlaying` (getter)       | `true` if sequencer is running                   |
| `setVolume(v, { immediate? })` | Smooth or immediate master volume change     |
| `volume` (getter)          | Current volume value                             |
| `setStyle(style)`          | Queue a pattern style change                     |
| `getState()`               | `{ playing, step, barIndex, phraseBar, intensity, bpm }` |

---

### One-shot accents

| Method                        | Description                              |
|-------------------------------|------------------------------------------|
| `triggerDubThrow()`           | Space-drop / dub echo throw              |
| `triggerBossLanded()`         | Boss-landed impact accent                |
| `triggerHitImpact(gain?)`     | Player-hit impact accent                 |

---

### Timeline events

```js
const off = music.on(eventName, handler);
// later:
off();   // unsubscribe
```

| Event     | Payload                                                            | Fires when…                          |
|-----------|--------------------------------------------------------------------|--------------------------------------|
| `"beat"`  | `{ step, bar, phraseBar, time, scheduledTime, bpm, style, intensity }` | Every sequencer step (16/bar)    |
| `"bar"`   | same as beat                                                       | Step 0 of each bar                   |
| `"phrase"`| same as beat                                                       | Bar 0 of each 32-bar phrase          |
| `"section"`| `{ from, to, bar, time }`                                         | Pattern style (intensity tier) change|
| `"play"`  | `{ playing, step, … }`                                             | Sequencer starts                     |
| `"stop"`  | same                                                               | Sequencer stops                      |
| `"config"`| `{ config }`                                                       | Config replaced via `setConfig()`    |

> **Timing note**: `time` is the raw AudioContext time the step was *scheduled*
> — which is slightly in the future. Use it to synchronise Web Audio nodes.
> For visual sync use `requestAnimationFrame` and compare to `getState()`.

---

### Layer mixer (`music.layers`)

Manage audio stems, loops, and one-shots that live alongside the sequencer
and share its master gain chain.

```js
// Load a looping stem
await music.layers.loadLayer("strings", "./assets/audio/stems/strings.wav", {
  loop: true,
  gain: 0,          // start silent
  autoPlay: true
});

// Fade it in at bar 8
music.on("bar", ({ phraseBar }) => {
  if (phraseBar === 8) music.layers.fadeLayer("strings", 0.7, 2.0);
});

// Crossfade to a different layer
music.on("bar", ({ phraseBar }) => {
  if (phraseBar === 24) {
    music.layers.fadeLayer("strings", 0, 1.5);
    music.layers.fadeLayer("choir",   1, 1.5);
  }
});
```

| Method                                            | Description                                       |
|---------------------------------------------------|---------------------------------------------------|
| `loadLayer(id, url, opts?)`                       | Fetch, decode, register. Returns `Promise<void>`  |
| `registerLayer(id, audioBuffer, opts?)`           | Register a pre-decoded buffer                     |
| `playLayer(id, { when?, offset? })`               | Start playback                                    |
| `stopLayer(id, when?)`                            | Stop (optionally scheduled)                       |
| `stopAll(when?)`                                  | Stop all layers                                   |
| `removeLayer(id)`                                 | Stop and remove a layer                           |
| `setLayerGain(id, gain)`                          | Set gain immediately                              |
| `fadeLayer(id, targetGain, durationSeconds)`      | Linear ramp to target gain                        |
| `muteLayer(id)` / `unmuteLayer(id)`               | Mute/unmute (remembers gain)                      |
| `toggleMute(id)`                                  | Toggle mute, returns new state                    |
| `soloLayer(id)` / `unsoloLayer(id)`               | Solo one layer (silences others)                  |
| `clearSolo()`                                     | Remove all solos                                  |
| `layerIds` (getter)                               | `string[]` of all registered layer IDs           |
| `isPlaying(id)` / `isMuted(id)`                   | State queries                                     |
| `getLayerGain(id)`                                | Current gain value (pre-mute/solo)                |
| `getSnapshot()`                                   | `LayerSnapshot[]` — all layer states at once      |

`loadLayer` options:

| Field      | Type      | Default | Description                         |
|------------|-----------|---------|-------------------------------------|
| `gain`     | `number`  | `1`     | Initial volume 0–2                  |
| `loop`     | `boolean` | `false` | Loop the buffer                     |
| `loopStart`| `number`  | `0`     | Loop start (seconds)                |
| `loopEnd`  | `number`  | `0`     | Loop end (0 = buffer end)           |
| `delaySend`| `number`  | `0`     | Reserved for future FX routing      |
| `reverbSend`| `number` | `0`     | Reserved for future FX routing      |
| `autoPlay` | `boolean` | `false` | Start immediately after loading     |

---

### Config

```js
// Load a saved sequence from the editor
const response = await fetch("./assets/game/rhythm-sequence.json");
const config = await response.json();
music.setConfig(config);

// Or snapshot the current live config
const snapshot = music.exportConfig();
```

---

### Escape hatch

```js
music.engine   // → RhythmEngine (full internal access)
```

Prefer the API methods above. Use this only when you need something the
API doesn't yet expose.

---

## Separating the sequencer into its own package

When the sequencer is ready to be its own npm package the boundary is clean:

```
rhythm-engine-pkg/
  src/
    audio/
      rhythm-api.js          ← game imports this
      rhythm-engine.js
      rhythm-layer-mixer.js
      rhythm-events.js
      rhythm-config.js
      rhythm-arrangement.js
  editor/
    rhythm-sequence-editor.html
    rhythm-sequence-editor.js
    rhythm-sequence-editor.css
  assets/
    audio/drums/…
```

The game imports `rhythm-api.js`. The editor imports `rhythm-engine.js` directly
(it needs internals). The two can live in separate repos linked via a path
alias or `npm link` during development.

---

## Example: full scene integration (Phaser 3)

```js
// In your Phaser Scene:
import { createRhythmAPI } from "../audio/rhythm-api.js";

export class GameScene extends Phaser.Scene {
  async create() {
    this.music = createRhythmAPI({ volume: 0.6 });

    // Load stems in parallel with other assets
    await Promise.all([
      this.music.layers.loadLayer("bass-stem",  "assets/audio/stems/bass.wav",  { loop: true }),
      this.music.layers.loadLayer("lead-stem",  "assets/audio/stems/lead.wav",  { loop: true, gain: 0 }),
      this.music.layers.loadLayer("choir-stem", "assets/audio/stems/choir.wav", { loop: true, gain: 0 })
    ]);

    // Sync visual effects to the bar
    this.music.on("bar",    ({ phraseBar }) => this.onBar(phraseBar));
    this.music.on("beat",   ({ step })      => this.onBeat(step));
    this.music.on("section",({ to })        => this.onSection(to));
  }

  onPointerDown() {
    // First user gesture — safe to start AudioContext
    this.music.start();
    this.music.layers.playLayer("bass-stem");
  }

  onBar(phraseBar) {
    if (phraseBar === 16) {
      // Bring in lead halfway through the phrase
      this.music.layers.fadeLayer("lead-stem", 0.85, 2.0);
    }
  }

  onBeat(step) {
    if (step === 0) this.cameras.main.flash(40, 255, 200, 80);
  }

  onSection(to) {
    console.log("intensity tier →", to);
  }

  update() {
    this.music.update({
      moving:   this.player.body.velocity.length() > 10,
      airborne: !this.player.body.onFloor(),
      danger:   this.enemies.dangerLevel,
      progress: this.level.progress
    });
  }
}
```
