/**
 * rhythm-layer-mixer.js
 *
 * Manages N named "layers" (stems, loops, one-shots, pads) that share a
 * single AudioContext routed through RhythmEngine's master chain.
 *
 * Each layer has:
 *   - an AudioBufferSourceNode or a looping OscillatorNode
 *   - an individual GainNode for volume/mute/solo
 *   - a send to the engine's existing delay/reverb bus (optional)
 *
 * Usage:
 *   const mixer = new RhythmLayerMixer(engine);
 *   await mixer.loadLayer("strings", "./assets/audio/stems/strings.wav", { loop: true, gain: 0.7 });
 *   mixer.setLayerGain("strings", 0.4);
 *   mixer.fadeLayer("strings", 0, 2.5);   // fade to 0 over 2.5 s
 *   mixer.muteLayer("drums");
 *   mixer.soloLayer("bass");
 *   mixer.clearSolo();
 */

export class RhythmLayerMixer {
  /**
   * @param {import("./rhythm-engine.js").RhythmEngine} engine
   */
  constructor(engine) {
    this._engine = engine;
    /** @type {Map<string, LayerState>} */
    this._layers = new Map();
    this._soloSet = new Set();
  }

  // ── Layer management ────────────────────────────────────────

  /**
   * Load an audio file and register it as a named layer.
   *
   * @param {string} id          Unique layer name, e.g. "strings"
   * @param {string} url         URL to an audio file
   * @param {LayerOptions} opts
   * @returns {Promise<void>}
   */
  async loadLayer(id, url, {
    gain = 1,
    loop = false,
    loopStart = 0,
    loopEnd = 0,
    delaySend = 0,
    reverbSend = 0,
    autoPlay = false
  } = {}) {
    await this._engine.ensureContext();
    const ctx = this._engine.context;

    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    // Tear down any previous layer with the same id cleanly
    this.removeLayer(id);

    const gainNode = ctx.createGain();
    gainNode.gain.value = gain;
    gainNode.connect(this._engine.masterGain ?? ctx.destination);

    /** @type {LayerState} */
    const state = {
      id,
      url,
      audioBuffer,
      gainNode,
      sourceNode: null,
      gain,
      muted: false,
      loop,
      loopStart,
      loopEnd,
      delaySend,
      reverbSend,
      playing: false,
      startTime: 0,
      offset: 0
    };
    this._layers.set(id, state);

    if (autoPlay) this.playLayer(id);
  }

  /**
   * Register a layer from an already-decoded AudioBuffer (useful when the
   * game engine has already loaded assets).
   */
  registerLayer(id, audioBuffer, opts = {}) {
    const { gain = 1, loop = false, loopStart = 0, loopEnd = 0,
            delaySend = 0, reverbSend = 0 } = opts;
    const ctx = this._engine.context;
    if (!ctx) throw new Error("RhythmEngine AudioContext not ready. Call engine.ensureContext() first.");

    this.removeLayer(id);

    const gainNode = ctx.createGain();
    gainNode.gain.value = gain;
    gainNode.connect(this._engine.masterGain ?? ctx.destination);

    this._layers.set(id, {
      id, url: null, audioBuffer, gainNode, sourceNode: null,
      gain, muted: false, loop, loopStart, loopEnd,
      delaySend, reverbSend, playing: false, startTime: 0, offset: 0
    });
  }

  /**
   * Start playback of a layer.
   * @param {string} id
   * @param {{ when?: number, offset?: number }} opts
   */
  playLayer(id, { when = 0, offset = 0 } = {}) {
    const layer = this._layers.get(id);
    if (!layer) { console.warn(`[LayerMixer] Unknown layer "${id}"`); return; }
    const ctx = this._engine.context;
    if (!ctx) return;

    // Stop any running source first
    this._stopSource(layer);

    const src = ctx.createBufferSource();
    src.buffer = layer.audioBuffer;
    src.loop = layer.loop;
    if (layer.loop && layer.loopEnd > 0) {
      src.loopStart = layer.loopStart;
      src.loopEnd = layer.loopEnd;
    }
    src.connect(layer.gainNode);
    src.onended = () => {
      if (layer.sourceNode === src) {
        layer.playing = false;
        layer.sourceNode = null;
      }
    };

    const startAt = when > 0 ? when : ctx.currentTime;
    src.start(startAt, offset);
    layer.sourceNode = src;
    layer.playing = true;
    layer.startTime = startAt;
    layer.offset = offset;
  }

  /**
   * Stop a layer immediately (or at a given AudioContext time).
   * @param {string} id
   * @param {number} [when]
   */
  stopLayer(id, when) {
    const layer = this._layers.get(id);
    if (!layer) return;
    this._stopSource(layer, when);
    layer.playing = false;
  }

  /** Stop all layers. */
  stopAll(when) {
    for (const id of this._layers.keys()) this.stopLayer(id, when);
  }

  /** Remove and clean up a layer entirely. */
  removeLayer(id) {
    const layer = this._layers.get(id);
    if (!layer) return;
    this._stopSource(layer);
    layer.gainNode.disconnect();
    this._layers.delete(id);
    this._soloSet.delete(id);
    this._applySolo();
  }

  // ── Per-layer controls ──────────────────────────────────────

  /**
   * Set layer volume immediately.
   * @param {string} id
   * @param {number} gain  0–2 (1 = unity)
   */
  setLayerGain(id, gain) {
    const layer = this._layers.get(id);
    if (!layer) return;
    layer.gain = Math.max(0, gain);
    if (!layer.muted && !this._isSoloBlocked(id)) {
      const ctx = this._engine.context;
      layer.gainNode.gain.setTargetAtTime(layer.gain, ctx?.currentTime ?? 0, 0.015);
    }
  }

  /**
   * Smooth fade to a target gain over durationSeconds.
   * @param {string} id
   * @param {number} targetGain
   * @param {number} durationSeconds
   */
  fadeLayer(id, targetGain, durationSeconds = 1) {
    const layer = this._layers.get(id);
    if (!layer) return;
    layer.gain = Math.max(0, targetGain);
    const ctx = this._engine.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    layer.gainNode.gain.cancelScheduledValues(now);
    layer.gainNode.gain.setValueAtTime(layer.gainNode.gain.value, now);
    layer.gainNode.gain.linearRampToValueAtTime(layer.gain, now + durationSeconds);
  }

  /**
   * Mute a layer (gain → 0, remembers previous gain).
   */
  muteLayer(id) {
    const layer = this._layers.get(id);
    if (!layer || layer.muted) return;
    layer.muted = true;
    const ctx = this._engine.context;
    layer.gainNode.gain.setTargetAtTime(0, ctx?.currentTime ?? 0, 0.02);
  }

  /**
   * Unmute a layer.
   */
  unmuteLayer(id) {
    const layer = this._layers.get(id);
    if (!layer || !layer.muted) return;
    layer.muted = false;
    if (!this._isSoloBlocked(id)) {
      const ctx = this._engine.context;
      layer.gainNode.gain.setTargetAtTime(layer.gain, ctx?.currentTime ?? 0, 0.02);
    }
  }

  /** Toggle mute. Returns new mute state. */
  toggleMute(id) {
    const layer = this._layers.get(id);
    if (!layer) return false;
    if (layer.muted) this.unmuteLayer(id);
    else this.muteLayer(id);
    return layer.muted;
  }

  /**
   * Solo one layer — silences all others.
   */
  soloLayer(id) {
    if (!this._layers.has(id)) return;
    this._soloSet.add(id);
    this._applySolo();
  }

  /** Remove solo from a layer. */
  unsoloLayer(id) {
    this._soloSet.delete(id);
    this._applySolo();
  }

  /** Clear all solos. */
  clearSolo() {
    this._soloSet.clear();
    this._applySolo();
  }

  // ── Querying ────────────────────────────────────────────────

  /** @returns {string[]} IDs of all registered layers */
  get layerIds() { return [...this._layers.keys()]; }

  /** @returns {boolean} */
  isPlaying(id) { return this._layers.get(id)?.playing ?? false; }

  /** @returns {boolean} */
  isMuted(id) { return this._layers.get(id)?.muted ?? false; }

  /** @returns {number} current gain value (before mute/solo) */
  getLayerGain(id) { return this._layers.get(id)?.gain ?? 0; }

  /**
   * Get a read-only snapshot of all layer states.
   * @returns {LayerSnapshot[]}
   */
  getSnapshot() {
    return [...this._layers.values()].map((l) => ({
      id: l.id,
      gain: l.gain,
      muted: l.muted,
      solo: this._soloSet.has(l.id),
      playing: l.playing
    }));
  }

  // ── Internal ────────────────────────────────────────────────

  _stopSource(layer, when) {
    const src = layer.sourceNode;
    if (!src) return;
    try {
      if (when != null) src.stop(when);
      else src.stop();
    } catch (_) { /* already stopped */ }
    layer.sourceNode = null;
  }

  _isSoloBlocked(id) {
    return this._soloSet.size > 0 && !this._soloSet.has(id);
  }

  _applySolo() {
    const ctx = this._engine.context;
    const now = ctx?.currentTime ?? 0;
    const hasSolo = this._soloSet.size > 0;
    for (const [id, layer] of this._layers) {
      const blocked = hasSolo && !this._soloSet.has(id);
      const targetGain = (layer.muted || blocked) ? 0 : layer.gain;
      layer.gainNode.gain.setTargetAtTime(targetGain, now, 0.02);
    }
  }
}

/**
 * @typedef {Object} LayerOptions
 * @property {number}  [gain=1]
 * @property {boolean} [loop=false]
 * @property {number}  [loopStart=0]
 * @property {number}  [loopEnd=0]
 * @property {number}  [delaySend=0]
 * @property {number}  [reverbSend=0]
 * @property {boolean} [autoPlay=false]
 */

/**
 * @typedef {Object} LayerSnapshot
 * @property {string}  id
 * @property {number}  gain
 * @property {boolean} muted
 * @property {boolean} solo
 * @property {boolean} playing
 */

/**
 * @typedef {Object} LayerState
 * @property {string}  id
 * @property {string|null} url
 * @property {AudioBuffer} audioBuffer
 * @property {GainNode} gainNode
 * @property {AudioBufferSourceNode|null} sourceNode
 * @property {number}  gain
 * @property {boolean} muted
 * @property {boolean} loop
 * @property {number}  loopStart
 * @property {number}  loopEnd
 * @property {number}  delaySend
 * @property {number}  reverbSend
 * @property {boolean} playing
 * @property {number}  startTime
 * @property {number}  offset
 */
