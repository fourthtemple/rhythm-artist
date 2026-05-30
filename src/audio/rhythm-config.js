export const STYLE_ORDER = ["jazz"];
export const PHRASE_BARS = 32;
export const MAX_SEQUENCE_BARS = PHRASE_BARS * 8;
export const SECTION_BARS = 8;
export const SYNTH_ROOT_HZ = 55;
export const SYNTH_SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
export const SEQUENCED_BASS_PHRASE = [0, 3, 5, 2, 7, 5, 3, 10];
export const EIGHT_OH_EIGHT_ROWS = ["eightOhEightKick", "eightOhEightSnare", "eightOhEightHat", "eightOhEightClick"];
export const EDITABLE_GENERATED_ROWS = ["pluck", "funk", "pad", "whale", ...EIGHT_OH_EIGHT_ROWS, "echo", "space"];
export const RHYTHM_TRACKS = ["bass", "kick", "snare", "hat", "rim", ...EDITABLE_GENERATED_ROWS];
export const DEFAULT_TRACK_BUS_SENDS = {
  bass: 0.28,
  kick: 0.18,
  snare: 0.34,
  hat: 0.18,
  rim: 0.4,
  pluck: 0.45,
  funk: 0.38,
  pad: 0.62,
  whale: 0.58,
  eightOhEightKick: 0.22,
  eightOhEightSnare: 0.2,
  eightOhEightHat: 0.12,
  eightOhEightClick: 0.18,
  echo: 1,
  space: 1
};
export const DEFAULT_TRACK_REVERB_SENDS = {
  bass: 0.16,
  kick: 0.08,
  snare: 0.24,
  hat: 0.14,
  rim: 0.3,
  pluck: 0.32,
  funk: 0.24,
  pad: 0.62,
  whale: 0.46,
  eightOhEightKick: 0.08,
  eightOhEightSnare: 0.1,
  eightOhEightHat: 0.06,
  eightOhEightClick: 0.08,
  echo: 0.42,
  space: 1
};
export const DEFAULT_SYNTH_LEVEL = 1.45;
export const DUCK_SOUND_REARM_SECONDS = 0.18;

export const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
export const clamp01 = (value) => Math.max(0, Math.min(1, finiteNumber(value, 0)));
export const clamp = (value, min, max, fallback = 0) => Math.max(min, Math.min(max, finiteNumber(value, fallback)));
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

const normalizePatternHit = (entry) => {
  if (Array.isArray(entry)) {
    const [step, velocity, options] = entry;
    const normalizedOptions = normalizeStepOptions(options);
    const hit = [
      Math.round(Math.max(0, Math.min(15, finiteNumber(step, 0)))),
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
      Math.round(Math.max(0, Math.min(15, finiteNumber(entry.step, 0)))),
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
  trackBusSends: DEFAULT_TRACK_BUS_SENDS,
  trackReverbSends: DEFAULT_TRACK_REVERB_SENDS,
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

const normalizePatternBar = (bar = {}) => ({
  bass: normalizePatternHits(bar.bass),
  kick: normalizePatternHits(bar.kick),
  snare: normalizePatternHits(bar.snare),
  hat: normalizePatternHits(bar.hat),
  rim: normalizePatternHits(bar.rim),
  pluck: normalizePatternHits(bar.pluck),
  funk: normalizePatternHits(bar.funk),
  pad: normalizePatternHits(bar.pad),
  whale: normalizePatternHits(bar.whale),
  eightOhEightKick: normalizePatternHits(bar.eightOhEightKick),
  eightOhEightSnare: normalizePatternHits(bar.eightOhEightSnare),
  eightOhEightHat: normalizePatternHits(bar.eightOhEightHat),
  eightOhEightClick: normalizePatternHits(bar.eightOhEightClick),
  echo: normalizePatternHits(bar.echo),
  space: normalizePatternHits(bar.space)
});

const normalizePatternBars = (bars) => {
  const source = Array.isArray(bars) && bars.length
    ? bars
    : DEFAULT_RHYTHM_CONFIG.patterns.jazz.bars;
  const count = Math.max(2, Math.min(MAX_SEQUENCE_BARS, source.length));
  return Array.from({ length: count }, (_, index) => normalizePatternBar(
    source[index] || source[index % source.length] || DEFAULT_RHYTHM_CONFIG.patterns.jazz.bars[index % 2]
  ));
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
  const sourceSends = merged.trackBusSends && typeof merged.trackBusSends === "object" ? merged.trackBusSends : {};
  merged.trackBusSends = Object.fromEntries(RHYTHM_TRACKS.map((track) => [
    track,
    Math.max(0, Math.min(1, finiteNumber(sourceSends[track], DEFAULT_TRACK_BUS_SENDS[track] ?? 0.25)))
  ]));
  const sourceReverbSends = merged.trackReverbSends && typeof merged.trackReverbSends === "object" ? merged.trackReverbSends : {};
  merged.trackReverbSends = Object.fromEntries(RHYTHM_TRACKS.map((track) => [
    track,
    Math.max(0, Math.min(1, finiteNumber(sourceReverbSends[track], DEFAULT_TRACK_REVERB_SENDS[track] ?? 0.2)))
  ]));
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

export function phraseBeatModeForBar(phraseBar = 0) {
  const section = Math.floor(finiteNumber(phraseBar, 0) / SECTION_BARS);
  if (section === 0) return "twoFour";
  if (section === 1) return "oneThree";
  if (section === 2) return "threeOnly";
  return "oneTwo";
}

export function shiftedAccentStepsForBar(phraseBar = 0) {
  const mode = phraseBeatModeForBar(phraseBar);
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
  if (finiteNumber(config.autoEchoEnabled, DEFAULT_RHYTHM_CONFIG.autoEchoEnabled) < 0.5) return 0;
  const autoAmount = clamp01(config.autoEchoAmount ?? DEFAULT_RHYTHM_CONFIG.autoEchoAmount);
  const downbeatAmount = clamp01(config.downbeatEchoAmount ?? DEFAULT_RHYTHM_CONFIG.downbeatEchoAmount);
  const accentAmount = clamp01(config.accentEchoAmount ?? DEFAULT_RHYTHM_CONFIG.accentEchoAmount);
  let amount = 0;
  if (safeStep === 0) {
    const sectionStart = safePhraseBar % SECTION_BARS === 0;
    const phraseStart = safePhraseBar === 0;
    const turnaround = safePhraseBar === 8 || safePhraseBar === 16 || safePhraseBar === 24 || safePhraseBar === 31;
    amount = Math.max(amount, (phraseStart ? 0.5 : sectionStart || turnaround ? 0.38 : 0.2 + safePressure * 0.12) * autoAmount * downbeatAmount);
  }
  const accentSteps = shiftedAccentStepsForBar(safePhraseBar);
  if (accentSteps.includes(safeStep)) {
    const localBuild = safePhraseBar % SECTION_BARS;
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
  const section = Math.floor(safePhraseBar / SECTION_BARS);
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

  if (safeStep === 0 && safePhraseBar % SECTION_BARS === 0) {
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
    Math.max(0, Math.min(15, Math.round(finiteNumber(event.step, 0)))),
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
