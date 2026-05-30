/**
 * rhythm-api.js
 *
 * ══════════════════════════════════════════════════════════════
 *  Public game-facing API for the Kamorebi Cats rhythm engine.
 * ══════════════════════════════════════════════════════════════
 *
 * This module is the ONLY import the game engine needs.
 * It wraps RhythmEngine + RhythmLayerMixer behind a stable,
 * intention-driven interface so the internal sequencer can
 * evolve without breaking game code.
 *
 * ── Quick-start ───────────────────────────────────────────────
 *
 *   import { createRhythmAPI } from "./src/audio/rhythm-api.js";
 *
 *   const music = createRhythmAPI();
 *   await music.start();
 *
 *   // React to the beat:
 *   music.on("bar", ({ phraseBar, bpm }) => {
 *     console.log("bar", phraseBar, "at", bpm, "bpm");
 *   });
 *
 *   // Drive intensity from game state:
 *   music.update({ danger: 0.8, moving: true });
 *
 *   // Layer a stem in at bar 8:
 *   music.on("bar", ({ phraseBar }) => {
 *     if (phraseBar === 8) music.layers.playLayer("strings");
 *   });
 *
 * ── Events ────────────────────────────────────────────────────
 *   "beat"    { step, bar, phraseBar, time, scheduledTime, bpm, style, intensity }
 *   "bar"     same payload, fires at step 0 of each bar
 *   "phrase"  same payload, fires at phraseBar 0
 *   "section" { from, to, bar, time }   — intensity tier change
 *   "play"    { playing, … }
 *   "stop"    { playing, … }
 *   "config"  { config }
 *
 * ── Intensity model ───────────────────────────────────────────
 *   update() accepts the same game-state object as RhythmEngine.update()
 *   and maps it to a 0-1 intensity that drives BPM micro-variation,
 *   pattern density, and FX depth automatically.
 *
 * ── Layer mixer ───────────────────────────────────────────────
 *   music.layers  →  RhythmLayerMixer instance
 *   Load stems, loops, and one-shots. Mute/solo/fade each layer
 *   independently. They all share the engine's master gain chain.
 */

import { RhythmEngine, DEFAULT_RHYTHM_CONFIG } from "./rhythm-engine.js";
import { RhythmLayerMixer } from "./rhythm-layer-mixer.js";
import { normalizeRhythmConfig } from "./rhythm-config.js";

// ── Factory ──────────────────────────────────────────────────

/**
 * Create a ready-to-use RhythmAPI instance.
 *
 * @param {RhythmAPIOptions} [opts]
 * @returns {RhythmAPI}
 */
export function createRhythmAPI(opts = {}) {
  return new RhythmAPI(opts);
}

// Re-export engine primitives for consumers that need them
export { DEFAULT_RHYTHM_CONFIG, normalizeRhythmConfig };

// ── RhythmAPI class ──────────────────────────────────────────

export class RhythmAPI {
  /**
   * @param {RhythmAPIOptions} opts
   */
  constructor({
    config = DEFAULT_RHYTHM_CONFIG,
    style = "jazz",
    volume = 0.55
  } = {}) {
    this._engine = new RhythmEngine({ config, style, volume });
    this._layers = new RhythmLayerMixer(this._engine);
    this._volume = volume;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  /**
   * Start the sequencer. Safe to call repeatedly (resumes if suspended).
   * Must be called from a user-gesture context the first time.
   *
   * @param {StartOptions} [opts]
   * @returns {Promise<void>}
   */
  async start({ style, volume, phraseBar = 0 } = {}) {
    if (volume != null) this._volume = volume;
    await this._engine.start({
      style: style ?? this._engine.style,
      volume: this._volume,
      phraseBar
    });
  }

  /**
   * Stop the sequencer gracefully (fades master gain to 0).
   */
  stop() {
    this._engine.stop();
  }

  /**
   * Pause — identical to stop() for now; AudioContext stays alive.
   */
  pause() {
    this._engine.stop();
  }

  /**
   * Seek to a specific bar inside the current phrase loop.
   * @param {number} phraseBar
   */
  seekToBar(phraseBar) {
    this._engine.seekToPhraseBar(phraseBar);
  }

  // ── Game-state driven intensity ────────────────────────────

  /**
   * Call every game frame (or on significant state changes).
   * The engine smoothly interpolates intensity based on these inputs.
   *
   * @param {GameState} state
   */
  update(state = {}) {
    this._engine.update(state);
  }

  // ── Transport ──────────────────────────────────────────────

  /** @returns {boolean} */
  get isPlaying() { return this._engine.playing; }

  /**
   * Set the master output volume.
   * @param {number} volume  0–1
   * @param {{ immediate?: boolean }} [opts]
   */
  setVolume(volume, opts) {
    this._volume = Math.max(0, Math.min(1, volume));
    this._engine.setVolume(this._volume, opts);
  }

  /** @returns {number} current volume */
  get volume() { return this._volume; }

  /**
   * Switch pattern style. Change takes effect on the next section boundary.
   * @param {string} style
   */
  setStyle(style) {
    this._engine.setStyle(style);
  }

  /**
   * Trigger the "dub throw" space-drop effect immediately.
   */
  triggerDubThrow() {
    this._engine.triggerDubThrow();
  }

  /**
   * Trigger a boss-landed impact accent.
   */
  triggerBossLanded() {
    this._engine.accentBossLanded();
  }

  /**
   * Trigger a hit-impact accent (e.g. player takes damage).
   * @param {number} [gain]
   */
  triggerHitImpact(gain) {
    this._engine.accentImpact(gain);
  }

  // ── Config ─────────────────────────────────────────────────

  /**
   * Bulk-replace the rhythm config (patterns, BPM, FX settings…).
   * Fires the "config" event.
   * @param {object} config
   */
  setConfig(config) {
    this._engine.setConfig(config);
  }

  /**
   * Return a deep clone of the current config, safe to mutate.
   * @returns {object}
   */
  exportConfig() {
    return this._engine.exportConfig();
  }

  // ── Timeline events ────────────────────────────────────────

  /**
   * Subscribe to a sequencer event.
   *
   * @param {"beat"|"bar"|"phrase"|"section"|"play"|"stop"|"config"} event
   * @param {Function} handler
   * @returns {() => void}  call to unsubscribe
   *
   * @example
   * const off = music.on("bar", ({ phraseBar }) => {
   *   if (phraseBar === 16) music.layers.fadeLayer("choir", 1, 2);
   * });
   * // later: off();  // stop listening
   */
  on(event, handler) {
    return this._engine.on(event, handler);
  }

  /** Subscribe once (auto-removed after first fire). */
  once(event, handler) {
    return this._engine.once(event, handler);
  }

  /** Unsubscribe a specific handler. */
  off(event, handler) {
    this._engine.off(event, handler);
  }

  // ── Playback state ─────────────────────────────────────────

  /**
   * Current playback state snapshot.
   * @returns {{ playing, step, barIndex, phraseBar, intensity, bpm }}
   */
  getState() {
    const s = this._engine.getPlaybackState();
    return {
      ...s,
      bpm: this._engine.currentBpm()
    };
  }

  // ── Layer mixer ────────────────────────────────────────────

  /**
   * The layer mixer — load, play, fade, mute, solo audio stems.
   * @type {RhythmLayerMixer}
   */
  get layers() { return this._layers; }

  // ── Direct engine access (escape hatch) ───────────────────

  /**
   * Direct access to the underlying RhythmEngine.
   * Use sparingly — prefer the API methods above.
   * @type {RhythmEngine}
   */
  get engine() { return this._engine; }
}

// ── Type docs ────────────────────────────────────────────────

/**
 * @typedef {Object} RhythmAPIOptions
 * @property {object}  [config]   Rhythm config (patterns, BPM, FX…)
 * @property {string}  [style]    Pattern style key, default "jazz"
 * @property {number}  [volume]   Master volume 0–1, default 0.55
 */

/**
 * @typedef {Object} StartOptions
 * @property {string} [style]
 * @property {number} [volume]
 * @property {number} [phraseBar]
 */

/**
 * @typedef {Object} GameState
 * @property {boolean} [enabled=true]
 * @property {string}  [style]
 * @property {boolean} [moving=false]
 * @property {boolean} [ducking=false]
 * @property {boolean} [duckResetReady]
 * @property {boolean} [airborne=false]
 * @property {number}  [danger=0]       0–1 danger level → drives intensity
 * @property {number}  [progress=0]     0–1 level progress → drives intensity
 * @property {boolean} [bossLanded=false]
 */
