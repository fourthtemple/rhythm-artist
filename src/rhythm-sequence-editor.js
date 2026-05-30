import {
  DEFAULT_RHYTHM_CONFIG,
  generatedSynthEventsForStep,
  MAX_SEQUENCE_BARS,
  normalizeSequencedRhythmConfig,
  normalizeStepOptions,
  PHRASE_BARS,
  STEP_OPTION_DEFAULTS,
  SYNTH_ROOT_HZ,
  SYNTH_SCALE,
  sequencedBassPitchForStep
} from "./audio/rhythm-config.js";
import { RhythmEngine } from "./audio/rhythm-engine.js";

const GRID_ROWS = [
  { id: "bass", label: "Bass", type: "pattern" },
  { id: "kick", label: "Kick", type: "pattern" },
  { id: "snare", label: "Snare", type: "pattern" },
  { id: "hat", label: "Hat", type: "pattern" },
  { id: "rim", label: "Rim", type: "pattern" },
  { id: "pluck", label: "Pluck", type: "generated" },
  { id: "funk", label: "Funk", type: "generated" },
  { id: "pad", label: "Pad", type: "generated" },
  { id: "whale", label: "LFO", type: "generated" },
  { id: "eightOhEightKick", label: "808 Kick", type: "generated" },
  { id: "eightOhEightSnare", label: "808 Snare", type: "generated" },
  { id: "eightOhEightHat", label: "808 Hat", type: "generated" },
  { id: "eightOhEightClick", label: "808 Click", type: "generated" },
  { id: "echo", label: "Echo", type: "generated" },
  { id: "space", label: "Space", type: "generated" }
];
const PATTERN_ROW_IDS = new Set(GRID_ROWS.filter((row) => row.type === "pattern").map((row) => row.id));
const GENERATED_ROW_IDS = GRID_ROWS.filter((row) => row.type === "generated").map((row) => row.id);
const ROW_LABELS = Object.fromEntries(GRID_ROWS.map((row) => [row.id, row.label]));

const LOOP_BAR_COUNT = PHRASE_BARS;
const MAX_LOOP_COUNT = Math.floor(MAX_SEQUENCE_BARS / LOOP_BAR_COUNT);
const PITCH_SLIDER_MIN = -24;
const PITCH_SLIDER_MAX = 48;
const A1_MIDI_NOTE = 33;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK_NOTE_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);
const DEFAULT_VELOCITY = {
  bass: 0.68,
  kick: 0.46,
  snare: 0.34,
  hat: 0.16,
  rim: 0.12,
  pluck: 0.18,
  funk: 0.22,
  pad: 0.2,
  whale: 0.24,
  eightOhEightKick: 0.32,
  eightOhEightSnare: 0.24,
  eightOhEightHat: 0.16,
  eightOhEightClick: 0.16,
  echo: 0.3,
  space: 0.4
};
const SAVED_RHYTHM_URL = "./assets/game/rhythm-sequence.json";
const clone = (value) => JSON.parse(JSON.stringify(value));
const $ = (selector) => document.querySelector(selector);
const clamp = (value, min, max, fallback = 0) => {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
};

const state = {
  config: normalizeEditorConfig(DEFAULT_RHYTHM_CONFIG),
  engine: new RhythmEngine({ config: DEFAULT_RHYTHM_CONFIG, style: "jazz", volume: 0.58 }),
  activeBar: 0,
  activeLoopIndex: 0,
  selected: null,
  soloTracks: new Set(),
  playing: false,
  intensity: 0.45,
  loopBar: false,
  loopBarIndex: 0,
  loopBarLength: 0,
  twoBarClipboard: null,
  trackClipboard: null,
  playheadStep: 0,
  uiTimer: null,
  zoomLevel: 1
};

const stepGrid = $("#step-grid");
const barTabs = $(".bar-tabs");
const loopTabs = $(".loop-tabs");
const loopCountInput = $("#loop-count");
const status = $("#status");
const jsonOutput = $("#json-output");
const selectedLabel = $("#selected-label");
const selectedVelocity = $("#selected-velocity");
const selectedVelocityValue = $("#selected-velocity-value");
const selectedVelocityNumber = $("#selected-velocity-number");
const selectedPitch = $("#selected-pitch");
const selectedPitchValue = $("#selected-pitch-value");
const selectedPitchNumber = $("#selected-pitch-number");
const selectedPiano = $("#selected-piano");
const selectedOffset = $("#selected-offset");
const selectedOffsetValue = $("#selected-offset-value");
const selectedOffsetNumber = $("#selected-offset-number");
const selectedAttack = $("#selected-attack");
const selectedAttackValue = $("#selected-attack-value");
const selectedAttackNumber = $("#selected-attack-number");
const selectedDelay = $("#selected-delay");
const selectedDelayValue = $("#selected-delay-value");
const selectedDelayNumber = $("#selected-delay-number");
const selectedWobble = $("#selected-wobble");
const selectedWobbleValue = $("#selected-wobble-value");
const selectedWobbleNumber = $("#selected-wobble-number");
const selectedDubEcho = $("#selected-dub-echo");
const selectedDubEchoValue = $("#selected-dub-echo-value");
const selectedDubEchoNumber = $("#selected-dub-echo-number");
const selectedNoteDelaySend = $("#selected-note-delay-send");
const selectedNoteDelaySendValue = $("#selected-note-delay-send-value");
const selectedNoteDelaySendNumber = $("#selected-note-delay-send-number");
const selectedNoteReverbSend = $("#selected-note-reverb-send");
const selectedNoteReverbSendValue = $("#selected-note-reverb-send-value");
const selectedNoteReverbSendNumber = $("#selected-note-reverb-send-number");
const selectedBusSend = $("#selected-bus-send");
const selectedBusSendValue = $("#selected-bus-send-value");
const selectedBusSendNumber = $("#selected-bus-send-number");
const selectedReverbSend = $("#selected-reverb-send");
const selectedReverbSendValue = $("#selected-reverb-send-value");
const selectedReverbSendNumber = $("#selected-reverb-send-number");
const runningFromFile = window.location.protocol === "file:";
const selectedControls = [
  selectedVelocity,
  selectedPitch,
  selectedOffset,
  selectedAttack,
  selectedDelay,
  selectedWobble,
  selectedNoteDelaySend,
  selectedNoteReverbSend,
  selectedBusSend,
  selectedReverbSend,
  selectedVelocityNumber,
  selectedPitchNumber,
  selectedOffsetNumber,
  selectedAttackNumber,
  selectedDelayNumber,
  selectedWobbleNumber,
  selectedDubEcho,
  selectedDubEchoNumber,
  selectedNoteDelaySendNumber,
  selectedNoteReverbSendNumber,
  selectedBusSendNumber,
  selectedReverbSendNumber
];

const selectedOptionControls = {
  offsetMs: {
    range: selectedOffset,
    number: selectedOffsetNumber,
    output: selectedOffsetValue,
    min: -120,
    max: 120,
    step: 1,
    format: (value) => `${Math.round(value)}ms`
  },
  attackMs: {
    range: selectedAttack,
    number: selectedAttackNumber,
    output: selectedAttackValue,
    min: 0,
    max: 220,
    step: 1,
    format: (value) => `${Math.round(value)}ms`
  },
  delayMs: {
    range: selectedDelay,
    number: selectedDelayNumber,
    output: selectedDelayValue,
    min: 0,
    max: 520,
    step: 1,
    format: (value) => `${Math.round(value)}ms`
  },
  wobble: {
    range: selectedWobble,
    number: selectedWobbleNumber,
    output: selectedWobbleValue,
    min: 0,
    max: 4,
    step: 0.01,
    format: (value) => value.toFixed(2)
  },
  delaySend: {
    range: selectedNoteDelaySend,
    number: selectedNoteDelaySendNumber,
    output: selectedNoteDelaySendValue,
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => value.toFixed(2)
  },
  reverbSend: {
    range: selectedNoteReverbSend,
    number: selectedNoteReverbSendNumber,
    output: selectedNoteReverbSendValue,
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => value.toFixed(2)
  }
};

function setPairedControl(range, numberInput, output, value, formatter = (next) => String(next)) {
  const stringValue = String(value);
  range.value = stringValue;
  numberInput.value = stringValue;
  output.textContent = formatter(value);
}

function wireNumberControl(input, commit) {
  input.addEventListener("input", () => {
    if (input.value === "") return;
    commit(input.value);
  });
  input.addEventListener("change", () => commit(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commit(input.value);
    input.blur();
  });
}

function normalizeEditorConfig(config = {}) {
  return normalizeSequencedRhythmConfig(config, { pressure: 0.45 });
}

function bars() {
  return state.config.patterns.jazz.bars;
}

function loopCount() {
  return Math.max(1, Math.ceil(bars().length / LOOP_BAR_COUNT));
}

function localBarIndex(barIndex = state.activeBar) {
  return ((Math.round(barIndex) % LOOP_BAR_COUNT) + LOOP_BAR_COUNT) % LOOP_BAR_COUNT;
}

function loopIndexForBar(barIndex = state.activeBar) {
  return Math.max(0, Math.min(MAX_LOOP_COUNT - 1, Math.floor(Math.max(0, barIndex) / LOOP_BAR_COUNT)));
}

function syncActiveLoopToBar() {
  state.activeLoopIndex = Math.max(0, Math.min(loopCount() - 1, loopIndexForBar(state.activeBar)));
}

function clampActiveBar() {
  const lastBar = Math.max(0, bars().length - 1);
  state.activeBar = Math.max(0, Math.min(lastBar, Math.round(state.activeBar)));
  syncActiveLoopToBar();
}

function loopStartBar(loopIndex = state.activeLoopIndex) {
  return Math.max(0, Math.min(loopCount() - 1, loopIndex)) * LOOP_BAR_COUNT;
}

function activeLoopLength() {
  if (!state.loopBar) return 0;
  return Math.max(1, Math.min(2, Math.round(state.loopBarLength || 1)));
}

function clampLoopStart(start = state.activeBar, length = activeLoopLength() || 1) {
  const safeLength = Math.max(1, Math.round(length) || 1);
  const maxStart = Math.max(0, bars().length - safeLength);
  return Math.max(0, Math.min(maxStart, Math.round(Number(start) || 0)));
}

function barLabel(barIndex) {
  return `${loopIndexForBar(barIndex) + 1}.${String(localBarIndex(barIndex) + 1).padStart(2, "0")}`;
}

function loopRangeLabel(start = state.loopBarIndex, length = activeLoopLength() || 1) {
  const safeStart = clampLoopStart(start, length);
  if (length <= 1) return barLabel(safeStart);
  return `${barLabel(safeStart)}-${barLabel(safeStart + length - 1)}`;
}

function loopBarSlice(loopIndex = state.activeLoopIndex) {
  const start = loopStartBar(loopIndex);
  return Array.from({ length: LOOP_BAR_COUNT }, (_, index) => clone(bars()[start + index] || bars()[index % Math.max(1, bars().length)] || {}));
}

function twoBarStart() {
  return activeLoopLength() === 2
    ? clampLoopStart(state.loopBarIndex, 2)
    : clampLoopStart(state.activeBar, 2);
}

function twoBarPair(start = twoBarStart()) {
  const safeStart = clampLoopStart(start, 2);
  const source = bars();
  return [
    clone(source[safeStart] || {}),
    clone(source[safeStart + 1] || source[safeStart] || {})
  ];
}

function updateTwoBarClipboardButtons() {
  const pasteButton = $("#paste-two-bars");
  if (pasteButton) pasteButton.disabled = !state.twoBarClipboard;
}

function selectedTrack() {
  return state.selected?.hit || null;
}

function trackName(hit) {
  return ROW_LABELS[hit] || hit || "track";
}

function updateTrackClipboardButtons() {
  const hasTrack = Boolean(selectedTrack());
  const canPaste = hasTrack && Boolean(state.trackClipboard);
  const copyButton = $("#copy-track-two-bars");
  const pasteButton = $("#paste-track-two-bars");
  const fillButton = $("#fill-rest-track");
  if (copyButton) copyButton.disabled = !hasTrack;
  if (pasteButton) pasteButton.disabled = !canPaste;
  if (fillButton) fillButton.disabled = !canPaste;
}

function syncAfterArrangementEdit() {
  clampActiveBar();
  applyConfig();
  buildLoopTabs();
  buildBarTabs();
  renderStepGrid();
  refreshLoopBarButton();
  if (state.selected) {
    selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step");
  }
  updateTwoBarClipboardButtons();
  updateTrackClipboardButtons();
}

function copyTwoBars() {
  const start = twoBarStart();
  state.twoBarClipboard = {
    start,
    bars: twoBarPair(start)
  };
  updateTwoBarClipboardButtons();
  status.textContent = `Copied bars ${loopRangeLabel(start, 2)}`;
}

function pasteTwoBars() {
  if (!state.twoBarClipboard) {
    copyTwoBars();
    return;
  }
  const start = clampLoopStart(state.activeBar, 2);
  const target = bars();
  target[start] = clone(state.twoBarClipboard.bars[0]);
  target[start + 1] = clone(state.twoBarClipboard.bars[1]);
  state.activeBar = start;
  if (activeLoopLength()) state.loopBarIndex = clampLoopStart(start, activeLoopLength());
  syncAfterArrangementEdit();
  status.textContent = `Pasted 2 bars at ${loopRangeLabel(start, 2)}`;
}

function fillRestWithTwoBars() {
  const start = twoBarStart();
  const pair = state.twoBarClipboard?.bars || twoBarPair(start);
  if (!state.twoBarClipboard) {
    state.twoBarClipboard = { start, bars: pair.map(clone) };
  }
  const target = bars();
  for (let index = start; index < target.length; index += 1) {
    target[index] = clone(pair[(index - start) % 2]);
  }
  state.activeBar = start;
  if (activeLoopLength()) state.loopBarIndex = clampLoopStart(start, activeLoopLength());
  syncAfterArrangementEdit();
  status.textContent = `Filled bars ${start + 1}-${target.length} from ${loopRangeLabel(start, 2)}`;
}

function copyTrackTwoBars() {
  const hit = selectedTrack();
  if (!hit) {
    status.textContent = "Select a track row first";
    return;
  }
  const start = twoBarStart();
  const source = bars();
  state.trackClipboard = {
    hit,
    start,
    bars: [
      clone(source[start]?.[hit] || []),
      clone(source[start + 1]?.[hit] || [])
    ]
  };
  updateTrackClipboardButtons();
  status.textContent = `Copied ${trackName(hit)} track ${loopRangeLabel(start, 2)}`;
}

function pasteTrackTwoBars() {
  const hit = selectedTrack();
  if (!hit) {
    status.textContent = "Select a target track row first";
    return;
  }
  if (!state.trackClipboard) {
    copyTrackTwoBars();
    return;
  }
  const start = clampLoopStart(state.activeBar, 2);
  const target = bars();
  target[start] = target[start] || {};
  target[start + 1] = target[start + 1] || {};
  target[start][hit] = clone(state.trackClipboard.bars[0] || []);
  target[start + 1][hit] = clone(state.trackClipboard.bars[1] || []);
  state.activeBar = start;
  if (activeLoopLength()) state.loopBarIndex = clampLoopStart(start, activeLoopLength());
  syncAfterArrangementEdit();
  status.textContent = `Pasted ${trackName(state.trackClipboard.hit)} into ${trackName(hit)} at ${loopRangeLabel(start, 2)}`;
}

function fillRestWithTrackTwoBars() {
  const hit = selectedTrack();
  if (!hit) {
    status.textContent = "Select a target track row first";
    return;
  }
  if (!state.trackClipboard) {
    copyTrackTwoBars();
    return;
  }
  const start = clampLoopStart(state.activeBar, 2);
  const target = bars();
  for (let index = start; index < target.length; index += 1) {
    target[index] = target[index] || {};
    target[index][hit] = clone(state.trackClipboard.bars[(index - start) % 2] || []);
  }
  state.activeBar = start;
  if (activeLoopLength()) state.loopBarIndex = clampLoopStart(start, activeLoopLength());
  syncAfterArrangementEdit();
  status.textContent = `Filled ${trackName(hit)} from ${loopRangeLabel(start, 2)} to the end`;
}

function setLoopCount(nextCount, { duplicateFrom = state.activeLoopIndex } = {}) {
  const targetCount = Math.max(1, Math.min(MAX_LOOP_COUNT, Math.round(Number(nextCount) || 1)));
  const currentCount = loopCount();
  if (targetCount === currentCount) return;
  const nextBars = bars();
  if (targetCount > currentCount) {
    const source = loopBarSlice(duplicateFrom);
    for (let index = currentCount; index < targetCount; index += 1) {
      nextBars.push(...source.map(clone));
    }
  } else {
    nextBars.length = targetCount * LOOP_BAR_COUNT;
    if (state.activeLoopIndex >= targetCount) {
      state.activeLoopIndex = targetCount - 1;
      state.activeBar = loopStartBar(state.activeLoopIndex) + localBarIndex(state.activeBar);
    }
  }
  clampActiveBar();
  applyConfig();
  buildLoopTabs();
  buildBarTabs();
  renderStepGrid();
  status.textContent = `Song has ${targetCount} ${targetCount === 1 ? "32-bar loop" : "32-bar loops"}`;
}

function duplicateCurrentLoop() {
  const currentCount = loopCount();
  if (currentCount >= MAX_LOOP_COUNT) {
    status.textContent = `Maximum is ${MAX_LOOP_COUNT} loops`;
    return;
  }
  bars().push(...loopBarSlice(state.activeLoopIndex).map(clone));
  state.activeLoopIndex = currentCount;
  state.activeBar = loopStartBar(state.activeLoopIndex);
  applyConfig();
  buildLoopTabs();
  buildBarTabs();
  renderStepGrid();
  status.textContent = `Duplicated to loop ${state.activeLoopIndex + 1}`;
}

function deleteCurrentLoop() {
  const currentCount = loopCount();
  if (currentCount <= 1) {
    status.textContent = "Keep at least one loop";
    return;
  }
  const start = loopStartBar(state.activeLoopIndex);
  bars().splice(start, LOOP_BAR_COUNT);
  state.activeLoopIndex = Math.max(0, Math.min(state.activeLoopIndex, currentCount - 2));
  state.activeBar = loopStartBar(state.activeLoopIndex) + localBarIndex(state.activeBar);
  clampActiveBar();
  applyConfig();
  buildLoopTabs();
  buildBarTabs();
  renderStepGrid();
  status.textContent = "Deleted current loop";
}

function patternBar(index = state.activeBar) {
  return state.config.patterns.jazz.bars[index];
}

function normalizeHitEntry(entry) {
  if (Array.isArray(entry)) {
    const [step, velocity, options] = entry;
    return {
      step: Math.round(clamp(step, 0, 15, 0)),
      velocity: clamp(velocity, 0, 1, 0),
      options: normalizeStepOptions(options)
    };
  }
  if (entry && typeof entry === "object") {
    const optionSource = entry.options && typeof entry.options === "object"
      ? { ...entry.options, ...entry }
      : entry;
    return {
      step: Math.round(clamp(entry.step, 0, 15, 0)),
      velocity: clamp(entry.velocity, 0, 1, 0),
      options: normalizeStepOptions(optionSource)
    };
  }
  return { step: 0, velocity: 0, options: normalizeStepOptions() };
}

function hasStepOptions(options = {}) {
  return Object.entries(STEP_OPTION_DEFAULTS)
    .some(([key, value]) => Math.abs(Number(options[key] ?? value) - value) > 0.0001);
}

function serializeHitEntry(entry) {
  const normalized = normalizeHitEntry(entry);
  const tuple = [
    normalized.step,
    Number(normalized.velocity.toFixed(2))
  ];
  if (hasStepOptions(normalized.options)) {
    tuple.push({
      pitch: normalized.options.pitch,
      offsetMs: normalized.options.offsetMs,
      attackMs: normalized.options.attackMs,
      delayMs: normalized.options.delayMs,
      delaySend: Number(normalized.options.delaySend.toFixed(2)),
      reverbSend: Number(normalized.options.reverbSend.toFixed(2)),
      dubEcho: Number(normalized.options.dubEcho.toFixed(2)),
      wobble: Number(normalized.options.wobble.toFixed(2))
    });
  }
  return tuple;
}

function hitMap(hit, bar = patternBar()) {
  return new Map((bar[hit] || []).map((entry) => {
    const normalized = normalizeHitEntry(entry);
    return [normalized.step, normalized];
  }));
}

function getHitData(hit, step, barIndex = state.activeBar) {
  const isGeneratedRow = !PATTERN_ROW_IDS.has(hit);
  const existing = hitMap(hit, state.config.patterns.jazz.bars[barIndex]).get(step);
  if (existing) {
    return {
      ...existing,
      generated: isGeneratedRow,
      label: isGeneratedRow ? ROW_LABELS[hit] || hit : ""
    };
  }
  if (isGeneratedRow && state.config.generatedRowsEditable < 0.5) {
    return getGeneratedHitData(hit, step, barIndex);
  }
  return {
    step,
    velocity: 0,
    options: normalizeStepOptions(),
    generated: isGeneratedRow,
    label: ""
  };
}

function setHitData(hit, step, patch, barIndex = state.activeBar) {
  const bar = state.config.patterns.jazz.bars[barIndex];
  const next = hitMap(hit, bar);
  const current = getHitData(hit, step, barIndex);
  const merged = {
    ...current,
    velocity: patch.velocity ?? current.velocity,
    options: normalizeStepOptions({
      ...current.options,
      ...(patch.options || {})
    })
  };
  merged.step = step;
  merged.velocity = clamp(merged.velocity, 0, 1, 0);
  if (merged.velocity <= 0.005) next.delete(step);
  else next.set(step, merged);
  bar[hit] = Array.from(next.values())
    .sort((a, b) => a.step - b.step)
    .map(serializeHitEntry);
  applyConfig();
}

function setHitVelocity(hit, step, velocity, barIndex = state.activeBar) {
  setHitData(hit, step, { velocity: Number(velocity) }, barIndex);
}

function getHitVelocity(hit, step, barIndex = state.activeBar) {
  return getHitData(hit, step, barIndex).velocity || 0;
}

function generatedEventsAtStep(step, barIndex = state.activeBar, pressure = state.intensity) {
  return generatedSynthEventsForStep({
    phraseBar: barIndex,
    step,
    pressure,
    config: state.config
  });
}

function getGeneratedHitData(hit, step, barIndex = state.activeBar, pressure = state.intensity) {
  const events = generatedEventsAtStep(step, barIndex, pressure).filter((event) => event.track === hit);
  if (!events.length) {
    return {
      step,
      velocity: 0,
      options: normalizeStepOptions(),
      generated: true,
      label: ""
    };
  }
  const strongest = events.reduce((best, event) => (event.velocity > best.velocity ? event : best), events[0]);
  return {
    step,
    velocity: clamp(strongest.velocity, 0, 1, 0),
    options: normalizeStepOptions({ pitch: strongest.pitch || 0 }),
    generated: true,
    label: strongest.label || hit
  };
}

function hitIndexForStep(hit, step, barIndex = state.activeBar) {
  const hits = state.config.patterns.jazz.bars[barIndex]?.[hit] || [];
  return hits
    .map(normalizeHitEntry)
    .sort((a, b) => a.step - b.step)
    .findIndex((entry) => entry.step === step);
}

function formatPitch(value) {
  const rounded = Math.round(Number(value) || 0);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function noteNameForPitch(value) {
  const rounded = Math.round(Number(value) || 0);
  const midiNote = A1_MIDI_NOTE + rounded;
  const pitchClass = ((midiNote % 12) + 12) % 12;
  const octave = Math.floor(midiNote / 12) - 1;
  return `${NOTE_NAMES[pitchClass]}${octave}`;
}

function scaleSemitoneForIndex(scaleIndex) {
  const index = Math.round(Number(scaleIndex) || 0);
  const wrapped = ((index % SYNTH_SCALE.length) + SYNTH_SCALE.length) % SYNTH_SCALE.length;
  const octaveOffset = Math.floor(index / SYNTH_SCALE.length);
  return SYNTH_SCALE[wrapped] + octaveOffset * 12;
}

function bassBasePitch(step, barIndex = state.activeBar) {
  const hitIndex = Math.max(0, hitIndexForStep("bass", step, barIndex));
  const noteIndex = sequencedBassPitchForStep({
    phraseBar: barIndex,
    hitIndex,
    step
  });
  return scaleSemitoneForIndex(noteIndex);
}

function displayedPitchForHit(hit, step, options, barIndex = state.activeBar) {
  const offset = Number(options?.pitch) || 0;
  return hit === "bass" ? bassBasePitch(step, barIndex) + offset : offset;
}

function storedPitchForDisplay(hit, step, displayedPitch, barIndex = state.activeBar) {
  const pitch = Number(displayedPitch) || 0;
  return hit === "bass" ? pitch - bassBasePitch(step, barIndex) : pitch;
}

function selectedTrackBusSend(hit = state.selected?.hit) {
  return clamp(state.config.trackBusSends?.[hit], 0, 1, 0);
}

function selectedTrackReverbSend(hit = state.selected?.hit) {
  return clamp(state.config.trackReverbSends?.[hit], 0, 1, 0);
}

function renderSelectedPiano(displayedPitch = null, basePitch = null) {
  if (!selectedPiano) return;
  selectedPiano.innerHTML = "";
  const pitch = Number(displayedPitch);
  if (!Number.isFinite(pitch)) {
    selectedPiano.classList.add("is-empty");
    selectedPiano.textContent = "No sounding note";
    return;
  }
  selectedPiano.classList.remove("is-empty");
  const roundedPitch = Math.round(pitch);
  const roundedBase = Number.isFinite(Number(basePitch)) ? Math.round(Number(basePitch)) : null;
  const label = document.createElement("span");
  label.className = "selected-piano-note";
  label.textContent = `${noteNameForPitch(roundedPitch)} ${formatPitch(roundedPitch)}`;
  label.title = roundedBase === null
    ? "Selected pitch"
    : `Base ${noteNameForPitch(roundedBase)} ${formatPitch(roundedBase)} plus saved trim ${formatPitch(roundedPitch - roundedBase)}`;
  const keys = document.createElement("div");
  keys.className = "selected-piano-keys";
  const start = PITCH_SLIDER_MIN;
  const end = PITCH_SLIDER_MAX;
  for (let note = start; note <= end; note += 1) {
    const key = document.createElement("span");
    const midiNote = A1_MIDI_NOTE + note;
    key.className = "selected-piano-key";
    key.dataset.pitch = String(note);
    key.role = "button";
    key.tabIndex = 0;
    key.classList.toggle("is-black", BLACK_NOTE_PITCH_CLASSES.has(((midiNote % 12) + 12) % 12));
    key.classList.toggle("is-active", note === roundedPitch);
    key.classList.toggle("is-base", roundedBase !== null && note === roundedBase && note !== roundedPitch);
    key.title = `${noteNameForPitch(note)} ${formatPitch(note)}`;
    key.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    key.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void choosePianoPitch(note);
    });
    key.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      void choosePianoPitch(note);
    });
    keys.appendChild(key);
  }
  selectedPiano.append(label, keys);
}

function selectedPreviewOptions() {
  if (!state.selected) return normalizeStepOptions();
  return normalizeStepOptions(getHitData(state.selected.hit, state.selected.step).options);
}

async function previewPianoPitch(displayedPitch, effectOptions = selectedPreviewOptions()) {
  if (runningFromFile) {
    status.textContent = "Open the localhost version for audio";
    return;
  }
  const pitch = Number(displayedPitch);
  if (!Number.isFinite(pitch)) return;
  const options = normalizeStepOptions(effectOptions);
  await state.engine.ensureContext();
  await state.engine.context.resume();
  state.engine.setVolume(0.62, { immediate: true });
  const frequency = SYNTH_ROOT_HZ * 2 ** (pitch / 12);
  const now = state.engine.context.currentTime + 0.015 + Math.max(0, options.offsetMs / 1000);
  state.engine.playBassSynth(now, frequency, {
    gain: 0.12,
    duration: 0.42,
    style: "jazz",
    attackMs: options.attackMs,
    delayMs: options.delayMs,
    delaySend: options.delaySend,
    reverbSend: options.reverbSend,
    dubEcho: options.dubEcho
  });
}

async function choosePianoPitch(displayedPitch) {
  if (!ensureSelectedFromDom()) {
    await previewPianoPitch(displayedPitch);
    return;
  }
  if (!selectedPitch.disabled) {
    setSelectedOptionFromControl("pitch", displayedPitch);
  } else {
    renderSelectedPiano(displayedPitch, null);
  }
  await previewPianoPitch(displayedPitch, selectedPreviewOptions());
  status.textContent = `Preview pitch ${noteNameForPitch(displayedPitch)} ${formatPitch(displayedPitch)}`;
}

function syncSelectedBusSendDisplay() {
  const send = selectedTrackBusSend();
  setPairedControl(selectedBusSend, selectedBusSendNumber, selectedBusSendValue, send, (next) => next.toFixed(2));
  const reverbSend = selectedTrackReverbSend();
  setPairedControl(selectedReverbSend, selectedReverbSendNumber, selectedReverbSendValue, reverbSend, (next) => next.toFixed(2));
}

function syncSelectedPitchDisplay(barIndex = state.activeBar) {
  if (!state.selected) return;
  const { hit, step } = state.selected;
  const hitData = getHitData(hit, step, barIndex);
  if (hitData.velocity <= 0.005) {
    selectedPitch.min = String(PITCH_SLIDER_MIN);
    selectedPitch.max = String(PITCH_SLIDER_MAX);
    selectedPitch.value = "0";
    selectedPitchNumber.value = "0";
    selectedPitchValue.textContent = "-";
    selectedPitch.title = "No note on this step.";
    renderSelectedPiano(null);
    return;
  }
  const displayedPitch = displayedPitchForHit(hit, step, hitData.options, barIndex);
  const basePitch = hit === "bass" ? bassBasePitch(step, barIndex) : null;
  selectedPitch.min = String(PITCH_SLIDER_MIN);
  selectedPitch.max = String(PITCH_SLIDER_MAX);
  selectedPitchNumber.min = selectedPitch.min;
  selectedPitchNumber.max = selectedPitch.max;
  setPairedControl(selectedPitch, selectedPitchNumber, selectedPitchValue, displayedPitch, formatPitch);
  renderSelectedPiano(displayedPitch, basePitch);
  selectedPitch.title = hit === "bass"
    ? `Bass base pitch ${formatPitch(bassBasePitch(step, barIndex))}, saved trim ${formatPitch(hitData.options.pitch)}`
    : "Pitch";
}

function previewConfig() {
  const config = clone(state.config);
  config.soloTracks = Array.from(state.soloTracks);
  const loopLength = activeLoopLength();
  if (loopLength > 0) {
    const loopStart = clampLoopStart(state.loopBarIndex, loopLength);
    const sourceBars = Array.from({ length: loopLength }, (_, index) => clone(
      state.config.patterns.jazz.bars[loopStart + index]
        || state.config.patterns.jazz.bars[loopStart]
        || state.config.patterns.jazz.bars[state.activeBar]
        || {}
    ));
    config.patterns.jazz.bars = Array.from({ length: LOOP_BAR_COUNT }, (_, index) => clone(sourceBars[index % loopLength]));
    config.loopPhraseBar = loopLength === 1 ? loopStart : null;
    config.loopPhraseBarStart = loopStart;
    config.loopPhraseBarLength = loopLength;
  } else {
    config.loopPhraseBar = null;
    config.loopPhraseBarStart = null;
    config.loopPhraseBarLength = 0;
  }
  return config;
}

function refreshLoopBarButton() {
  const loopLength = activeLoopLength();
  const loopButton = $("#loop-bar");
  const twoBarButton = $("#loop-two-bars");
  if (loopButton) {
    loopButton.classList.toggle("is-active", loopLength === 1);
    loopButton.textContent = loopLength === 1 ? `Loop Bar ${loopRangeLabel(state.loopBarIndex, 1)}` : "Loop Bar";
  }
  if (twoBarButton) {
    twoBarButton.classList.toggle("is-active", loopLength === 2);
    twoBarButton.textContent = loopLength === 2 ? `Loop 2 Bars ${loopRangeLabel(state.loopBarIndex, 2)}` : "Loop 2 Bars";
  }
  $("#play-song")?.classList.toggle("is-active", loopLength === 0);
}

function ensureSelectedFromDom() {
  if (state.selected) return true;
  const selectedButton = stepGrid.querySelector(".step-button.is-selected");
  if (!selectedButton) return false;
  state.selected = {
    hit: selectedButton.dataset.hit,
    step: Number(selectedButton.dataset.step),
    mode: "step",
    generated: selectedButton.dataset.type === "generated"
  };
  return true;
}

function updateSelectedOption(field, value) {
  if (!ensureSelectedFromDom()) return;
  setHitData(state.selected.hit, state.selected.step, {
    options: { [field]: value }
  });
  selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step");
  renderStepGrid();
}

function soundingStepForRow(hit, playheadStep, barIndex = state.activeBar) {
  const step = Math.round(clamp(playheadStep, 0, 15, 0));
  for (let offset = 0; offset < 16; offset += 1) {
    const candidate = (step - offset + 16) % 16;
    if (getHitData(hit, candidate, barIndex).velocity > 0.005) return candidate;
  }
  return step;
}

function setSelectedVelocityFromControl(value = selectedVelocity.value) {
  if (!ensureSelectedFromDom()) return;
  const velocity = clamp(value, 0, 0.9, 0);
  setPairedControl(selectedVelocity, selectedVelocityNumber, selectedVelocityValue, Number(velocity.toFixed(2)), (next) => next.toFixed(2));
  setHitVelocity(state.selected.hit, state.selected.step, velocity);
  selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step");
  renderStepGrid();
}

function setSelectedOptionFromControl(field, value) {
  let number = Number(value);
  if (field === "pitch" && state.selected) {
    const min = Number(selectedPitch.min);
    const max = Number(selectedPitch.max);
    const displayedPitch = Math.round(clamp(
      number,
      Number.isFinite(min) ? min : PITCH_SLIDER_MIN,
      Number.isFinite(max) ? max : PITCH_SLIDER_MAX,
      0
    ));
    setPairedControl(selectedPitch, selectedPitchNumber, selectedPitchValue, displayedPitch, formatPitch);
    number = storedPitchForDisplay(state.selected.hit, state.selected.step, displayedPitch);
  } else if (selectedOptionControls[field]) {
    const control = selectedOptionControls[field];
    number = control.step >= 1
      ? Math.round(clamp(number, control.min, control.max, STEP_OPTION_DEFAULTS[field] ?? 0))
      : clamp(number, control.min, control.max, STEP_OPTION_DEFAULTS[field] ?? 0);
    setPairedControl(control.range, control.number, control.output, number, control.format);
  }
  updateSelectedOption(field, number);
}

function selectedDubEchoAmount(options = {}) {
  return Number(clamp(options.dubEcho, 0, 1, 0).toFixed(2));
}

function syncSelectedDubEchoDisplay(options = null) {
  const nextOptions = options || (state.selected ? getHitData(state.selected.hit, state.selected.step).options : {});
  const amount = selectedDubEchoAmount(nextOptions);
  setPairedControl(selectedDubEcho, selectedDubEchoNumber, selectedDubEchoValue, amount, (next) => next.toFixed(2));
}

function setSelectedDubEchoFromControl(value = selectedDubEcho.value) {
  if (!ensureSelectedFromDom()) {
    status.textContent = "Select a note or row first";
    return;
  }
  const hit = state.selected.hit;
  const amount = clamp(value, 0, 1, 0);
  setPairedControl(selectedDubEcho, selectedDubEchoNumber, selectedDubEchoValue, Number(amount.toFixed(2)), (next) => next.toFixed(2));
  const patch = { dubEcho: Number(amount.toFixed(2)) };
  if (state.selected.mode === "row") {
    const length = activeLoopLength() || 1;
    const start = activeLoopLength()
      ? clampLoopStart(state.loopBarIndex, length)
      : state.activeBar;
    let applied = 0;
    for (let offset = 0; offset < length; offset += 1) {
      const barIndex = start + offset;
      const rowHits = state.config.patterns.jazz.bars[barIndex]?.[hit] || [];
      rowHits.map(normalizeHitEntry).forEach((entry) => {
        if (entry.velocity <= 0.005) return;
        setHitData(hit, entry.step, { options: patch }, barIndex);
        applied += 1;
      });
    }
    if (!applied) {
      syncSelectedDubEchoDisplay();
      status.textContent = `${trackName(hit)} row has no notes`;
      return;
    }
    selectStep(hit, state.selected.step, "row");
    setPairedControl(selectedDubEcho, selectedDubEchoNumber, selectedDubEchoValue, Number(amount.toFixed(2)), (next) => next.toFixed(2));
    renderStepGrid();
    status.textContent = `Dub echo ${amount.toFixed(2)} on ${applied} ${trackName(hit)} notes`;
    return;
  }
  const current = getHitData(hit, state.selected.step);
  if (current.velocity <= 0.005) {
    status.textContent = "Select a note with volume first";
    return;
  }
  setHitData(hit, state.selected.step, { options: patch });
  selectStep(hit, state.selected.step, state.selected.mode || "step");
  setPairedControl(selectedDubEcho, selectedDubEchoNumber, selectedDubEchoValue, Number(amount.toFixed(2)), (next) => next.toFixed(2));
  renderStepGrid();
  status.textContent = `Dub echo ${amount.toFixed(2)} on ${trackName(hit)} ${state.selected.step + 1}`;
}

function setSelectedBusSendFromControl(value = selectedBusSend.value) {
  if (!ensureSelectedFromDom()) return;
  const send = clamp(value, 0, 1, 0);
  state.config.trackBusSends = {
    ...(state.config.trackBusSends || {}),
    [state.selected.hit]: send
  };
  setPairedControl(selectedBusSend, selectedBusSendNumber, selectedBusSendValue, Number(send.toFixed(2)), (next) => next.toFixed(2));
  applyConfig();
}

function setSelectedReverbSendFromControl(value = selectedReverbSend.value) {
  if (!ensureSelectedFromDom()) return;
  const send = clamp(value, 0, 1, 0);
  state.config.trackReverbSends = {
    ...(state.config.trackReverbSends || {}),
    [state.selected.hit]: send
  };
  setPairedControl(selectedReverbSend, selectedReverbSendNumber, selectedReverbSendValue, Number(send.toFixed(2)), (next) => next.toFixed(2));
  applyConfig();
}

function buildStepGrid() {
  stepGrid.innerHTML = "";
  stepGrid.appendChild(Object.assign(document.createElement("div"), {
    className: "step-header",
    textContent: "Track"
  }));
  for (let step = 0; step < 16; step += 1) {
    const header = document.createElement("div");
    header.className = "step-header";
    header.textContent = String(step + 1).padStart(2, "0");
    stepGrid.appendChild(header);
  }
  GRID_ROWS.forEach(({ id: hit, label, type }) => {
    const rowLabel = document.createElement("div");
    rowLabel.className = `track-label ${type === "generated" ? "is-generated" : ""}`;
    rowLabel.dataset.hit = hit;
    rowLabel.dataset.type = type;
    rowLabel.tabIndex = 0;
    rowLabel.title = `Select ${label} row`;
    const rowText = document.createElement("span");
    rowText.textContent = label;
    const soloButton = document.createElement("button");
    soloButton.type = "button";
    soloButton.className = "solo-button";
    soloButton.dataset.soloTrack = hit;
    soloButton.textContent = "S";
    soloButton.title = `Solo ${label}`;
    soloButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSolo(hit);
    });
    rowLabel.addEventListener("click", () => {
      selectRow(hit);
      renderStepGrid();
    });
    rowLabel.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectRow(hit);
      renderStepGrid();
    });
    rowLabel.append(rowText, soloButton);
    stepGrid.appendChild(rowLabel);
    for (let step = 0; step < 16; step += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `step-button ${type === "generated" ? "is-generated-step" : ""}`;
      button.dataset.hit = hit;
      button.dataset.type = type;
      button.dataset.step = String(step);
      button.dataset.beat = step % 4 === 0 ? "1" : "0";
      button.setAttribute("aria-label", `${label} step ${step + 1}`);
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      button.addEventListener("click", () => {
        const scrollLeft = stepGrid.scrollLeft;
        const scrollTop = stepGrid.scrollTop;
        const current = getHitData(hit, step);
        if (current.velocity <= 0.005) {
          setHitVelocity(hit, step, DEFAULT_VELOCITY[hit] ?? 0.5);
        }
        selectStep(hit, step, "step", state.activeBar, state.intensity, type === "generated");
        renderStepGrid();
        stepGrid.scrollLeft = scrollLeft;
        stepGrid.scrollTop = scrollTop;
      });
      stepGrid.appendChild(button);
    }
  });
  renderStepGrid();
}

function buildLoopTabs() {
  syncActiveLoopToBar();
  if (loopCountInput) {
    loopCountInput.max = String(MAX_LOOP_COUNT);
    loopCountInput.value = String(loopCount());
  }
  loopTabs.innerHTML = "";
  for (let index = 0; index < loopCount(); index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.loop = String(index);
    button.textContent = `Loop ${index + 1}`;
    button.title = `Bars ${index * LOOP_BAR_COUNT + 1}-${(index + 1) * LOOP_BAR_COUNT}`;
    button.classList.toggle("is-active", index === state.activeLoopIndex);
    button.addEventListener("click", () => {
      const local = localBarIndex(state.activeBar);
      state.activeLoopIndex = index;
      state.activeBar = loopStartBar(index) + local;
      clampActiveBar();
      if (activeLoopLength()) {
        state.loopBarIndex = clampLoopStart(state.activeBar, activeLoopLength());
        state.engine.setConfig(previewConfig());
        state.engine.seekToPhraseBar(state.activeBar, 0);
        state.playheadStep = 0;
        refreshLoopBarButton();
      } else if (state.playing) {
        state.engine.seekToPhraseBar(state.activeBar, 0);
        state.playheadStep = 0;
      }
      if (state.selected) {
        selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step");
      }
      buildLoopTabs();
      buildBarTabs();
      renderStepGrid();
      status.textContent = state.playing || activeLoopLength()
        ? `Jumped to loop ${index + 1}`
        : `Editing loop ${index + 1}`;
    });
    loopTabs.appendChild(button);
  }
}

function buildBarTabs() {
  syncActiveLoopToBar();
  barTabs.innerHTML = "";
  for (let localIndex = 0; localIndex < LOOP_BAR_COUNT; localIndex += 1) {
    const index = loopStartBar() + localIndex;
    if (!state.config.patterns.jazz.bars[index]) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.bar = String(index);
    button.dataset.localBar = String(localIndex);
    button.dataset.section = String(Math.floor(localIndex / 8) + 1);
    button.textContent = String(localIndex + 1).padStart(2, "0");
    button.title = `Loop ${state.activeLoopIndex + 1}, bar ${localIndex + 1} (song bar ${index + 1})`;
    button.addEventListener("click", () => {
      state.activeBar = index;
      syncActiveLoopToBar();
      if (activeLoopLength()) {
        state.loopBarIndex = clampLoopStart(index, activeLoopLength());
        state.engine.setConfig(previewConfig());
        state.engine.seekToPhraseBar(index, 0);
        state.playheadStep = 0;
        refreshLoopBarButton();
      } else if (state.playing) {
        state.engine.seekToPhraseBar(index, 0);
        state.playheadStep = 0;
        status.textContent = `Jumped to bar ${String(index + 1).padStart(2, "0")}`;
      }
      if (state.selected) {
        selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step");
      }
      clearPlayhead();
      renderStepGrid();
    });
    barTabs.appendChild(button);
  }
}

function renderStepGrid() {
  syncActiveLoopToBar();
  if (loopCountInput) loopCountInput.value = String(loopCount());
  loopTabs.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.loop) === state.activeLoopIndex);
  });
  document.querySelectorAll(".bar-tabs button").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.bar) === state.activeBar);
    button.classList.toggle("is-section-start", Number(button.dataset.localBar) % 8 === 0);
  });
  stepGrid.querySelectorAll(".step-button").forEach((button) => {
    const hit = button.dataset.hit;
    const step = Number(button.dataset.step);
    const hitData = getHitData(hit, step);
    const velocity = hitData.velocity;
    const isGeneratedRow = button.dataset.type === "generated";
    button.classList.toggle("is-on", velocity > 0);
    button.classList.toggle("is-generated-on", isGeneratedRow && hitData.generated && velocity > 0);
    button.classList.toggle("is-selected", state.selected?.hit === hit && state.selected?.step === step);
    button.classList.toggle("is-row-selected", state.selected?.hit === hit && state.selected?.mode === "row");
    button.style.setProperty("--level", String(Math.min(1, velocity / 0.9)));
    const displayedPitch = displayedPitchForHit(hit, step, hitData.options);
    button.dataset.note = isGeneratedRow && hitData.generated && velocity > 0
      ? hitData.label.slice(0, 6)
      : hit === "bass" && velocity > 0 ? formatPitch(displayedPitch) : "";
    const pitchLabel = hit === "bass"
      ? `pitch ${formatPitch(displayedPitch)} (offset ${formatPitch(hitData.options.pitch)})`
      : `pitch ${formatPitch(hitData.options.pitch)}`;
    button.title = `${hit} ${step + 1}: ${velocity.toFixed(2)} ${pitchLabel} offset ${hitData.options.offsetMs}ms`;
  });
  stepGrid.querySelectorAll(".track-label").forEach((label) => {
    label.classList.toggle("is-selected-row", state.selected?.hit === label.dataset.hit && state.selected?.mode === "row");
  });
  renderSoloButtons();
}

function selectStep(hit, step, mode = "step", barIndex = state.activeBar, pressure = state.intensity, generated = !PATTERN_ROW_IDS.has(hit)) {
  state.selected = { hit, step, mode, generated };
  const hitData = getHitData(hit, step, barIndex);
  const { velocity, options } = hitData;
  selectedLabel.textContent = mode === "row"
    ? `${hit} row · ${String(step + 1).padStart(2, "0")}${hitData.generated ? ` · ${hitData.label || "generated"}` : ""}`
    : `${hit} ${step + 1}${hitData.generated && hitData.label ? ` · ${hitData.label}` : ""}`;
  selectedControls.forEach((control) => {
    control.disabled = hitData.generated && state.config.generatedRowsEditable < 0.5;
  });
  setPairedControl(selectedVelocity, selectedVelocityNumber, selectedVelocityValue, velocity, (next) => next.toFixed(2));
  syncSelectedPitchDisplay(barIndex);
  setPairedControl(selectedOffset, selectedOffsetNumber, selectedOffsetValue, options.offsetMs, (next) => `${Math.round(next)}ms`);
  setPairedControl(selectedAttack, selectedAttackNumber, selectedAttackValue, options.attackMs, (next) => `${Math.round(next)}ms`);
  setPairedControl(selectedDelay, selectedDelayNumber, selectedDelayValue, options.delayMs, (next) => `${Math.round(next)}ms`);
  setPairedControl(selectedWobble, selectedWobbleNumber, selectedWobbleValue, options.wobble, (next) => next.toFixed(2));
  syncSelectedDubEchoDisplay(options);
  setPairedControl(selectedNoteDelaySend, selectedNoteDelaySendNumber, selectedNoteDelaySendValue, options.delaySend, (next) => next.toFixed(2));
  setPairedControl(selectedNoteReverbSend, selectedNoteReverbSendNumber, selectedNoteReverbSendValue, options.reverbSend, (next) => next.toFixed(2));
  syncSelectedBusSendDisplay();
  updateTrackClipboardButtons();
}

function selectRow(hit) {
  const playback = state.engine.getPlaybackState();
  const playheadStep = state.playing && playback.playing
    ? (playback.step + 15) % 16
    : state.playheadStep || state.selected?.step || 0;
  const barIndex = state.playing && playback.playing
    ? playback.phraseBar % state.config.patterns.jazz.bars.length
    : state.activeBar;
  const step = state.playing && playback.playing
    ? soundingStepForRow(hit, playheadStep, barIndex)
    : playheadStep;
  selectStep(hit, step, "row", barIndex, playback.activeBarIntensity ?? state.intensity);
}

function resetSelectedPanel() {
  state.selected = null;
  selectedLabel.textContent = "none";
  selectedControls.forEach((control) => {
    control.disabled = true;
  });
  setPairedControl(selectedVelocity, selectedVelocityNumber, selectedVelocityValue, 0, (next) => next.toFixed(2));
  selectedPitch.min = String(PITCH_SLIDER_MIN);
  selectedPitch.max = String(PITCH_SLIDER_MAX);
  selectedPitchNumber.min = selectedPitch.min;
  selectedPitchNumber.max = selectedPitch.max;
  setPairedControl(selectedPitch, selectedPitchNumber, selectedPitchValue, 0, formatPitch);
  renderSelectedPiano(null);
  setPairedControl(selectedOffset, selectedOffsetNumber, selectedOffsetValue, 0, (next) => `${Math.round(next)}ms`);
  setPairedControl(selectedAttack, selectedAttackNumber, selectedAttackValue, STEP_OPTION_DEFAULTS.attackMs, (next) => `${Math.round(next)}ms`);
  setPairedControl(selectedDelay, selectedDelayNumber, selectedDelayValue, 0, (next) => `${Math.round(next)}ms`);
  setPairedControl(selectedWobble, selectedWobbleNumber, selectedWobbleValue, 0, (next) => next.toFixed(2));
  setPairedControl(selectedDubEcho, selectedDubEchoNumber, selectedDubEchoValue, 0, (next) => next.toFixed(2));
  setPairedControl(selectedNoteDelaySend, selectedNoteDelaySendNumber, selectedNoteDelaySendValue, 0, (next) => next.toFixed(2));
  setPairedControl(selectedNoteReverbSend, selectedNoteReverbSendNumber, selectedNoteReverbSendValue, 0, (next) => next.toFixed(2));
  setPairedControl(selectedBusSend, selectedBusSendNumber, selectedBusSendValue, 0, (next) => next.toFixed(2));
  setPairedControl(selectedReverbSend, selectedReverbSendNumber, selectedReverbSendValue, 0, (next) => next.toFixed(2));
  updateTrackClipboardButtons();
}

function clearSelection() {
  if (!state.selected) return;
  setHitVelocity(state.selected.hit, state.selected.step, 0);
  resetSelectedPanel();
  renderStepGrid();
}

function toggleSolo(track) {
  if (state.soloTracks.has(track)) state.soloTracks.delete(track);
  else state.soloTracks.add(track);
  state.engine.setConfig(previewConfig());
  renderSoloButtons();
  status.textContent = state.soloTracks.size
    ? `Solo: ${Array.from(state.soloTracks).join(", ")}`
    : "Solo cleared";
}

function clearSolo() {
  state.soloTracks.clear();
  state.engine.setConfig(previewConfig());
  renderSoloButtons();
  status.textContent = "Solo cleared";
}

function renderSoloButtons() {
  document.querySelectorAll("[data-solo-track]").forEach((button) => {
    button.classList.toggle("is-active", state.soloTracks.has(button.dataset.soloTrack));
  });
}

function getPathValue(path) {
  return path.split(".").reduce((target, key) => target?.[key], state.config);
}

function setPathValue(path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((next, key) => next[key], state.config);
  target[last] = Number(value);
  applyConfig();
}

function syncSliders() {
  document.querySelectorAll("[data-config]").forEach((input) => {
    const value = getPathValue(input.dataset.config);
    input.value = String(value);
    const suffix = input.dataset.config.includes("OffsetMs") ? "ms" : "";
    input.nextElementSibling.textContent = input.dataset.config === "autoEchoEnabled"
      ? Number(value) >= 0.5 ? "on" : "off"
      : `${Number(value).toFixed(input.step.includes(".") ? 2 : 0)}${suffix}`;
  });
  // Sync transport BPM widget
  const bpm = state.config.patterns.jazz.bpm;
  const transportBpm = $("#transport-bpm");
  const transportBpmNumber = $("#transport-bpm-number");
  const transportBpmValue = $("#transport-bpm-value");
  if (transportBpm) transportBpm.value = String(bpm);
  if (transportBpmNumber) transportBpmNumber.value = String(bpm);
  if (transportBpmValue) transportBpmValue.textContent = String(Math.round(bpm));
  $("#intensity").value = String(state.intensity);
  $("#intensity-value").textContent = state.intensity.toFixed(2);
}

function applyZoom(level) {
  state.zoomLevel = level;
  stepGrid.classList.remove("step-grid--zoom-2", "step-grid--zoom-4", "step-grid--zoom-8");
  if (level > 1) stepGrid.classList.add(`step-grid--zoom-${level}`);
  document.querySelectorAll(".zoom-btn").forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.zoom) === level);
  });
}

function syncJson() {
  jsonOutput.value = JSON.stringify(state.config, null, 2);
}

function applyConfig() {
  state.config = normalizeEditorConfig(state.config);
  state.engine.setConfig(previewConfig());
  syncSliders();
  syncJson();
  if (state.selected) {
    syncSelectedPitchDisplay(state.activeBar);
    syncSelectedBusSendDisplay();
  }
}

async function startPlayback() {
  if (runningFromFile) {
    status.textContent = "Open the localhost version for audio";
    return;
  }
  try {
    state.playheadStep = 0;
    await state.engine.start({
      style: "jazz",
      volume: 0.62,
      phraseBar: state.activeBar,
      step: 0
    });
    state.playing = true;
    $("#play-toggle").textContent = "Pause";
    status.textContent = `Playing from ${barLabel(state.activeBar)}`;
    startUiTimer();
  } catch (error) {
    console.error("Rhythm sequencer audio failed to start", error);
    status.textContent = "Audio failed to start";
  }
}

function stopPlayback() {
  state.engine.stop();
  state.playing = false;
  if (state.uiTimer) {
    window.clearInterval(state.uiTimer);
    state.uiTimer = null;
  }
  $("#play-toggle").textContent = "Play";
  status.textContent = "Paused";
  clearPlayhead();
}

function setLoopPlayback(length) {
  state.loopBarLength = Math.max(0, Math.min(2, Math.round(Number(length) || 0)));
  state.loopBar = state.loopBarLength > 0;
  if (state.loopBar) {
    state.loopBarIndex = clampLoopStart(state.activeBar, state.loopBarLength);
  }
  state.engine.setConfig(previewConfig());
  refreshLoopBarButton();
}

function toggleBarLoop() {
  const nextLength = activeLoopLength() === 1 ? 0 : 1;
  setLoopPlayback(nextLength);
  status.textContent = nextLength
    ? `Looping bar ${loopRangeLabel(state.loopBarIndex, 1)}`
    : "Bar loop off";
}

function toggleTwoBarLoop() {
  const nextLength = activeLoopLength() === 2 ? 0 : 2;
  setLoopPlayback(nextLength);
  status.textContent = nextLength
    ? `Looping two bars ${loopRangeLabel(state.loopBarIndex, 2)}`
    : "Two-bar loop off";
}

function playFullSong() {
  setLoopPlayback(0);
  status.textContent = `Playing full ${state.config.patterns.jazz.bars.length}-bar track`;
}

function restartPlayback() {
  state.engine.stop();
  state.engine = new RhythmEngine({ config: previewConfig(), style: "jazz", volume: 0.58 });
  if (state.playing) void startPlayback();
  else status.textContent = "Restarted";
}

async function ensurePreviewPlayback() {
  if (!state.playing) {
    await startPlayback();
  }
  return state.playing;
}

async function previewDuckSound() {
  if (!await ensurePreviewPlayback()) return;
  state.engine.previewDuckHold();
  status.textContent = "Preview: duck hold sound";
}

async function previewHitSound() {
  if (!await ensurePreviewPlayback()) return;
  state.engine.accentImpact();
  status.textContent = "Preview: hit sound";
}

async function previewGameSound(kind) {
  if (!await ensurePreviewPlayback()) return;
  const previews = {
    boss: ["boss landed sound", () => state.engine.accentBossLanded()],
    wobble: ["funk wobble", () => state.engine.previewWobble()],
    echo: ["echo ping", () => state.engine.previewEchoPing()],
    "whale-down": ["duck wobble bend", () => state.engine.previewWhaleBend(-0.65)],
    "whale-up": ["rising wobble bend", () => state.engine.previewWhaleBend(0.72)],
    "space-drop": ["space drop", () => state.engine.previewSpaceDrop()],
    "space-pickup": ["space pickup", () => state.engine.previewSpacePickup()]
  };
  const preview = previews[kind];
  if (!preview) return;
  preview[1]();
  status.textContent = `Preview: ${preview[0]}`;
}

function startUiTimer() {
  if (state.uiTimer) window.clearInterval(state.uiTimer);
  state.uiTimer = window.setInterval(() => {
    state.engine.update({
      enabled: state.playing,
      style: "jazz",
      moving: true,
      danger: state.intensity,
      progress: state.intensity
    });
    updatePlayhead();
  }, 70);
}

function clearPlayhead() {
  stepGrid.querySelectorAll(".step-button").forEach((button) => {
    button.classList.remove("is-playhead", "is-playhead-empty");
  });
  barTabs.querySelectorAll("button").forEach((button) => button.classList.remove("is-playhead-bar"));
}

function followPlaybackBar(phraseBar) {
  if (phraseBar === state.activeBar) return;
  const previousLoop = state.activeLoopIndex;
  state.activeBar = phraseBar;
  syncActiveLoopToBar();
  if (state.activeLoopIndex !== previousLoop) {
    buildLoopTabs();
    buildBarTabs();
  }
  renderStepGrid();
  if (state.selected) {
    selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step");
  }
}

function updatePlayhead() {
  if (!state.playing) return;
  clearPlayhead();
  const playback = state.engine.getPlaybackState();
  if (!playback.playing) return;
  const step = (playback.step + 15) % 16;
  const phraseBar = playback.phraseBar % state.config.patterns.jazz.bars.length;
  const displayBar = phraseBar;
  state.playheadStep = step;
  followPlaybackBar(displayBar);
  if (state.selected?.mode === "row") {
    const selectedStep = soundingStepForRow(state.selected.hit, step, displayBar);
    selectStep(state.selected.hit, selectedStep, "row", displayBar, playback.activeBarIntensity);
    renderStepGrid();
  }
  stepGrid.querySelectorAll(`.step-button[data-step="${step}"]`).forEach((button) => {
    const hitData = getHitData(button.dataset.hit, step, displayBar);
    button.classList.add(hitData.velocity > 0.005 ? "is-playhead" : "is-playhead-empty");
  });
  const barButton = barTabs.querySelector(`button[data-bar="${displayBar}"]`);
  if (barButton) barButton.classList.add("is-playhead-bar");
  if (state.selected?.hit === "bass") {
    syncSelectedPitchDisplay(displayBar);
  }
}

function downloadConfigFallback(content) {
  const blob = new Blob([content], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "kamorebi-rhythm-sequence.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

async function downloadConfig() {
  state.config = normalizeEditorConfig(state.config);
  syncJson();
  const content = JSON.stringify(state.config, null, 2) + "\n";
  if (runningFromFile) {
    downloadConfigFallback(content);
    status.textContent = "Downloaded rhythm JSON; open the localhost version to save into the game";
    return;
  }
  try {
    const response = await fetch("/api/save-game-asset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: "rhythm-sequence.json",
        content
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Save failed");
    }
    status.textContent = result.backupPath
      ? `Saved game rhythm and backup ${result.backupPath}`
      : "Saved game rhythm";
  } catch (error) {
    console.error("Rhythm save failed", error);
    downloadConfigFallback(content);
    status.textContent = "Project save failed; downloaded JSON fallback";
  }
}

async function loadConfigFile(file) {
  const text = await file.text();
  state.config = normalizeEditorConfig(JSON.parse(text));
  state.activeBar = 0;
  state.activeLoopIndex = 0;
  state.twoBarClipboard = null;
  state.trackClipboard = null;
  resetSelectedPanel();
  applyConfig();
  buildLoopTabs();
  buildBarTabs();
  buildStepGrid();
  updateTwoBarClipboardButtons();
  updateTrackClipboardButtons();
  status.textContent = `Loaded ${file.name}`;
}

async function loadSavedRhythmConfig() {
  if (runningFromFile) return;
  try {
    const response = await fetch(SAVED_RHYTHM_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    state.config = normalizeEditorConfig(await response.json());
    state.activeBar = 0;
    state.activeLoopIndex = 0;
    state.twoBarClipboard = null;
    state.trackClipboard = null;
    resetSelectedPanel();
    applyConfig();
    buildLoopTabs();
    buildBarTabs();
    buildStepGrid();
    updateTwoBarClipboardButtons();
    updateTrackClipboardButtons();
    status.textContent = "Loaded game rhythm";
  } catch (error) {
    console.warn("Using sequencer defaults", error);
  }
}

function wireEvents() {
  $("#play-toggle").addEventListener("click", () => {
    if (state.playing) stopPlayback();
    else void startPlayback();
  });
  $("#restart").addEventListener("click", restartPlayback);
  $("#play-song").addEventListener("click", playFullSong);
  $("#loop-bar").addEventListener("click", toggleBarLoop);
  $("#loop-two-bars").addEventListener("click", toggleTwoBarLoop);
  $("#duplicate-loop").addEventListener("click", duplicateCurrentLoop);
  $("#delete-loop").addEventListener("click", deleteCurrentLoop);
  $("#copy-two-bars").addEventListener("click", copyTwoBars);
  $("#paste-two-bars").addEventListener("click", pasteTwoBars);
  $("#fill-rest-two-bars").addEventListener("click", fillRestWithTwoBars);
  $("#copy-track-two-bars").addEventListener("click", copyTrackTwoBars);
  $("#paste-track-two-bars").addEventListener("click", pasteTrackTwoBars);
  $("#fill-rest-track").addEventListener("click", fillRestWithTrackTwoBars);
  loopCountInput.addEventListener("change", () => setLoopCount(loopCountInput.value));
  loopCountInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    setLoopCount(loopCountInput.value);
    loopCountInput.blur();
  });
  $("#space-throw").addEventListener("click", () => {
    if (!state.playing) void startPlayback().then(() => state.engine.triggerDubThrow());
    else state.engine.triggerDubThrow();
  });
  $("#duck-sound").addEventListener("click", () => {
    void previewDuckSound();
  });
  $("#hit-sound").addEventListener("click", () => {
    void previewHitSound();
  });
  document.querySelectorAll("[data-preview-sound]").forEach((button) => {
    button.addEventListener("click", () => {
      void previewGameSound(button.dataset.previewSound);
    });
  });
  $("#intensity").addEventListener("input", (event) => {
    state.intensity = Number(event.target.value);
    $("#intensity-value").textContent = state.intensity.toFixed(2);
  });
  document.querySelectorAll("[data-config]").forEach((input) => {
    input.addEventListener("input", () => setPathValue(input.dataset.config, input.value));
  });
  // Transport BPM widget
  const transportBpm = $("#transport-bpm");
  const transportBpmNumber = $("#transport-bpm-number");
  const transportBpmValue = $("#transport-bpm-value");
  function applyTransportBpm(value) {
    const bpm = Math.round(clamp(value, 40, 220, 118));
    setPathValue("patterns.jazz.bpm", bpm);
    if (transportBpm) transportBpm.value = String(bpm);
    if (transportBpmNumber) transportBpmNumber.value = String(bpm);
    if (transportBpmValue) transportBpmValue.textContent = String(bpm);
    // also sync the mix panel slider
    const mixBpmSlider = document.querySelector('[data-config="patterns.jazz.bpm"]');
    if (mixBpmSlider) {
      mixBpmSlider.value = String(bpm);
      if (mixBpmSlider.nextElementSibling) mixBpmSlider.nextElementSibling.textContent = String(bpm);
    }
  }
  if (transportBpm) {
    transportBpm.addEventListener("input", () => applyTransportBpm(transportBpm.value));
  }
  if (transportBpmNumber) {
    wireNumberControl(transportBpmNumber, applyTransportBpm);
  }
  // Zoom buttons
  document.querySelectorAll(".zoom-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyZoom(Number(btn.dataset.zoom)));
  });
  document.querySelectorAll(".control-panel [data-solo-track]").forEach((button) => {
    button.addEventListener("click", () => toggleSolo(button.dataset.soloTrack));
  });
  document.querySelectorAll("[data-solo-clear]").forEach((button) => {
    button.addEventListener("click", clearSolo);
  });
  selectedVelocity.addEventListener("input", () => setSelectedVelocityFromControl());
  wireNumberControl(selectedVelocityNumber, setSelectedVelocityFromControl);
  selectedPitch.addEventListener("input", () => setSelectedOptionFromControl("pitch", selectedPitch.value));
  wireNumberControl(selectedPitchNumber, (value) => setSelectedOptionFromControl("pitch", value));
  selectedOffset.addEventListener("input", () => setSelectedOptionFromControl("offsetMs", selectedOffset.value));
  wireNumberControl(selectedOffsetNumber, (value) => setSelectedOptionFromControl("offsetMs", value));
  selectedAttack.addEventListener("input", () => setSelectedOptionFromControl("attackMs", selectedAttack.value));
  wireNumberControl(selectedAttackNumber, (value) => setSelectedOptionFromControl("attackMs", value));
  selectedDelay.addEventListener("input", () => setSelectedOptionFromControl("delayMs", selectedDelay.value));
  wireNumberControl(selectedDelayNumber, (value) => setSelectedOptionFromControl("delayMs", value));
  selectedWobble.addEventListener("input", () => setSelectedOptionFromControl("wobble", selectedWobble.value));
  wireNumberControl(selectedWobbleNumber, (value) => setSelectedOptionFromControl("wobble", value));
  selectedDubEcho.addEventListener("input", () => setSelectedDubEchoFromControl());
  wireNumberControl(selectedDubEchoNumber, setSelectedDubEchoFromControl);
  selectedNoteDelaySend.addEventListener("input", () => setSelectedOptionFromControl("delaySend", selectedNoteDelaySend.value));
  wireNumberControl(selectedNoteDelaySendNumber, (value) => setSelectedOptionFromControl("delaySend", value));
  selectedNoteReverbSend.addEventListener("input", () => setSelectedOptionFromControl("reverbSend", selectedNoteReverbSend.value));
  wireNumberControl(selectedNoteReverbSendNumber, (value) => setSelectedOptionFromControl("reverbSend", value));
  selectedBusSend.addEventListener("input", () => setSelectedBusSendFromControl());
  wireNumberControl(selectedBusSendNumber, setSelectedBusSendFromControl);
  selectedReverbSend.addEventListener("input", () => setSelectedReverbSendFromControl());
  wireNumberControl(selectedReverbSendNumber, setSelectedReverbSendFromControl);
  $("#clear-selected").addEventListener("click", clearSelection);
  $("#save-file").addEventListener("click", downloadConfig);
  $("#copy-json").addEventListener("click", async () => {
    await navigator.clipboard.writeText(JSON.stringify(state.config, null, 2));
    status.textContent = "Copied rhythm JSON";
  });
  $("#reset-defaults").addEventListener("click", () => {
    state.config = normalizeEditorConfig(clone(DEFAULT_RHYTHM_CONFIG));
    state.activeBar = 0;
    state.activeLoopIndex = 0;
    state.twoBarClipboard = null;
    state.trackClipboard = null;
    resetSelectedPanel();
    applyConfig();
    buildLoopTabs();
    buildBarTabs();
    buildStepGrid();
    updateTwoBarClipboardButtons();
    updateTrackClipboardButtons();
    status.textContent = "Reset to defaults";
  });
  $("#load-file").addEventListener("click", () => $("#load-input").click());
  $("#load-input").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) void loadConfigFile(file);
    event.target.value = "";
  });

  // ── Loop Track UI ──────────────────────────────────────────
  $("#add-loop-track-btn")?.addEventListener("click", () => {
    const dialog = /** @type {HTMLDialogElement} */ ($("#add-loop-dialog"));
    if (dialog) dialog.showModal();
  });
  $("#add-loop-cancel")?.addEventListener("click", () => {
    /** @type {HTMLDialogElement} */ ($("#add-loop-dialog"))?.close();
  });
  $("#add-loop-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const nameInput = /** @type {HTMLInputElement} */ ($("#loop-track-name"));
    const fileInput = /** @type {HTMLInputElement} */ ($("#loop-track-file"));
    const barsInput = /** @type {HTMLInputElement} */ ($("#loop-track-bars"));
    const name = nameInput?.value.trim();
    const file = fileInput?.files?.[0];
    const barsInFile = Math.max(1, Math.round(Number(barsInput?.value) || 4));
    if (!name || !file) return;
    void addLoopTrack(name, file, barsInFile);
    /** @type {HTMLDialogElement} */ ($("#add-loop-dialog"))?.close();
    if (nameInput) nameInput.value = "";
    if (fileInput) fileInput.value = "";
    if (barsInput) barsInput.value = "4";
  });

  // Loop region panel controls
  $("#loop-region-start")?.addEventListener("change", () => updateSelectedLoopRegion());
  $("#loop-region-len")?.addEventListener("change", () => updateSelectedLoopRegion());
  $("#loop-region-chops")?.addEventListener("change", () => updateSelectedLoopRegion());
  $("#loop-region-gain")?.addEventListener("input", () => {
    const val = Number(/** @type {HTMLInputElement} */ ($("#loop-region-gain"))?.value ?? 1);
    const out = /** @type {HTMLElement} */ ($("#loop-region-gain-value"));
    if (out) out.textContent = val.toFixed(2);
    updateSelectedLoopRegion();
  });
  $("#loop-region-delete")?.addEventListener("click", () => deleteSelectedLoopRegion());
}

window.rhythmEditorSetSelectedVelocity = setSelectedVelocityFromControl;
window.rhythmEditorSetSelectedOption = setSelectedOptionFromControl;
window.rhythmEditorSetSelectedBusSend = setSelectedBusSendFromControl;
window.rhythmEditorSetSelectedReverbSend = setSelectedReverbSendFromControl;

// ══ Loop Track Data Model ══════════════════════════════════════

/**
 * @typedef {{ bar: number, len: number, gain: number, chops: number }} LoopRegion
 * @typedef {{ id: string, name: string, barsInFile: number, audioUrl: string, regions: LoopRegion[], selected: boolean }} LoopTrack
 */

/** @type {LoopTrack[]} */
const loopTracks = [];
/** @type {{ trackId: string, regionIdx: number } | null} */
let selectedLoopRegion = null;

function loopTrackById(id) {
  return loopTracks.find((t) => t.id === id) ?? null;
}

async function addLoopTrack(name, file, barsInFile) {
  const audioUrl = URL.createObjectURL(file);
  const id = `loop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  /** @type {LoopTrack} */
  const track = { id, name, barsInFile, audioUrl, regions: [], selected: false };
  loopTracks.push(track);
  renderLoopTrackList();
  rebuildStepGridLoopRows();
  status.textContent = `Added loop track "${name}"`;
}

function removeLoopTrack(id) {
  const idx = loopTracks.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const track = loopTracks[idx];
  URL.revokeObjectURL(track.audioUrl);
  loopTracks.splice(idx, 1);
  if (selectedLoopRegion?.trackId === id) {
    selectedLoopRegion = null;
    syncLoopRegionPanel();
  }
  renderLoopTrackList();
  rebuildStepGridLoopRows();
  status.textContent = `Removed loop track "${track.name}"`;
}

function selectLoopRegionInPanel(trackId, regionIdx) {
  selectedLoopRegion = { trackId, regionIdx };
  syncLoopRegionPanel();
}

function syncLoopRegionPanel() {
  const panel = $("#loop-region-panel");
  if (!panel) return;
  if (!selectedLoopRegion) {
    panel.hidden = true;
    return;
  }
  const track = loopTrackById(selectedLoopRegion.trackId);
  const region = track?.regions[selectedLoopRegion.regionIdx];
  if (!region) { panel.hidden = true; return; }
  panel.hidden = false;
  const startEl = /** @type {HTMLInputElement} */ ($("#loop-region-start"));
  const lenEl   = /** @type {HTMLInputElement} */ ($("#loop-region-len"));
  const chopsEl = /** @type {HTMLInputElement} */ ($("#loop-region-chops"));
  const gainEl  = /** @type {HTMLInputElement} */ ($("#loop-region-gain"));
  const gainOut = /** @type {HTMLElement}      */ ($("#loop-region-gain-value"));
  if (startEl) startEl.value = String(region.bar);
  if (lenEl)   lenEl.value   = String(region.len);
  if (chopsEl) chopsEl.value = String(region.chops);
  if (gainEl)  gainEl.value  = String(region.gain);
  if (gainOut) gainOut.textContent = region.gain.toFixed(2);
}

function updateSelectedLoopRegion() {
  if (!selectedLoopRegion) return;
  const track = loopTrackById(selectedLoopRegion.trackId);
  const region = track?.regions[selectedLoopRegion.regionIdx];
  if (!region) return;
  const startEl = /** @type {HTMLInputElement} */ ($("#loop-region-start"));
  const lenEl   = /** @type {HTMLInputElement} */ ($("#loop-region-len"));
  const chopsEl = /** @type {HTMLInputElement} */ ($("#loop-region-chops"));
  const gainEl  = /** @type {HTMLInputElement} */ ($("#loop-region-gain"));
  region.bar   = Math.max(0, Math.round(Number(startEl?.value) || 0));
  region.len   = Math.max(1, Math.round(Number(lenEl?.value)   || 1));
  region.chops = Math.max(1, Math.min(32, Math.round(Number(chopsEl?.value) || 4)));
  region.gain  = Math.max(0, Math.min(2, Number(gainEl?.value) || 1));
  renderLoopLane(selectedLoopRegion.trackId);
}

function deleteSelectedLoopRegion() {
  if (!selectedLoopRegion) return;
  const track = loopTrackById(selectedLoopRegion.trackId);
  if (!track) return;
  track.regions.splice(selectedLoopRegion.regionIdx, 1);
  selectedLoopRegion = null;
  syncLoopRegionPanel();
  renderLoopLane(track.id);
}

// ── Rendering ────────────────────────────────────────────────

function renderLoopTrackList() {
  const list = $("#loop-track-list");
  if (!list) return;
  list.innerHTML = "";
  loopTracks.forEach((track) => {
    const item = document.createElement("div");
    item.className = `loop-track-item${track.selected ? " is-selected" : ""}`;
    item.dataset.loopTrackId = track.id;

    const name = document.createElement("span");
    name.className = "loop-track-item-name";
    name.textContent = `${track.name} (${track.barsInFile} bars)`;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "loop-track-item-remove";
    removeBtn.textContent = "×";
    removeBtn.title = `Remove "${track.name}"`;
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeLoopTrack(track.id);
    });

    item.append(name, removeBtn);
    item.addEventListener("click", () => {
      loopTracks.forEach((t) => { t.selected = false; });
      track.selected = true;
      renderLoopTrackList();
    });
    list.appendChild(item);
  });
}

/** Pixel width of one bar in the step grid (based on 16 steps × cell width) */
function barPixelWidth() {
  const firstBtn = stepGrid.querySelector(".step-button");
  if (!firstBtn) return 32 * 16; // fallback
  return firstBtn.getBoundingClientRect().width * 16;
}

function renderLoopLane(trackId) {
  const lane = stepGrid.querySelector(`.loop-lane[data-loop-track="${trackId}"]`);
  if (!lane) return;
  const track = loopTrackById(trackId);
  if (!track) return;

  lane.innerHTML = "";

  const laneWidth = lane.clientWidth || lane.offsetWidth || 1;
  const totalBars = Math.max(1, bars().length);
  const pxPerBar = laneWidth / totalBars;

  track.regions.forEach((region, regionIdx) => {
    const isSelected = selectedLoopRegion?.trackId === trackId && selectedLoopRegion?.regionIdx === regionIdx;

    const el = document.createElement("div");
    el.className = `loop-region${isSelected ? " is-selected" : ""}`;
    el.style.left  = `${(region.bar / totalBars) * 100}%`;
    el.style.width = `${(region.len / totalBars) * 100}%`;

    const label = document.createElement("span");
    label.className = "loop-region-label";
    label.textContent = `${track.name} ×${region.chops}`;
    el.appendChild(label);

    // Chop lines
    for (let c = 1; c < region.chops; c += 1) {
      const line = document.createElement("div");
      line.className = "loop-chop-line";
      line.style.left = `${(c / region.chops) * 100}%`;
      el.appendChild(line);
    }

    // Resize handle
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "loop-region-resize";
    resizeHandle.title = "Drag to resize";
    el.appendChild(resizeHandle);

    // Click to select
    el.addEventListener("mousedown", (e) => {
      if (e.target === resizeHandle) return; // handled separately
      e.stopPropagation();
      selectLoopRegionInPanel(trackId, regionIdx);
      renderLoopLane(trackId);
    });

    // Drag to move
    el.addEventListener("mousedown", (e) => {
      if (e.target === resizeHandle) return;
      const startX = e.clientX;
      const startBar = region.bar;
      const onMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const barDelta = Math.round(dx / Math.max(1, pxPerBar));
        region.bar = Math.max(0, Math.min(totalBars - region.len, startBar + barDelta));
        renderLoopLane(trackId);
        syncLoopRegionPanel();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // Drag to resize
    resizeHandle.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      const startX = e.clientX;
      const startLen = region.len;
      const onMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const barDelta = Math.round(dx / Math.max(1, pxPerBar));
        region.len = Math.max(1, Math.min(totalBars - region.bar, startLen + barDelta));
        renderLoopLane(trackId);
        syncLoopRegionPanel();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    lane.appendChild(el);
  });
}

function rebuildStepGridLoopRows() {
  // Remove existing loop rows
  stepGrid.querySelectorAll(".loop-lane-row-label, .loop-lane").forEach((el) => el.remove());

  loopTracks.forEach((track) => {
    const label = document.createElement("div");
    label.className = "track-label loop-lane-row-label";
    label.textContent = track.name;
    label.dataset.loopTrackId = track.id;

    const lane = document.createElement("div");
    lane.className = "loop-lane";
    lane.dataset.loopTrack = track.id;
    lane.title = `Click to add a region to "${track.name}"`;

    // Click empty space → create region
    lane.addEventListener("click", (e) => {
      if ((e.target instanceof Element) && e.target.closest(".loop-region")) return;
      const rect = lane.getBoundingClientRect();
      const totalBars = Math.max(1, bars().length);
      const clickBar = Math.floor(((e.clientX - rect.left) / rect.width) * totalBars);
      const newRegion = {
        bar: Math.max(0, Math.min(totalBars - 1, clickBar)),
        len: Math.min(track.barsInFile, totalBars),
        gain: 1,
        chops: 4
      };
      track.regions.push(newRegion);
      const newIdx = track.regions.length - 1;
      selectLoopRegionInPanel(track.id, newIdx);
      renderLoopLane(track.id);
    });

    stepGrid.appendChild(label);
    stepGrid.appendChild(lane);

    renderLoopLane(track.id);
  });
}

buildLoopTabs();
buildBarTabs();
buildStepGrid();
wireEvents();
refreshLoopBarButton();
syncSliders();
syncJson();
void loadSavedRhythmConfig();
