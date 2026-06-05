export const STYLE_ORDER = ["jazz"];
export const PHRASE_BARS = 32;
export const MAX_SEQUENCE_BARS = PHRASE_BARS * 8;
export const SECTION_BARS = 8;
export const MIN_VERSE_BARS = 1;
export const MAX_VERSE_BARS = 64;
export const MIN_SECTION_BARS = 1;
export const MAX_SECTION_BARS = 32;
export const DEFAULT_TRACK_STEPS_PER_BAR = 16;
export const DEFAULT_TIME_SIGNATURE = "4/4";
export const TIME_SIGNATURE_OPTIONS = ["4/4", "3/4", "6/8", "5/4", "7/8"];
export const SYNTH_ROOT_HZ = 55;
export const SYNTH_SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
export const SEQUENCED_BASS_PHRASE = [0, 3, 5, 2, 7, 5, 3, 10];

import {
  ALL_TRACK_IDS,
  ALL_GENERATED_TRACK_IDS,
  EIGHT_OH_EIGHT_DEFAULT_IDS,
  GENERATED_TRACK_IDS,
  PATTERN_TRACK_IDS,
  TRACK_BUS_SENDS,
  TRACK_LEVELS,
  TRACK_PANS,
  TRACK_REGISTRY,
  TRACK_REVERB_SENDS,
  baseTrackId
} from "./rhythm-track-registry.js";
import { defaultMasterEq, normalizeMasterEq } from "./rhythm-mastering.js";

export {
  TRACK_GROUPS,
  TRACK_REGISTRY,
  TRACK_BY_ID,
  GROUP_BY_ID,
  getTrackDef,
  getGroupDef,
  DEFAULT_GRID_TRACK_IDS,
  TRACK_LABELS,
  TRACK_DEFAULT_VELOCITY,
  tracksByGroup,
  isInstanceId,
  baseTrackId,
  makeInstanceId,
  voiceForTrack
} from "./rhythm-track-registry.js";

// Back-compat aliases — these names are imported across the engine/editor.
export const EIGHT_OH_EIGHT_ROWS = EIGHT_OH_EIGHT_DEFAULT_IDS;
// Every generated row the user can edit on the grid — includes tracks that are
// added later (extra 808 voices, samplers, etc.), not just the default set.
// This is what the engine schedules, so added tracks actually make sound.
export const EDITABLE_GENERATED_ROWS = ALL_GENERATED_TRACK_IDS;
export const RHYTHM_TRACKS = ALL_TRACK_IDS;
export const DEFAULT_TRACK_BUS_SENDS = TRACK_BUS_SENDS;
export const DEFAULT_TRACK_REVERB_SENDS = TRACK_REVERB_SENDS;
export const DEFAULT_TRACK_LEVELS = TRACK_LEVELS;
export const DEFAULT_TRACK_PANS = TRACK_PANS;
export const DEFAULT_SYNTH_LEVEL = 1.45;
export const DUCK_SOUND_REARM_SECONDS = 0.18;

export const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
export const clamp01 = (value) => Math.max(0, Math.min(1, finiteNumber(value, 0)));
export const clamp = (value, min, max, fallback = 0) => Math.max(min, Math.min(max, finiteNumber(value, fallback)));
export const normalizeVerseBars = (value) => Math.max(MIN_VERSE_BARS, Math.min(MAX_VERSE_BARS, Math.round(finiteNumber(value, PHRASE_BARS))));
export const normalizeSectionBars = (value) => Math.max(MIN_SECTION_BARS, Math.min(MAX_SECTION_BARS, Math.round(finiteNumber(value, SECTION_BARS))));
export const sectionBarsForConfig = (config = DEFAULT_RHYTHM_CONFIG) => normalizeSectionBars(config?.barsPerSection);
export const normalizeTimeSignature = (value) => {
  const match = String(value || DEFAULT_TIME_SIGNATURE).trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return DEFAULT_TIME_SIGNATURE;
  const numerator = Math.round(finiteNumber(match[1], 4));
  const denominator = Math.round(finiteNumber(match[2], 4));
  if (numerator < 1 || numerator > 16) return DEFAULT_TIME_SIGNATURE;
  if (![2, 4, 8, 16].includes(denominator)) return DEFAULT_TIME_SIGNATURE;
  return `${numerator}/${denominator}`;
};
export const meterForTimeSignature = (timeSignature = DEFAULT_TIME_SIGNATURE) => {
  const normalized = normalizeTimeSignature(timeSignature);
  const [numerator, denominator] = normalized.split("/").map(Number);
  return {
    timeSignature: normalized,
    numerator,
    denominator,
    beatsPerBar: numerator
  };
};
export const metronomeBeatEventsForStep = (step, stepsPerBar = DEFAULT_TRACK_STEPS_PER_BAR, timeSignature = DEFAULT_TIME_SIGNATURE) => {
  const stepIndex = Math.floor(finiteNumber(step, 0));
  const totalSteps = Math.max(1, Math.round(finiteNumber(stepsPerBar, DEFAULT_TRACK_STEPS_PER_BAR)));
  const { beatsPerBar } = meterForTimeSignature(timeSignature);
  const events = [];
  const epsilon = 0.000001;
  for (let beatIndex = 0; beatIndex < beatsPerBar; beatIndex += 1) {
    const beatStep = (beatIndex * totalSteps) / beatsPerBar;
    if (beatStep >= stepIndex - epsilon && beatStep < stepIndex + 1 - epsilon) {
      events.push({
        beatIndex,
        accent: beatIndex === 0,
        offsetSteps: Math.max(0, beatStep - stepIndex)
      });
    }
  }
  return events;
};
export const visualBeatKindForStep = (visualStep, stepsPerBar = DEFAULT_TRACK_STEPS_PER_BAR, timeSignature = DEFAULT_TIME_SIGNATURE) => {
  const stepIndex = Math.round(finiteNumber(visualStep, 0));
  const totalSteps = Math.max(1, Math.round(finiteNumber(stepsPerBar, DEFAULT_TRACK_STEPS_PER_BAR)));
  const { beatsPerBar } = meterForTimeSignature(timeSignature);
  for (let beatIndex = 0; beatIndex < beatsPerBar; beatIndex += 1) {
    const nearestStep = Math.round((beatIndex * totalSteps) / beatsPerBar);
    if (nearestStep === stepIndex && nearestStep < totalSteps) return beatIndex === 0 ? "bar" : "beat";
  }
  return "0";
};
export const normalizeTrackStepCount = (value) => {
  const requested = Math.round(finiteNumber(value, DEFAULT_TRACK_STEPS_PER_BAR));
  return Math.max(1, Math.min(128, requested));
};
export const normalizePatternStep = (value) => {
  const step = finiteNumber(value, 0);
  if (step <= 0) return 0;
  if (step >= 16) return 15;
  return Number(step.toFixed(4));
};
export const STEP_OPTION_DEFAULTS = {
  pitch: 0,
  offsetMs: 0,
  attackMs: 18,
  delayMs: 0,
  delaySend: 0,
  reverbSend: 0,
  dubEcho: 0,
  wobble: 0
};

export const normalizeStepOptions = (options = {}) => {
  const source = options && typeof options === "object" ? options : {};
  return {
    pitch: Math.round(clamp(source.pitch, -24, 24, STEP_OPTION_DEFAULTS.pitch)),
    offsetMs: Math.round(clamp(source.offsetMs ?? source.offset, -180, 180, STEP_OPTION_DEFAULTS.offsetMs)),
    attackMs: Math.round(clamp(source.attackMs ?? source.attack, 0, 260, STEP_OPTION_DEFAULTS.attackMs)),
    delayMs: Math.round(clamp(source.delayMs ?? source.delay, 0, 640, STEP_OPTION_DEFAULTS.delayMs)),
    delaySend: clamp01(source.delaySend ?? source.echo),
    reverbSend: clamp01(source.reverbSend),
    dubEcho: clamp01(source.dubEcho ?? source.dubEchoAmount ?? source.dub),
    wobble: clamp(source.wobble ?? source.lfo, 0, 4, STEP_OPTION_DEFAULTS.wobble)
  };
};

export const hasStepOptions = (options = {}) => Object.entries(STEP_OPTION_DEFAULTS)
  .some(([key, value]) => Math.abs(finiteNumber(options[key], value) - value) > 0.0001);

// ── Per-track 808 voice shape ────────────────────────────────
// Ranges mirror the global eightOhEight* config knobs. A per-track shape is a
// partial override: only the fields present override the global default.
export const TRACK_SHAPE_RANGES = {
  drive: [0, 1],
  punch: [0, 1],
  decay: [0.3, 2.5],
  tone: [0, 1],
  sub: [0, 1],
  choke: [0, 1]
};

/** Clamp a partial track-shape object, dropping fields outside their range. */
export const normalizeTrackShape = (shape = {}) => {
  const source = shape && typeof shape === "object" ? shape : {};
  const out = {};
  Object.entries(TRACK_SHAPE_RANGES).forEach(([key, [min, max]]) => {
    if (source[key] === undefined || source[key] === null || source[key] === "") return;
    if (key === "choke") {
      out.choke = finiteNumber(source.choke, 0) >= 0.5 ? 1 : 0;
    } else {
      out[key] = Math.max(min, Math.min(max, finiteNumber(source[key], min)));
    }
  });
  return out;
};

const normalizePatternHit = (entry) => {
  if (Array.isArray(entry)) {
    const [step, velocity, options] = entry;
    const normalizedOptions = normalizeStepOptions(options);
    const hit = [
      normalizePatternStep(step),
      clamp01(velocity)
    ];
    if (hasStepOptions(normalizedOptions)) hit.push(normalizedOptions);
    return hit;
  }
  if (entry && typeof entry === "object") {
    const optionSource = entry.options && typeof entry.options === "object"
      ? { ...entry.options, ...entry }
      : entry;
    const normalizedOptions = normalizeStepOptions(optionSource);
    const hit = [
      normalizePatternStep(entry.step),
      clamp01(entry.velocity)
    ];
    if (hasStepOptions(normalizedOptions)) hit.push(normalizedOptions);
    return hit;
  }
  return [0, 0];
};

export const DEFAULT_RHYTHM_CONFIG = {
  drumBusGain: 0.48,
  drumGainCap: 0.44,
  drumLift: 0.78,
  humanizeSeconds: 0.0025,
  synthLevel: 2.72,
  bassLevel: 1.15,
  bassTone: 0.54,
  generatedPluckOffsetMs: 0,
  generatedFunkOffsetMs: 0,
  generatedPadOffsetMs: 0,
  generatedWhaleOffsetMs: 0,
  eightOhEightLevel: 1.5,
  eightOhEightTune: 0,
  // --- 808 voice shaping (Miami bass / classic circuit flavour) ---------
  // Analog-style drive/grit applied across every 808 voice. 0 = clean.
  eightOhEightDrive: 0.18,
  // Transient "snap"/click emphasis — punchier attacks for kick/toms/conga.
  eightOhEightPunch: 0.35,
  // Global tail-length multiplier. >1 = long booming 808 sustain.
  eightOhEightDecay: 1,
  // Global brightness tilt on the noise voices (hat/clap/snare/maraca/cymbal).
  eightOhEightTone: 0.5,
  // Sub "body" emphasis on the kick — the Miami-bass low-end weight.
  eightOhEightSub: 0.45,
  // Choke / monophony: when on, hat + cymbal cut each other off (mono metal),
  // and each retrigger silences the previous voice instead of stacking.
  eightOhEightChoke: 0,
  whaleAutoAmount: 0.18,
  duckWhaleAmount: 0.72,
  hitImpactAmount: 0.82,
  fxSendBase: 0.16,
  delayFeedbackBase: 0.32,
  echoWetBase: 0.18,
  reverbWetBase: 0.12,
  autoEchoEnabled: 1,
  autoEchoAmount: 1,
  downbeatEchoAmount: 1,
  accentEchoAmount: 1,
  dubThrowAmount: 0.56,
  // Master-bus mastering EQ ("global curve"): per-band gain in dB applied to
  // the whole mix before output. Flat (all 0) by default. See rhythm-mastering.js.
  masterEq: defaultMasterEq(),
  barsPerVerse: PHRASE_BARS,
  barsPerSection: SECTION_BARS,
  timeSignature: DEFAULT_TIME_SIGNATURE,
  metronomeEnabled: 0,
  metronomeVolume: 0.45,
  trackBusSends: DEFAULT_TRACK_BUS_SENDS,
  trackReverbSends: DEFAULT_TRACK_REVERB_SENDS,
  trackLevels: DEFAULT_TRACK_LEVELS,
  trackPans: DEFAULT_TRACK_PANS,
  // Per-track 808 voice shape overrides, keyed by track id (base or instance).
  // Each entry is a partial of { drive, punch, decay, tone, sub, choke }; any
  // missing field falls back to the global eightOhEight* default above. This is
  // what makes two "808 Clap" instances sound different.
  trackShapes: {},
  trackSamples: {},
  sampleGroups: [],
  trackStepCounts: {},
  generatedRowsEditable: 0,
  soloTracks: [],
  patterns: {
    jazz: {
      bpm: 118,
      swing: 0.22,
      bars: [
        {
          bass: [[0, 0.72], [7, 0.42], [10, 0.58]],
          kick: [[0, 0.58], [10, 0.32]],
          snare: [[4, 0.24], [12, 0.32]],
          hat: [[2, 0.14], [8, 0.13], [14, 0.15]],
          rim: [[7, 0.08]]
        },
        {
          bass: [[0, 0.68], [5, 0.46], [11, 0.54], [14, 0.38]],
          kick: [[0, 0.54], [11, 0.3]],
          snare: [[4, 0.22], [12, 0.34]],
          hat: [[3, 0.15], [9, 0.14], [15, 0.13]],
          rim: [[10, 0.1]]
        }
      ]
    }
  }
};

export const cloneRhythmConfig = (config = DEFAULT_RHYTHM_CONFIG) => JSON.parse(JSON.stringify(config));

const normalizePatternHits = (hits) => Array.isArray(hits)
  ? hits
      .map((entry) => normalizePatternHit(entry))
      .filter(([step, velocity]) => Number.isFinite(step) && velocity > 0)
  : [];

const normalizePatternBar = (bar = {}) => {
  const out = {};
  // Core pattern tracks are always present so the engine can rely on them.
  PATTERN_TRACK_IDS.forEach((id) => {
    out[id] = normalizePatternHits(bar[id]);
  });
  // Generated/registry tracks: keep whatever the saved bar carried, plus the
  // default generated set, so adding a track round-trips through save/load.
  TRACK_REGISTRY.forEach((track) => {
    if (out[track.id] !== undefined) return;
    if (track.kind === "generated" && (track.addByDefault || Array.isArray(bar[track.id]))) {
      out[track.id] = normalizePatternHits(bar[track.id]);
    }
  });
  // Preserve any extra ids present in the saved bar that aren't in the registry
  // (forward-compat: a project saved with a track we don't know about yet).
  Object.keys(bar || {}).forEach((id) => {
    if (out[id] === undefined && Array.isArray(bar[id])) {
      out[id] = normalizePatternHits(bar[id]);
    }
  });
  return out;
};

const normalizePatternBars = (bars) => {
  const source = Array.isArray(bars) && bars.length
    ? bars
    : DEFAULT_RHYTHM_CONFIG.patterns.jazz.bars;
  const count = Math.max(2, Math.min(MAX_SEQUENCE_BARS, source.length));
  return Array.from({ length: count }, (_, index) => normalizePatternBar(
    source[index] || source[index % source.length] || DEFAULT_RHYTHM_CONFIG.patterns.jazz.bars[index % 2]
  ));
};

const normalizeLoopRegion = (region = {}) => {
  const out = {
    bar: Math.max(0, finiteNumber(region.bar, 0)),
    len: Math.max(1 / 64, finiteNumber(region.len, 1)),
    gain: Math.max(0, Math.min(2, finiteNumber(region.gain, 1))),
    chops: Math.max(1, Math.min(32, Math.round(finiteNumber(region.chops, 4)))),
    sliceSensitivity: Math.max(0.01, Math.min(0.5, finiteNumber(region.sliceSensitivity, 0.12))),
    mode: region.mode === "stretch" ? "stretch" : "cut"
  };
  if (Number.isFinite(Number(region.srcStartFrac))) {
    out.srcStartFrac = Math.max(0, Math.min(1, Number(region.srcStartFrac)));
  }
  if (Number.isFinite(Number(region.srcEndFrac))) {
    out.srcEndFrac = Math.max(0, Math.min(1, Number(region.srcEndFrac)));
  }
  if (out.srcEndFrac != null && out.srcStartFrac != null && out.srcEndFrac <= out.srcStartFrac) {
    delete out.srcStartFrac;
    delete out.srcEndFrac;
  }
  return out;
};

const normalizeLoopTracks = (tracks) => {
  if (!Array.isArray(tracks)) return [];
  return tracks
    .filter((track) => {
      if (!track || typeof track !== "object") return false;
      const hasBundledUrl = typeof track.url === "string" && track.url && !track.url.startsWith("blob:");
      const hasHandle = typeof track.handleId === "string" && track.handleId;
      const relinkRequired = track.relinkRequired || track.source === "local-file";
      return hasBundledUrl || hasHandle || relinkRequired;
    })
    .map((track, index) => {
      const hasBundledUrl = typeof track.url === "string" && track.url && !track.url.startsWith("blob:");
      const hasHandle = typeof track.handleId === "string" && track.handleId;
      return {
        id: typeof track.id === "string" && track.id ? track.id : `loop_${index + 1}`,
        name: typeof track.name === "string" && track.name ? track.name : hasBundledUrl ? track.url.split("/").pop() || "Loop" : "Loop",
        barsInFile: Math.max(1, Math.round(finiteNumber(track.barsInFile, 1))),
        source: typeof track.source === "string" ? track.source : hasHandle ? "browser-file-handle" : hasBundledUrl ? "bundled-sample" : "local-file",
        ...(hasBundledUrl ? { url: track.url } : {}),
        root: typeof track.root === "string" ? track.root : null,
        path: typeof track.path === "string" ? track.path : null,
        fileName: typeof track.fileName === "string" ? track.fileName : null,
        sampleGroupId: typeof track.sampleGroupId === "string" ? track.sampleGroupId : null,
        handleId: hasHandle ? track.handleId : null,
        relinkRequired: Boolean(track.relinkRequired || track.source === "local-file"),
        regions: Array.isArray(track.regions) && track.regions.length
          ? track.regions.map(normalizeLoopRegion)
          : [normalizeLoopRegion({})]
      };
    });
};

const normalizeSampleGroups = (groups) => {
  if (!Array.isArray(groups)) return [];
  const seen = new Set();
  return groups
    .map((group, index) => {
      if (!group || typeof group !== "object") return null;
      const label = typeof group.label === "string" && group.label.trim()
        ? group.label.trim()
        : `Sample Group ${index + 1}`;
      const fallbackId = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        || `sample-group-${index + 1}`;
      const id = typeof group.id === "string" && group.id.trim() ? group.id.trim() : fallbackId;
      if (seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        label,
        collapsed: Boolean(group.collapsed)
      };
    })
    .filter(Boolean);
};

/**
 * Gather every non-registry (instance) track id referenced anywhere in the
 * config: the per-track maps and the pattern bars. Used so per-instance
 * sends/levels/pans/shapes round-trip through normalization instead of being
 * dropped to the fixed registry list.
 */
const collectExtraTrackIds = (config = {}) => {
  const known = new Set(ALL_TRACK_IDS);
  const found = new Set();
  const scan = (obj) => {
    if (!obj || typeof obj !== "object") return;
    Object.keys(obj).forEach((id) => {
      if (!known.has(id)) found.add(id);
    });
  };
  scan(config.trackBusSends);
  scan(config.trackReverbSends);
  scan(config.trackLevels);
  scan(config.trackPans);
  scan(config.trackShapes);
  scan(config.trackSamples);
  scan(config.trackStepCounts);
  const bars = config.patterns?.jazz?.bars;
  if (Array.isArray(bars)) {
    bars.forEach((bar) => {
      if (!bar || typeof bar !== "object") return;
      Object.keys(bar).forEach((id) => {
        if (!known.has(id) && Array.isArray(bar[id])) found.add(id);
      });
    });
  }
  return [...found];
};

export const normalizeRhythmConfig = (config = {}) => {
  const merged = {
    ...cloneRhythmConfig(DEFAULT_RHYTHM_CONFIG),
    ...cloneRhythmConfig(config)
  };
  const patterns = merged.patterns || DEFAULT_RHYTHM_CONFIG.patterns;
  const jazz = patterns.jazz || DEFAULT_RHYTHM_CONFIG.patterns.jazz;
  merged.patterns = {
    jazz: {
      bpm: Math.max(40, Math.min(220, finiteNumber(jazz.bpm, DEFAULT_RHYTHM_CONFIG.patterns.jazz.bpm))),
      swing: Math.max(0, Math.min(0.45, finiteNumber(jazz.swing, DEFAULT_RHYTHM_CONFIG.patterns.jazz.swing))),
      bars: normalizePatternBars(jazz.bars)
    }
  };
  merged.drumBusGain = Math.max(0, Math.min(1.4, finiteNumber(merged.drumBusGain, DEFAULT_RHYTHM_CONFIG.drumBusGain)));
  merged.drumGainCap = Math.max(0.1, Math.min(1, finiteNumber(merged.drumGainCap, DEFAULT_RHYTHM_CONFIG.drumGainCap)));
  merged.drumLift = Math.max(0.2, Math.min(1.4, finiteNumber(merged.drumLift, DEFAULT_RHYTHM_CONFIG.drumLift)));
  merged.humanizeSeconds = Math.max(0, Math.min(0.012, finiteNumber(merged.humanizeSeconds, DEFAULT_RHYTHM_CONFIG.humanizeSeconds)));
  merged.synthLevel = Math.max(0, Math.min(3, finiteNumber(merged.synthLevel, DEFAULT_RHYTHM_CONFIG.synthLevel)));
  merged.bassLevel = Math.max(0, Math.min(2.5, finiteNumber(merged.bassLevel, DEFAULT_RHYTHM_CONFIG.bassLevel)));
  merged.bassTone = Math.max(0, Math.min(1, finiteNumber(merged.bassTone, DEFAULT_RHYTHM_CONFIG.bassTone)));
  merged.generatedPluckOffsetMs = Math.round(clamp(merged.generatedPluckOffsetMs, -180, 180, DEFAULT_RHYTHM_CONFIG.generatedPluckOffsetMs));
  merged.generatedFunkOffsetMs = Math.round(clamp(merged.generatedFunkOffsetMs, -180, 180, DEFAULT_RHYTHM_CONFIG.generatedFunkOffsetMs));
  merged.generatedPadOffsetMs = Math.round(clamp(merged.generatedPadOffsetMs, -320, 320, DEFAULT_RHYTHM_CONFIG.generatedPadOffsetMs));
  merged.generatedWhaleOffsetMs = Math.round(clamp(merged.generatedWhaleOffsetMs, -320, 320, DEFAULT_RHYTHM_CONFIG.generatedWhaleOffsetMs));
  merged.eightOhEightLevel = Math.max(0, Math.min(2, finiteNumber(merged.eightOhEightLevel, DEFAULT_RHYTHM_CONFIG.eightOhEightLevel)));
  merged.eightOhEightTune = Math.max(-12, Math.min(12, finiteNumber(merged.eightOhEightTune, DEFAULT_RHYTHM_CONFIG.eightOhEightTune)));
  merged.eightOhEightDrive = Math.max(0, Math.min(1, finiteNumber(merged.eightOhEightDrive, DEFAULT_RHYTHM_CONFIG.eightOhEightDrive)));
  merged.eightOhEightPunch = Math.max(0, Math.min(1, finiteNumber(merged.eightOhEightPunch, DEFAULT_RHYTHM_CONFIG.eightOhEightPunch)));
  merged.eightOhEightDecay = Math.max(0.3, Math.min(2.5, finiteNumber(merged.eightOhEightDecay, DEFAULT_RHYTHM_CONFIG.eightOhEightDecay)));
  merged.eightOhEightTone = Math.max(0, Math.min(1, finiteNumber(merged.eightOhEightTone, DEFAULT_RHYTHM_CONFIG.eightOhEightTone)));
  merged.eightOhEightSub = Math.max(0, Math.min(1, finiteNumber(merged.eightOhEightSub, DEFAULT_RHYTHM_CONFIG.eightOhEightSub)));
  merged.eightOhEightChoke = finiteNumber(merged.eightOhEightChoke, DEFAULT_RHYTHM_CONFIG.eightOhEightChoke) >= 0.5 ? 1 : 0;
  merged.whaleAutoAmount = Math.max(0, Math.min(1, finiteNumber(merged.whaleAutoAmount, DEFAULT_RHYTHM_CONFIG.whaleAutoAmount)));
  merged.duckWhaleAmount = Math.max(0, Math.min(1.5, finiteNumber(merged.duckWhaleAmount, DEFAULT_RHYTHM_CONFIG.duckWhaleAmount)));
  merged.hitImpactAmount = Math.max(0, Math.min(1.5, finiteNumber(merged.hitImpactAmount, DEFAULT_RHYTHM_CONFIG.hitImpactAmount)));
  merged.fxSendBase = Math.max(0, Math.min(1, finiteNumber(merged.fxSendBase, DEFAULT_RHYTHM_CONFIG.fxSendBase)));
  merged.delayFeedbackBase = Math.max(0, Math.min(0.82, finiteNumber(merged.delayFeedbackBase, DEFAULT_RHYTHM_CONFIG.delayFeedbackBase)));
  merged.echoWetBase = Math.max(0, Math.min(1, finiteNumber(merged.echoWetBase, DEFAULT_RHYTHM_CONFIG.echoWetBase)));
  merged.reverbWetBase = Math.max(0, Math.min(1, finiteNumber(merged.reverbWetBase, DEFAULT_RHYTHM_CONFIG.reverbWetBase)));
  merged.autoEchoEnabled = finiteNumber(merged.autoEchoEnabled, DEFAULT_RHYTHM_CONFIG.autoEchoEnabled) >= 0.5 ? 1 : 0;
  merged.autoEchoAmount = Math.max(0, Math.min(1, finiteNumber(merged.autoEchoAmount, DEFAULT_RHYTHM_CONFIG.autoEchoAmount)));
  merged.downbeatEchoAmount = Math.max(0, Math.min(1, finiteNumber(merged.downbeatEchoAmount, DEFAULT_RHYTHM_CONFIG.downbeatEchoAmount)));
  merged.accentEchoAmount = Math.max(0, Math.min(1, finiteNumber(merged.accentEchoAmount, DEFAULT_RHYTHM_CONFIG.accentEchoAmount)));
  merged.dubThrowAmount = Math.max(0, Math.min(1.2, finiteNumber(merged.dubThrowAmount, DEFAULT_RHYTHM_CONFIG.dubThrowAmount)));
  merged.barsPerVerse = normalizeVerseBars(merged.barsPerVerse);
  merged.barsPerSection = normalizeSectionBars(merged.barsPerSection);
  merged.timeSignature = normalizeTimeSignature(merged.timeSignature ?? merged.timeSig);
  merged.metronomeEnabled = finiteNumber(merged.metronomeEnabled, DEFAULT_RHYTHM_CONFIG.metronomeEnabled) >= 0.5 ? 1 : 0;
  merged.metronomeVolume = Math.max(0, Math.min(1, finiteNumber(merged.metronomeVolume, DEFAULT_RHYTHM_CONFIG.metronomeVolume)));
  merged.masterEq = normalizeMasterEq(merged.masterEq);
  const sourceSends = merged.trackBusSends && typeof merged.trackBusSends === "object" ? merged.trackBusSends : {};
  // Include registry tracks plus any extra (instance) ids carried in the source
  // maps / patterns, so per-instance sends/levels/pans round-trip through save.
  const extraTrackIds = collectExtraTrackIds(merged);
  const allTrackIds = [...RHYTHM_TRACKS, ...extraTrackIds];
  merged.trackBusSends = Object.fromEntries(allTrackIds.map((track) => [
    track,
    Math.max(0, Math.min(1, finiteNumber(sourceSends[track], DEFAULT_TRACK_BUS_SENDS[baseTrackId(track)] ?? 0.25)))
  ]));
  const sourceReverbSends = merged.trackReverbSends && typeof merged.trackReverbSends === "object" ? merged.trackReverbSends : {};
  merged.trackReverbSends = Object.fromEntries(allTrackIds.map((track) => [
    track,
    Math.max(0, Math.min(1, finiteNumber(sourceReverbSends[track], DEFAULT_TRACK_REVERB_SENDS[baseTrackId(track)] ?? 0.2)))
  ]));
  const sourceLevels = merged.trackLevels && typeof merged.trackLevels === "object" ? merged.trackLevels : {};
  merged.trackLevels = Object.fromEntries(allTrackIds.map((track) => [
    track,
    Math.max(0, Math.min(2, finiteNumber(sourceLevels[track], DEFAULT_TRACK_LEVELS[baseTrackId(track)] ?? 1)))
  ]));
  const sourcePans = merged.trackPans && typeof merged.trackPans === "object" ? merged.trackPans : {};
  merged.trackPans = Object.fromEntries(allTrackIds.map((track) => [
    track,
    Math.max(-1, Math.min(1, finiteNumber(sourcePans[track], DEFAULT_TRACK_PANS[baseTrackId(track)] ?? 0)))
  ]));
  // Per-track custom sample assignments. Bundled sample URLs are reloadable;
  // browser/file-handle entries reload in Chromium via IndexedDB handles; plain
  // local files are kept as relink-required metadata for Safari-style web mode.
  const sourceSamples = merged.trackSamples && typeof merged.trackSamples === "object" ? merged.trackSamples : {};
  merged.trackSamples = Object.fromEntries(
    Object.entries(sourceSamples)
      .filter(([, entry]) => {
        if (!entry || typeof entry !== "object") return false;
        const hasBundledUrl = typeof entry.url === "string" && entry.url && !entry.url.startsWith("blob:");
        const hasHandle = typeof entry.handleId === "string" && entry.handleId;
        const relinkRequired = entry.relinkRequired || entry.source === "local-file";
        return hasBundledUrl || hasHandle || relinkRequired;
      })
      .map(([track, entry]) => {
        const hasBundledUrl = typeof entry.url === "string" && entry.url && !entry.url.startsWith("blob:");
        const label = typeof entry.label === "string"
          ? entry.label
          : hasBundledUrl
            ? entry.url.split("/").pop() || "sample"
            : "sample";
        return [track, {
          source: typeof entry.source === "string" ? entry.source : hasBundledUrl ? "bundled-sample" : entry.handleId ? "browser-file-handle" : "local-file",
          ...(hasBundledUrl ? { url: String(entry.url) } : {}),
          label,
          root: typeof entry.root === "string" ? entry.root : null,
          path: typeof entry.path === "string" ? entry.path : null,
          handleId: typeof entry.handleId === "string" ? entry.handleId : null,
          relinkRequired: Boolean(entry.relinkRequired || entry.source === "local-file")
        }];
      })
  );
  const sourceStepCounts = merged.trackStepCounts && typeof merged.trackStepCounts === "object" ? merged.trackStepCounts : {};
  merged.trackStepCounts = Object.fromEntries(
    Object.entries(sourceStepCounts)
      .map(([track, value]) => [track, normalizeTrackStepCount(value)])
      .filter(([track, value]) => typeof track === "string" && value !== DEFAULT_TRACK_STEPS_PER_BAR)
  );
  // Per-track 808 voice shape overrides: { trackId: { drive, punch, ... } }.
  // Keep only entries that carry at least one in-range field after clamping.
  const sourceShapes = merged.trackShapes && typeof merged.trackShapes === "object" ? merged.trackShapes : {};
  merged.trackShapes = Object.fromEntries(
    Object.entries(sourceShapes)
      .map(([track, shape]) => [track, normalizeTrackShape(shape)])
      .filter(([, shape]) => Object.keys(shape).length > 0)
  );
  merged.generatedRowsEditable = finiteNumber(merged.generatedRowsEditable, DEFAULT_RHYTHM_CONFIG.generatedRowsEditable) >= 0.5 ? 1 : 0;
  merged.soloTracks = Array.isArray(merged.soloTracks)
    ? [...new Set(merged.soloTracks.filter((track) => typeof track === "string"))]
    : [];
  const loopPhraseBar = merged.loopPhraseBar;
  const phraseClampMax = Math.max(MAX_SEQUENCE_BARS - 1, merged.patterns.jazz.bars.length - 1);
  merged.loopPhraseBar = loopPhraseBar === null || loopPhraseBar === undefined || loopPhraseBar === ""
    ? null
    : Number.isFinite(Number(loopPhraseBar))
      ? Math.max(0, Math.min(Math.max(0, phraseClampMax), Math.round(Number(loopPhraseBar))))
      : null;
  const loopPhraseBarLength = finiteNumber(merged.loopPhraseBarLength, 0);
  merged.loopPhraseBarLength = loopPhraseBarLength > 0
    ? Math.max(1, Math.min(32, Math.round(loopPhraseBarLength)))
    : 0;
  const loopPhraseBarStart = merged.loopPhraseBarStart;
  merged.loopPhraseBarStart = merged.loopPhraseBarLength > 0 && Number.isFinite(Number(loopPhraseBarStart))
    ? Math.max(0, Math.min(Math.max(0, phraseClampMax - merged.loopPhraseBarLength + 1), Math.round(Number(loopPhraseBarStart))))
    : null;
  merged.loopTracks = normalizeLoopTracks(merged.loopTracks);
  merged.sampleGroups = normalizeSampleGroups(merged.sampleGroups);
  return merged;
};

export const RHYTHM_STYLE_OPTIONS = [
  ["jazz", "Jazz"]
];

export function sequencedBassPitchForStep({ phraseBar = 0, step = 0 } = {}) {
  const phraseOffset = Math.floor(finiteNumber(phraseBar, 0) / 2);
  const stepOffset = Math.floor(finiteNumber(step, 0) / 2);
  const index = phraseOffset + stepOffset;
  return SEQUENCED_BASS_PHRASE[((index % SEQUENCED_BASS_PHRASE.length) + SEQUENCED_BASS_PHRASE.length) % SEQUENCED_BASS_PHRASE.length];
}

export function phraseBeatModeForBar(phraseBar = 0, sectionBars = SECTION_BARS) {
  const section = Math.floor(finiteNumber(phraseBar, 0) / normalizeSectionBars(sectionBars));
  if (section === 0) return "twoFour";
  if (section === 1) return "oneThree";
  if (section === 2) return "threeOnly";
  return "oneTwo";
}

export function shiftedAccentStepsForBar(phraseBar = 0, sectionBars = SECTION_BARS) {
  const mode = phraseBeatModeForBar(phraseBar, sectionBars);
  if (mode === "twoFour") return [4, 12];
  if (mode === "oneThree") return [0, 8];
  if (mode === "threeOnly") return [8];
  return [0, 4];
}

export function automaticEchoAmountForStep({
  phraseBar = 0,
  step = 0,
  pressure = 0,
  config = DEFAULT_RHYTHM_CONFIG
} = {}) {
  const safePhraseBar = finiteNumber(phraseBar, 0);
  const safeStep = Math.round(finiteNumber(step, 0));
  const safePressure = clamp01(pressure);
  const sectionBars = sectionBarsForConfig(config);
  if (finiteNumber(config.autoEchoEnabled, DEFAULT_RHYTHM_CONFIG.autoEchoEnabled) < 0.5) return 0;
  const autoAmount = clamp01(config.autoEchoAmount ?? DEFAULT_RHYTHM_CONFIG.autoEchoAmount);
  const downbeatAmount = clamp01(config.downbeatEchoAmount ?? DEFAULT_RHYTHM_CONFIG.downbeatEchoAmount);
  const accentAmount = clamp01(config.accentEchoAmount ?? DEFAULT_RHYTHM_CONFIG.accentEchoAmount);
  let amount = 0;
  if (safeStep === 0) {
    const sectionStart = safePhraseBar % sectionBars === 0;
    const phraseStart = safePhraseBar === 0;
    const turnaround = safePhraseBar === 8 || safePhraseBar === 16 || safePhraseBar === 24 || safePhraseBar === 31;
    amount = Math.max(amount, (phraseStart ? 0.5 : sectionStart || turnaround ? 0.38 : 0.2 + safePressure * 0.12) * autoAmount * downbeatAmount);
  }
  const accentSteps = shiftedAccentStepsForBar(safePhraseBar, sectionBars);
  if (accentSteps.includes(safeStep)) {
    const localBuild = safePhraseBar % sectionBars;
    const primary = safeStep === accentSteps[0];
    amount = Math.max(amount, ((primary ? 0.015 : 0.012) + safePressure * 0.025 + localBuild * 0.002) * autoAmount * accentAmount);
  }
  return amount;
}

export function generatedSynthEventsForStep({
  phraseBar = 0,
  step = 0,
  pressure = 0,
  config = DEFAULT_RHYTHM_CONFIG
} = {}) {
  const rawPhraseBar = Math.max(0, Math.round(finiteNumber(phraseBar, 0)));
  const safePhraseBar = rawPhraseBar % PHRASE_BARS;
  const safeStep = Math.max(0, Math.min(15, Math.round(finiteNumber(step, 0))));
  const safePressure = clamp01(pressure);
  const sectionBars = sectionBarsForConfig(config);
  const section = Math.floor(safePhraseBar / sectionBars);
  const events = [];

  const pluckSteps = safePhraseBar < 4
    ? []
    : safePhraseBar < 8
      ? [11]
      : section >= 2 || safePressure > 0.52
        ? [3, 6, 9, 14]
        : [3, 11];
  if (pluckSteps.includes(safeStep)) {
    events.push({
      track: "pluck",
      velocity: 0.035 + safePressure * 0.045,
      pitch: [7, 10, 5, 12][(safePhraseBar + safeStep) % 4],
      label: "Pluck"
    });
  }
  if (safePhraseBar >= 8 && safePressure > 0.72 && [2, 12].includes(safeStep)) {
    events.push({
      track: "pluck",
      velocity: 0.025,
      pitch: safeStep === 2 ? 15 : 17,
      label: "Pluck fill"
    });
  }

  if (safePhraseBar >= 6) {
    const lowPattern = [4, 11];
    const midPattern = safePhraseBar % 2 === 0 ? [1, 4, 9, 11] : [3, 6, 10, 14];
    const highPattern = safePhraseBar % 4 === 3 ? [1, 4, 6, 9, 11, 14] : [1, 5, 8, 11, 14];
    const pattern = safePressure > 0.72 ? highPattern : safePressure > 0.38 || section >= 2 ? midPattern : lowPattern;
    const phraseTurnaround = safePhraseBar === 7 || safePhraseBar === 15 || safePhraseBar === 23 || safePhraseBar === 31;
    if (pattern.includes(safeStep) && !(phraseTurnaround && safeStep >= 10)) {
      const notePool = [7, 10, 12, 15, 17, 12, 10, 5];
      events.push({
        track: "funk",
        velocity: (safeStep === 1 || safeStep === 14 ? 0.018 : 0.03) + safePressure * 0.045,
        pitch: notePool[(safePhraseBar + safeStep + section) % notePool.length],
        label: "Funk"
      });
    }
  }

  if (safeStep === 0 && safePhraseBar % sectionBars === 0) {
    const chordRoot = [0, 3, 5, 2][section % 4];
    events.push({
      track: "pad",
      velocity: 0.032 + safePressure * 0.045,
      pitch: chordRoot,
      label: "Pad"
    });
  }

  const whaleAmount = clamp01(config.whaleAutoAmount ?? DEFAULT_RHYTHM_CONFIG.whaleAutoAmount);
  const whaleActive = safePressure > 0.45 && whaleAmount > 0.08;
  if (whaleActive && safeStep === 0) {
    events.push({
      track: "whale",
      velocity: (0.05 + safePressure * 0.1) * whaleAmount,
      pitch: 0,
      label: "LFO rise"
    });
  }
  if (safePressure > 0.82 && whaleAmount > 0.45 && safeStep === 6) {
    events.push({
      track: "whale",
      velocity: (0.05 + safePressure * 0.1) * whaleAmount * 0.62,
      pitch: -5,
      label: "LFO fall"
    });
  }

  const echoAmount = automaticEchoAmountForStep({ phraseBar: safePhraseBar, step: safeStep, pressure: safePressure, config });
  if (echoAmount > 0.001) {
    events.push({
      track: "echo",
      velocity: echoAmount,
      pitch: 0,
      label: "Auto echo"
    });
  }

  const phraseBreak =
    safePhraseBar === 15 ||
    safePhraseBar === 31 ||
    (safePhraseBar === 23 && safePressure > 0.34) ||
    (safePhraseBar === 7 && safePressure > 0.66);
  if (phraseBreak) {
    const startStep = safePhraseBar === 7 || safePhraseBar === 15 ? 12 : 8;
    if (safeStep === startStep) {
      events.push({ track: "space", velocity: 0.82, pitch: -8, label: "Space drop" });
    } else if (safeStep === 15) {
      events.push({ track: "space", velocity: 0.62, pitch: 4, label: "Pickup" });
    } else if (safeStep > startStep && safeStep < 15) {
      events.push({ track: "space", velocity: 0.38, pitch: 0, label: "Drums muted" });
    }
  }

  return events;
}


export function expandPatternBars(bars = [], count = null) {
  const source = Array.isArray(bars) && bars.length
    ? bars
    : DEFAULT_RHYTHM_CONFIG.patterns.jazz.bars;
  const requestedCount = count === null || count === undefined || count === ""
    ? source.length
    : Number(count);
  const targetCount = Math.max(PHRASE_BARS, Math.min(MAX_SEQUENCE_BARS, Number.isFinite(requestedCount) ? Math.round(requestedCount) : source.length));
  return Array.from({ length: targetCount }, (_, index) => cloneRhythmConfig(
    source[index] || source[index % source.length] || DEFAULT_RHYTHM_CONFIG.patterns.jazz.bars[index % 2]
  ));
}

function serializeGeneratedEvent(event) {
  const options = normalizeStepOptions({ pitch: event.pitch || 0 });
  const hit = [
    normalizePatternStep(event.step),
    Number(clamp01(event.velocity).toFixed(2))
  ];
  if (hasStepOptions(options)) {
    hit.push(options);
  }
  return hit;
}

export function hasMaterializedGeneratedRows(config = {}) {
  const bars = config?.patterns?.jazz?.bars;
  if (!Array.isArray(bars)) return false;
  return bars.some((bar) => EDITABLE_GENERATED_ROWS.some((track) => Array.isArray(bar?.[track]) && bar[track].length > 0));
}

export function hasEightOhEightRows(config = {}) {
  const bars = config?.patterns?.jazz?.bars;
  if (!Array.isArray(bars)) return false;
  return bars.some((bar) => EIGHT_OH_EIGHT_ROWS.some((track) => Array.isArray(bar?.[track])));
}

export function materializeGeneratedRows(config, pressure = 0.45) {
  const target = config && typeof config === "object" ? config : normalizeRhythmConfig();
  const bars = target.patterns?.jazz?.bars || [];
  bars.forEach((bar, barIndex) => {
    const generated = Object.fromEntries(EDITABLE_GENERATED_ROWS.map((id) => [id, new Map()]));
    for (let step = 0; step < 16; step += 1) {
      generatedSynthEventsForStep({
        phraseBar: barIndex,
        step,
        pressure,
        config: target
      }).forEach((event) => {
        if (!generated[event.track]) return;
        const current = generated[event.track].get(step);
        if (current && current.velocity >= event.velocity) return;
        generated[event.track].set(step, { ...event, step });
      });
    }
    EDITABLE_GENERATED_ROWS.forEach((id) => {
      bar[id] = Array.from(generated[id].values())
        .sort((a, b) => a.step - b.step)
        .map(serializeGeneratedEvent);
    });
  });
  return target;
}

export function materializeEightOhEightRows(config) {
  const target = config && typeof config === "object" ? config : normalizeRhythmConfig();
  const bars = target.patterns?.jazz?.bars || [];
  const rowSources = {
    eightOhEightKick: "kick",
    eightOhEightSnare: "snare",
    eightOhEightHat: "hat",
    eightOhEightClick: "rim"
  };
  bars.forEach((bar) => {
    Object.entries(rowSources).forEach(([row, source]) => {
      if (Array.isArray(bar[row])) return;
      bar[row] = normalizePatternHits(bar[source]).map(([step, velocity, options]) => {
        const hit = [step, Number(clamp01(velocity).toFixed(2))];
        const normalizedOptions = normalizeStepOptions(options);
        if (hasStepOptions(normalizedOptions)) hit.push(normalizedOptions);
        return hit;
      });
    });
  });
  return target;
}

export function normalizeSequencedRhythmConfig(config = {}, { pressure = 0.45 } = {}) {
  const sourceHasEditableGeneratedRows = finiteNumber(config?.generatedRowsEditable, 0) >= 0.5;
  const sourceHasEightOhEightRows = hasEightOhEightRows(config);
  const next = normalizeRhythmConfig(config);
  next.patterns.jazz.bars = expandPatternBars(next.patterns.jazz.bars);
  if (!sourceHasEditableGeneratedRows && next.generatedRowsEditable < 0.5 && !hasMaterializedGeneratedRows(next)) {
    materializeGeneratedRows(next, pressure);
  }
  if (!sourceHasEditableGeneratedRows && !sourceHasEightOhEightRows) {
    materializeEightOhEightRows(next);
  }
  next.generatedRowsEditable = 1;
  return normalizeRhythmConfig(next);
}
