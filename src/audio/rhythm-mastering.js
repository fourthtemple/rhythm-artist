// ════════════════════════════════════════════════════════════════════════
// Master bus mastering chain: a multi-band parametric EQ ("mastering curve")
// feeding a spectrum AnalyserNode. Self-contained so the engine just wires its
// master output through `input` and out of `output`, and the UI reads the
// analyser to draw a live spectrum + drag the EQ bands by Hz range.
// ════════════════════════════════════════════════════════════════════════

const finite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (value, min, max, fallback = 0) =>
  Math.max(min, Math.min(max, finite(value, fallback)));

/**
 * The fixed band layout of the mastering EQ. Each band is one BiquadFilter.
 * `gain` (dB) is the only user-tweakable value per band; frequency & Q are
 * fixed so the UI maps cleanly onto the Hz axis of the spectrum.
 * @typedef {{ id: string, label: string, type: BiquadFilterType, frequency: number, q: number }} MasterEqBandDef
 */
export const MASTER_EQ_BANDS = /** @type {MasterEqBandDef[]} */ ([
  { id: "sub", label: "Sub", type: "lowshelf", frequency: 70, q: 0.7 },
  { id: "low", label: "Low", type: "peaking", frequency: 180, q: 0.9 },
  { id: "lowMid", label: "Low Mid", type: "peaking", frequency: 500, q: 1.0 },
  { id: "mid", label: "Mid", type: "peaking", frequency: 1400, q: 1.0 },
  { id: "highMid", label: "High Mid", type: "peaking", frequency: 3500, q: 1.0 },
  { id: "high", label: "Air", type: "highshelf", frequency: 9000, q: 0.7 }
]);

export const MASTER_EQ_GAIN_MIN = -18;
export const MASTER_EQ_GAIN_MAX = 18;

/** Default (flat) mastering curve: every band at 0 dB. */
export function defaultMasterEq() {
  const eq = {};
  MASTER_EQ_BANDS.forEach((band) => { eq[band.id] = 0; });
  return eq;
}

/**
 * Coerce an arbitrary object into a valid master-EQ map (every band present,
 * clamped to the gain range). Unknown keys are dropped.
 */
export function normalizeMasterEq(input = {}) {
  const eq = defaultMasterEq();
  if (input && typeof input === "object") {
    MASTER_EQ_BANDS.forEach((band) => {
      if (input[band.id] !== undefined) {
        eq[band.id] = clamp(input[band.id], MASTER_EQ_GAIN_MIN, MASTER_EQ_GAIN_MAX, 0);
      }
    });
  }
  return eq;
}

/**
 * Builds and owns the master EQ + analyser node graph for a single
 * AudioContext. Chain: input → band[0] → … → band[n] → analyser → output.
 */
export class MasteringChain {
  /**
   * @param {AudioContext} context
   * @param {Record<string, number>} [eq] initial per-band gain (dB)
   */
  constructor(context, eq = {}) {
    this.context = context;
    /** @type {BiquadFilterNode[]} */
    this.filters = MASTER_EQ_BANDS.map((band) => {
      const filter = context.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = band.frequency;
      filter.Q.value = band.q;
      filter.gain.value = 0;
      return filter;
    });

    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;
    this.analyser.minDecibels = -96;
    this.analyser.maxDecibels = -10;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

    // Public connection points.
    this.input = this.filters[0];
    this.output = this.analyser;

    // Wire the internal chain: band → band → … → analyser.
    for (let i = 0; i < this.filters.length - 1; i += 1) {
      this.filters[i].connect(this.filters[i + 1]);
    }
    this.filters[this.filters.length - 1].connect(this.analyser);

    this.setEq(eq);
  }

  /** Apply a whole EQ map (smoothed to avoid zipper noise). */
  setEq(eq = {}) {
    const normalized = normalizeMasterEq(eq);
    MASTER_EQ_BANDS.forEach((band, index) => {
      this.setBand(band.id, normalized[band.id]);
    });
    return normalized;
  }

  /** Set a single band's gain in dB. */
  setBand(bandId, gainDb) {
    const index = MASTER_EQ_BANDS.findIndex((b) => b.id === bandId);
    if (index < 0) return;
    const value = clamp(gainDb, MASTER_EQ_GAIN_MIN, MASTER_EQ_GAIN_MAX, 0);
    const node = this.filters[index];
    if (this.context) {
      node.gain.setTargetAtTime(value, this.context.currentTime, 0.03);
    } else {
      node.gain.value = value;
    }
  }

  /** Read the latest spectrum into the shared byte buffer and return it. */
  getFrequencyData() {
    this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }

  /** Nyquist frequency (Hz) for mapping bins → Hz on the UI axis. */
  get nyquist() {
    return this.context ? this.context.sampleRate / 2 : 22050;
  }

  /** Disconnect every owned node (called when rebuilding the engine). */
  dispose() {
    this.filters.forEach((filter) => {
      try { filter.disconnect(); } catch { /* already gone */ }
    });
    try { this.analyser.disconnect(); } catch { /* already gone */ }
  }
}
