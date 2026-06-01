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
  sequencedBassPitchForStep,
  TRACK_SHAPE_RANGES
} from "./audio/rhythm-config.js";
import {
  TRACK_REGISTRY,
  TRACK_GROUPS,
  TRACK_BY_ID,
  getTrackDef,
  DEFAULT_GRID_TRACK_IDS,
  PATTERN_TRACK_IDS,
  TRACK_LABELS,
  TRACK_DEFAULT_VELOCITY,
  tracksByGroup,
  isInstanceId,
  baseTrackId,
  makeInstanceId
} from "./audio/rhythm-track-registry.js";
import {
  orderGridTrackIds as orderGridTrackIdsBase,
  reconcileGridTrackIds as reconcileGridTrackIdsBase,
  instanceLabelFor,
  removeTrackFromConfigMaps
} from "./audio/grid-tracks.js";
import { RhythmEngine } from "./audio/rhythm-engine.js";
import { createGlobalMixPanel } from "./ui/global-mix-panel.js";
import { createProjectManager } from "./ui/project-manager.js";
import { showContextMenu, closeContextMenu } from "./ui/context-menu.js";
import { createSampleBrowser } from "./ui/sample-browser.js";
import { createLoopTrackPanel } from "./ui/loop-track-panel.js";
import { createTrackPanels } from "./ui/track-panels.js";
import { createArrangementClipboard } from "./ui/arrangement-clipboard.js";
import { createTransport } from "./ui/transport.js";
import { createNoteInspector } from "./ui/note-inspector.js";
import { createConfigFile } from "./ui/config-file.js";
import { createStepGridBuilder } from "./ui/step-grid-builder.js";
import { createRowSelection } from "./ui/row-selection.js";
import { createEventWiring } from "./ui/event-wiring.js";
import { createHitData } from "./audio/hit-data.js";
import { createConfigSync } from "./ui/config-sync.js";
import {
  getPathValue as getConfigPath,
  setPathValue as setConfigPath
} from "./lib/object-path.js";
import {
  downloadJsonFile,
  saveGameAsset,
  fetchSavedConfig
} from "./lib/config-io.js";
import {
  normalizeHitEntry,
  readStoredHit,
  commitHitEntry
} from "./audio/pattern-hits.js";
import { getTrackMix, setTrackMix } from "./audio/track-mix.js";
import {
  TRACK_SHAPE_FIELDS,
  globalShapeValue as globalShapeValueBase,
  resolvedShapeValue as resolvedShapeValueBase,
  formatShapeValue,
  setTrackShapeField as setTrackShapeFieldBase,
  clearTrackShape
} from "./audio/track-shape.js";
import { setPairedControl, wireNumberControl, registerInteractiveInput } from "./ui/paired-control.js";
import {
  loopCountFor,
  localBarIndex as localBarIndexMath,
  loopIndexForBar as loopIndexForBarMath,
  loopStartBar as loopStartBarMath,
  clampLoopStart as clampLoopStartMath,
  barLabel as barLabelMath
} from "./audio/loop-math.js";
import {
  NOTE_NAMES,
  BLACK_NOTE_PITCH_CLASSES,
  A1_MIDI_NOTE,
  formatPitch,
  noteNameForPitch,
  formatPan,
  scaleSemitoneForIndex as scaleSemitoneForIndexBase,
  displayedPitch as displayedPitchValueFor,
  storedPitch as storedPitchValueFor
} from "./ui/music-format.js";

// The grid is now driven by `state.gridTrackIds` (a list of registry ids).
// These helpers turn that id list into the row descriptors the renderer wants.
const trackRowDescriptor = (id) => {
  const def = getTrackDef(id);
  return {
    id,
    label: isInstanceId(id) ? instanceLabel(id) : (def?.label || id),
    type: def?.kind === "pattern" ? "pattern" : "generated"
  };
};
const gridRows = () => state.gridTrackIds.map(trackRowDescriptor);
const PATTERN_ROW_IDS = new Set(PATTERN_TRACK_IDS);
const ROW_LABELS = TRACK_LABELS;
const DEFAULT_VELOCITY = TRACK_DEFAULT_VELOCITY;

const LOOP_BAR_COUNT = PHRASE_BARS;
const MAX_LOOP_COUNT = Math.floor(MAX_SEQUENCE_BARS / LOOP_BAR_COUNT);
const PITCH_SLIDER_MIN = -24;
const PITCH_SLIDER_MAX = 48;
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
  // Multi-track inspector selection (ordered list of track ids). The first id
  // mirrors `state.selected.hit` for the legacy single-track helpers.
  selectedTracks: [],
  trackAnchor: null,
  // Shift-click selections for loops & bars (ordered, with anchors for ranges).
  selectedLoops: [],
  loopAnchor: null,
  selectedBars: [],
  barAnchor: null,
  soloTracks: new Set(),
  playing: false,
  intensity: 0.45,
  loopBar: false,
  loopBarIndex: 0,
  loopBarLength: 0,
  twoBarClipboard: null,
  trackClipboard: null,
  // Rich clipboards for the new shift-select copy/paste flows.
  loopClipboard: null,
  barClipboard: null,
  playheadStep: 0,
  uiTimer: null,
  zoomLevel: 8,
  segmentsCount: 2,
  timeSig: "4/4",
  // Registry-driven list of track ids shown in the grid (order = render order).
  gridTrackIds: [...DEFAULT_GRID_TRACK_IDS]
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
// Right-side panels
const trackExplorerList = $("#track-explorer-list");
const trackInspectorName = $("#track-inspector-name");
const trackInspectorPanels = $("#track-inspector-panels");
const trackInspectorTemplate = $("#track-inspector-template");
const trackInspectorMultiHint = $("#track-inspector-multi-hint");
const sampleRootSelect = null; // replaced by File System Access API
const sampleOpenBtn = $("#sample-open-folder");
const sampleFileInput = /** @type {HTMLInputElement} */ ($("#sample-open-folder"));
const sampleBreadcrumb = $("#sample-breadcrumb");
const sampleBrowserList = $("#sample-browser-list");
const runningFromFile = window.location.protocol === "file:";
// Note-step inspector controls (per-note, not per-track).
const selectedControls = [
  selectedVelocity,
  selectedPitch,
  selectedOffset,
  selectedAttack,
  selectedDelay,
  selectedWobble,
  selectedNoteDelaySend,
  selectedNoteReverbSend,
  selectedVelocityNumber,
  selectedPitchNumber,
  selectedOffsetNumber,
  selectedAttackNumber,
  selectedDelayNumber,
  selectedWobbleNumber,
  selectedDubEcho,
  selectedDubEchoNumber,
  selectedNoteDelaySendNumber,
  selectedNoteReverbSendNumber
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

function normalizeEditorConfig(config = {}) {
  return normalizeSequencedRhythmConfig(config, { pressure: 0.45 });
}

function bars() {
  return state.config.patterns.jazz.bars;
}

function loopCount() {
  return loopCountFor(bars().length, LOOP_BAR_COUNT);
}

function localBarIndex(barIndex = state.activeBar) {
  return localBarIndexMath(barIndex, LOOP_BAR_COUNT);
}

function loopIndexForBar(barIndex = state.activeBar) {
  return loopIndexForBarMath(barIndex, LOOP_BAR_COUNT, MAX_LOOP_COUNT);
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
  return loopStartBarMath(loopIndex, bars().length, LOOP_BAR_COUNT);
}

function activeLoopLength() {
  if (!state.loopBar) return 0;
  return Math.max(1, Math.round(state.loopBarLength || 1));
}

function clampLoopStart(start = state.activeBar, length = activeLoopLength() || 1) {
  return clampLoopStartMath(start, length, bars().length);
}

function barLabel(barIndex) {
  return barLabelMath(barIndex, LOOP_BAR_COUNT, MAX_LOOP_COUNT);
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

function trackName(hit) {
  return ROW_LABELS[hit] || hit || "track";
}

// ══ Arrangement clipboard controller ═══════════════════════════════════════
// Two-bar/track copy-paste-fill, loop/bar shift-multiselect + clipboards,
// right-click context menus, and loop-count editing live in their own
// controller. The editor keeps hoisted wrappers so existing call sites and the
// tab-builders (which reference these by name) are unchanged.
const arrangement = createArrangementClipboard({
  $,
  state,
  clone,
  setStatus: (msg) => { status.textContent = msg; },
  LOOP_BAR_COUNT,
  MAX_LOOP_COUNT,
  bars,
  clampLoopStart,
  activeLoopLength,
  loopRangeLabel,
  loopBarSlice,
  loopStartBar,
  localBarIndex,
  clampActiveBar,
  loopCount,
  applyConfig,
  buildLoopTabs,
  buildBarTabs,
  renderStepGrid,
  refreshLoopBarButton,
  selectStep,
  showContextMenu,
  resetSelectedPanel,
  trackName
});

function updateTwoBarClipboardButtons() { return arrangement.updateTwoBarClipboardButtons(); }
function updateTrackClipboardButtons() { return arrangement.updateTrackClipboardButtons(); }
function copyTwoBars() { return arrangement.copyTwoBars(); }
function pasteTwoBars() { return arrangement.pasteTwoBars(); }
function fillRestWithTwoBars() { return arrangement.fillRestWithTwoBars(); }
function copyTrackTwoBars() { return arrangement.copyTrackTwoBars(); }
function pasteTrackTwoBars() { return arrangement.pasteTrackTwoBars(); }
function fillRestWithTrackTwoBars() { return arrangement.fillRestWithTrackTwoBars(); }
function toggleLoopMultiSelect(index, event) { return arrangement.toggleLoopMultiSelect(index, event); }
function toggleBarMultiSelect(index, event) { return arrangement.toggleBarMultiSelect(index, event); }
function openLoopContextMenu(event, index) { return arrangement.openLoopContextMenu(event, index); }
function openBarContextMenu(event, index) { return arrangement.openBarContextMenu(event, index); }
function openTrackContextMenu(event, hit) { return arrangement.openTrackContextMenu(event, hit); }
function setLoopCount(nextCount, opts) { return arrangement.setLoopCount(nextCount, opts); }
function duplicateCurrentLoop() { return arrangement.duplicateCurrentLoop(); }
function deleteCurrentLoop() { return arrangement.deleteCurrentLoop(); }

// ══ Hit-data access layer ═══════════════════════════════════════════════════
// All pattern bar read/write (getHitData, setHitData, setHitVelocity,
// getHitVelocity, getGeneratedHitData) live in their own module.
const hitData = createHitData({
  state,
  PATTERN_ROW_IDS,
  ROW_LABELS,
  clamp,
  normalizeStepOptions,
  readStoredHit,
  commitHitEntry,
  generatedSynthEventsForStep,
  applyConfig
});

function patternBar(index) { return hitData.patternBar(index); }
function getHitData(hit, step, barIndex) { return hitData.getHitData(hit, step, barIndex); }
function setHitData(hit, step, patch, barIndex) { return hitData.setHitData(hit, step, patch, barIndex); }
function setHitVelocity(hit, step, velocity, barIndex) { return hitData.setHitVelocity(hit, step, velocity, barIndex); }
function getHitVelocity(hit, step, barIndex) { return hitData.getHitVelocity(hit, step, barIndex); }
function getGeneratedHitData(hit, step, barIndex, pressure) { return hitData.getGeneratedHitData(hit, step, barIndex, pressure); }
function generatedEventsAtStep(step, barIndex, pressure) { return hitData.generatedEventsAtStep(step, barIndex, pressure); }

// ══ Per-note (step) inspector controller ═══════════════════════════════════
// The on-screen piano, pitch preview/choose, velocity/pitch/effect-option
// controls, and the dub-echo control live in their own controller. The editor
// keeps hoisted wrappers so existing call sites (event wiring, render loop,
// transport playhead) are unchanged.
const noteInspector = createNoteInspector({
  state,
  setStatus: (msg) => { status.textContent = msg; },
  runningFromFile,
  stepGrid,
  selectedPiano,
  selectedPitch,
  selectedPitchNumber,
  selectedPitchValue,
  selectedVelocity,
  selectedVelocityNumber,
  selectedVelocityValue,
  selectedDubEcho,
  selectedDubEchoNumber,
  selectedDubEchoValue,
  selectedOptionControls,
  PITCH_SLIDER_MIN,
  PITCH_SLIDER_MAX,
  SYNTH_ROOT_HZ,
  SYNTH_SCALE,
  A1_MIDI_NOTE,
  BLACK_NOTE_PITCH_CLASSES,
  STEP_OPTION_DEFAULTS,
  clamp,
  normalizeStepOptions,
  normalizeHitEntry,
  sequencedBassPitchForStep,
  scaleSemitoneForIndex: scaleSemitoneForIndexBase,
  formatPitch,
  noteNameForPitch,
  displayedPitchValueFor,
  storedPitchValueFor,
  setPairedControl,
  getHitData,
  setHitData,
  setHitVelocity,
  selectStep,
  renderStepGrid,
  activeLoopLength,
  clampLoopStart,
  trackName
});

function bassBasePitch(step, barIndex = state.activeBar) { return noteInspector.bassBasePitch(step, barIndex); }
function displayedPitchForHit(hit, step, options, barIndex = state.activeBar) { return noteInspector.displayedPitchForHit(hit, step, options, barIndex); }
function storedPitchForDisplay(hit, step, displayedPitch, barIndex = state.activeBar) { return noteInspector.storedPitchForDisplay(hit, step, displayedPitch, barIndex); }
function renderSelectedPiano(displayedPitch = null, basePitch = null) { return noteInspector.renderSelectedPiano(displayedPitch, basePitch); }
function selectedPreviewOptions() { return noteInspector.selectedPreviewOptions(); }
function previewPianoPitch(displayedPitch, effectOptions) { return noteInspector.previewPianoPitch(displayedPitch, effectOptions); }
function choosePianoPitch(displayedPitch) { return noteInspector.choosePianoPitch(displayedPitch); }
function syncSelectedPitchDisplay(barIndex = state.activeBar) { return noteInspector.syncSelectedPitchDisplay(barIndex); }
function ensureSelectedFromDom() { return noteInspector.ensureSelectedFromDom(); }
function updateSelectedOption(field, value) { return noteInspector.updateSelectedOption(field, value); }
function soundingStepForRow(hit, playheadStep, barIndex = state.activeBar) { return noteInspector.soundingStepForRow(hit, playheadStep, barIndex); }
function setSelectedVelocityFromControl(value) { return noteInspector.setSelectedVelocityFromControl(value); }
function setSelectedOptionFromControl(field, value) { return noteInspector.setSelectedOptionFromControl(field, value); }
function syncSelectedDubEchoDisplay(options = null) { return noteInspector.syncSelectedDubEchoDisplay(options); }
function setSelectedDubEchoFromControl(value) { return noteInspector.setSelectedDubEchoFromControl(value); }

function selectedTrackBusSend(hit = state.selected?.hit) {
  return getTrackMix(state.config, "busSend", hit);
}

function selectedTrackReverbSend(hit = state.selected?.hit) {
  return getTrackMix(state.config, "reverbSend", hit);
}

function selectedTrackLevelFor(hit = state.selected?.hit) {
  return getTrackMix(state.config, "level", hit);
}

function selectedTrackPanFor(hit = state.selected?.hit) {
  return getTrackMix(state.config, "pan", hit);
}

function syncSelectedBusSendDisplay() {
  // Track-level Level/Pan/Delay/Verb live in the per-track inspector panels,
  // which are (re)built on selection changes and self-update on drag, so there
  // is nothing to mirror here anymore. Kept as a hook for callers.
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
  if (loopButton) {
    loopButton.classList.toggle("is-active", loopLength > 0);
    if (loopLength > 0) {
      const start = state.loopBarIndex + 1;
      const end = state.loopBarIndex + loopLength;
      loopButton.textContent = loopLength === 1
        ? `Loop Bar ${start}`
        : `Loop Bars ${start}–${end}`;
    } else {
      loopButton.textContent = "Loop Selected";
    }
  }
  $("#play-song")?.classList.toggle("is-active", loopLength === 0);
}

// Per-track mix setters keyed by track id (used by the multi-panel inspector).
// Each writes to its config map, applies live, and refreshes the inspector
// panels so all selected tracks stay in sync.
function setTrackBusSend(hit, value) {
  if (setTrackMix(state.config, "busSend", hit, value) === null) return;
  applyConfig();
}

function setTrackReverbSend(hit, value) {
  if (setTrackMix(state.config, "reverbSend", hit, value) === null) return;
  applyConfig();
}

function setTrackLevel(hit, value) {
  if (setTrackMix(state.config, "level", hit, value) === null) return;
  applyConfig();
}

function setTrackPan(hit, value) {
  if (setTrackMix(state.config, "pan", hit, value) === null) return;
  applyConfig();
}

// ══ Step-grid and tab-strip builder controller ══════════════════════════════
// buildStepGrid, buildLoopTabs, buildBarTabs, and renderStepGrid live in
// their own controller. The editor keeps thin hoisted wrappers so all
// existing call sites are unchanged.
const gridBuilder = createStepGridBuilder({
  state,
  stepGrid,
  barTabs,
  loopTabs,
  loopCountInput,
  status,
  LOOP_BAR_COUNT,
  MAX_LOOP_COUNT,
  DEFAULT_VELOCITY,
  gridRows,
  loopCount,
  localBarIndex,
  loopStartBar,
  activeLoopLength,
  clampLoopStart,
  syncActiveLoopToBar,
  clampActiveBar,
  previewConfig,
  refreshLoopBarButton,
  clearPlayhead,
  renderSoloButtons,
  toggleSolo,
  selectRowWithModifiers,
  selectRowToggle,
  selectStep,
  getHitData,
  setHitVelocity,
  displayedPitchForHit,
  formatPitch,
  noteNameForPitch,
  toggleLoopMultiSelect,
  toggleBarMultiSelect,
  openLoopContextMenu,
  openBarContextMenu,
  openTrackContextMenu,
  resetSelectedPanel,
  onAfterBuild: () => loopPanel.rebuildStepGridRows()
});

function buildStepGrid() { return gridBuilder.buildStepGrid(); }
function buildLoopTabs() { return gridBuilder.buildLoopTabs(); }
function buildBarTabs() { return gridBuilder.buildBarTabs(); }
function renderStepGrid() { return gridBuilder.renderStepGrid(); }

// ══ Row / step selection + solo controller ══════════════════════════════════
// selectStep, selectRow, selectRowWithModifiers, resetSelectedPanel,
// clearSelection, toggleSolo, clearSolo, renderSoloButtons live in their
// own controller. Hoisted wrappers below preserve all existing call sites.
const rowSelection = createRowSelection({
  state,
  $,
  status,
  selectedLabel,
  selectedControls,
  selectedVelocity, selectedVelocityNumber, selectedVelocityValue,
  selectedPitch, selectedPitchNumber, selectedPitchValue,
  selectedOffset, selectedOffsetNumber, selectedOffsetValue,
  selectedAttack, selectedAttackNumber, selectedAttackValue,
  selectedDelay, selectedDelayNumber, selectedDelayValue,
  selectedWobble, selectedWobbleNumber, selectedWobbleValue,
  selectedDubEcho, selectedDubEchoNumber, selectedDubEchoValue,
  selectedNoteDelaySend, selectedNoteDelaySendNumber, selectedNoteDelaySendValue,
  selectedNoteReverbSend, selectedNoteReverbSendNumber, selectedNoteReverbSendValue,
  PITCH_SLIDER_MIN, PITCH_SLIDER_MAX, STEP_OPTION_DEFAULTS,
  PATTERN_ROW_IDS,
  setPairedControl, formatPitch,
  getHitData, setHitVelocity,
  syncSelectedPitchDisplay, syncSelectedDubEchoDisplay, renderSelectedPiano,
  soundingStepForRow,
  updateTrackClipboardButtons,
  renderTrackInspector, renderTrackExplorer,
  renderStepGrid,
  previewConfig
});

function selectStep(hit, step, mode, barIndex, pressure, generated) { return rowSelection.selectStep(hit, step, mode, barIndex, pressure, generated); }
function selectRow(hit, opts) { return rowSelection.selectRow(hit, opts); }
function selectRowToggle(hit) { return rowSelection.selectRowToggle(hit); }
function selectRowWithModifiers(hit, event) { return rowSelection.selectRowWithModifiers(hit, event); }
function orderBySelectedGrid(ids) { return rowSelection.orderBySelectedGrid(ids); }
function resetSelectedPanel() { return rowSelection.resetSelectedPanel(); }
function clearSelection() { return rowSelection.clearSelection(); }
function toggleSolo(track) { return rowSelection.toggleSolo(track); }
function clearSolo() { return rowSelection.clearSolo(); }
function renderSoloButtons() { return rowSelection.renderSoloButtons(); }

// ══ Config sync controller ══════════════════════════════════════════════════
// getPathValue, setPathValue, syncSliders, applyZoom, syncJson, applyConfig
// live in their own controller. Hoisted wrappers below preserve all call sites.
const configSync = createConfigSync({
  $,
  state,
  stepGrid,
  jsonOutput,
  getConfigPath,
  setConfigPath,
  normalizeEditorConfig,
  previewConfig,
  syncSelectedPitchDisplay,
  syncSelectedBusSendDisplay
});

function getPathValue(path) { return configSync.getPathValue(path); }
function setPathValue(path, value) { return configSync.setPathValue(path, value); }
function syncSliders() { return configSync.syncSliders(); }
function applyZoom(level) { return configSync.applyZoom(level); }

function applySegments(count) {
  const n = Math.max(1, Math.min(16, Math.round(count) || 2));
  state.segmentsCount = n;
  const input = /** @type {HTMLInputElement|null} */ ($("#segments-count"));
  if (input) input.value = String(n);
  buildStepGrid();
}

function applyTimeSig(value) {
  state.timeSig = value || "4/4";
  const [num] = (value || "4/4").split("/").map(Number);
  stepGrid.dataset.timeSig = value;
  // Mark beat accents based on numerator
  stepGrid.querySelectorAll(".step-button").forEach((btn) => {
    const step = Number(btn.dataset.step);
    btn.dataset.beat = step % num === 0 ? "1" : "0";
  });
  const sel = /** @type {HTMLSelectElement|null} */ ($("#time-sig-select"));
  if (sel) sel.value = state.timeSig;
}
function syncJson() { return configSync.syncJson(); }
function applyConfig() { return configSync.applyConfig(); }

// ══ Transport / playback controller ════════════════════════════════════════
// Play/stop, loop-playback modes (bar / two-bar / full song), restart, the
// sound-preview triggers, and the playhead UI loop live in their own
// controller. The editor keeps hoisted wrappers so existing call sites and the
// UI-timer callback (which reference these by name) are unchanged.
const transport = createTransport({
  $,
  state,
  setStatus: (msg) => { status.textContent = msg; },
  runningFromFile,
  stepGrid,
  barTabs,
  RhythmEngine,
  barLabel,
  loopRangeLabel,
  activeLoopLength,
  clampLoopStart,
  previewConfig,
  refreshLoopBarButton,
  reapplyTrackSamples,
  syncActiveLoopToBar,
  buildLoopTabs,
  buildBarTabs,
  renderStepGrid,
  selectStep,
  soundingStepForRow,
  getHitData,
  syncSelectedPitchDisplay,
  onEngineRestart: () => loopPanel.attachScheduler()
});

function startPlayback() { return transport.startPlayback(); }
function stopPlayback() { return transport.stopPlayback(); }
function setLoopPlayback(length) { return transport.setLoopPlayback(length); }
function toggleBarLoop() { return transport.toggleBarLoop(); }
function toggleTwoBarLoop() { return transport.toggleTwoBarLoop(); }
function playFullSong() { return transport.playFullSong(); }
function restartPlayback() { return transport.restartPlayback(); }
function previewDuckSound() { return transport.previewDuckSound(); }
function previewHitSound() { return transport.previewHitSound(); }
function previewGameSound(kind) { return transport.previewGameSound(kind); }
function clearPlayhead() { return transport.clearPlayhead(); }
function updatePlayhead() { return transport.updatePlayhead(); }

// ══ Config file load/save controller ═══════════════════════════════════════
// "Save File", "Load File", and the saved-game auto-load live in their own
// controller. The editor keeps hoisted wrappers so existing call sites
// (Save/Load buttons, bootstrap) are unchanged.
const configFile = createConfigFile({
  state,
  setStatus: (msg) => { status.textContent = msg; },
  runningFromFile,
  SAVED_RHYTHM_URL,
  normalizeEditorConfig,
  syncJson,
  applyConfig,
  downloadJsonFile,
  saveGameAsset,
  fetchSavedConfig,
  reconcileGridTracks,
  resetSelectedPanel,
  buildLoopTabs,
  buildBarTabs,
  buildStepGrid,
  renderTrackExplorer,
  renderTrackInspector,
  reapplyTrackSamples,
  updateTwoBarClipboardButtons,
  updateTrackClipboardButtons
});

function downloadConfig() { return configFile.downloadConfig(); }
function applyLoadedConfig(nextConfig) { return configFile.applyLoadedConfig(nextConfig); }
function loadConfigFile(file) { return configFile.loadConfigFile(file); }
function loadSavedRhythmConfig() { return configFile.loadSavedRhythmConfig(); }

function wireEvents() {
  const wiring = createEventWiring({
    $,
    state,
    clamp,
    status,
    loopCountInput,
    setPathValue,
    applyZoom,
    wireNumberControl,
    startPlayback, stopPlayback, restartPlayback,
    playFullSong, toggleBarLoop, toggleTwoBarLoop,
    duplicateCurrentLoop, deleteCurrentLoop,
    copyTwoBars, pasteTwoBars, fillRestWithTwoBars,
    copyTrackTwoBars, pasteTrackTwoBars, fillRestWithTrackTwoBars,
    setLoopCount,
    applySegments, applyTimeSig,
    previewDuckSound, previewHitSound, previewGameSound,
    toggleSolo, clearSolo,
    setSelectedVelocityFromControl, setSelectedOptionFromControl,
    setSelectedDubEchoFromControl,
    clearSelection,
    downloadConfig, loadConfigFile,
    applyConfig, buildLoopTabs, buildBarTabs, buildStepGrid,
    renderTrackExplorer, renderTrackInspector,
    updateTwoBarClipboardButtons, updateTrackClipboardButtons,
    resetSelectedPanel,
    normalizeEditorConfig, clone, DEFAULT_RHYTHM_CONFIG,
    renderAddTrackDialog,
    openGlobalMixView, closeGlobalMixView, resetMasterEq,
    projectManager,
    sampleBrowser,
    closeContextMenu,
    loopPanel,
    selectedVelocity, selectedVelocityNumber,
    selectedPitch, selectedPitchNumber,
    selectedOffset, selectedOffsetNumber,
    selectedAttack, selectedAttackNumber,
    selectedDelay, selectedDelayNumber,
    selectedWobble, selectedWobbleNumber,
    selectedDubEcho, selectedDubEchoNumber,
    selectedNoteDelaySend, selectedNoteDelaySendNumber,
    selectedNoteReverbSend, selectedNoteReverbSendNumber
  });
  wiring.wireAll();
}

window.rhythmEditorSetSelectedVelocity = setSelectedVelocityFromControl;
window.rhythmEditorSetSelectedOption = setSelectedOptionFromControl;
window.rhythmEditorSetTrackBusSend = setTrackBusSend;
window.rhythmEditorSetTrackReverbSend = setTrackReverbSend;
window.rhythmEditorSetTrackLevel = setTrackLevel;
window.rhythmEditorSetTrackPan = setTrackPan;

// ══ Loop Track Lane Panel ══════════════════════════════════════
// The loop-track lane feature (audio loops dropped onto horizontal lanes in
// the step grid, chopped into resizable regions) lives in its own controller.
const loopPanel = createLoopTrackPanel({
  stepGrid,
  $,
  getBarsLength: () => LOOP_BAR_COUNT,
  setStatus: (msg) => { status.textContent = msg; },
  getEngine: () => state.engine
});

// ══ Track panels controller (grid mgmt + Add-Track + Explorer + Inspector) ══
// The right-side track UI cluster lives in its own controller; the editor keeps
// thin, hoisted wrappers so the rest of the file calls these by their old names.
const trackPanels = createTrackPanels({
  $,
  state,
  trackExplorerList,
  trackInspectorPanels,
  trackInspectorTemplate,
  trackInspectorName,
  trackInspectorMultiHint,
  runningFromFile,
  clamp,
  formatPan,
  TRACK_REGISTRY,
  TRACK_GROUPS,
  TRACK_BY_ID,
  TRACK_LABELS,
  DEFAULT_GRID_TRACK_IDS,
  getTrackDef,
  isInstanceId,
  baseTrackId,
  makeInstanceId,
  tracksByGroup,
  orderGridTrackIdsBase,
  reconcileGridTrackIdsBase,
  instanceLabelFor,
  removeTrackFromConfigMaps,
  TRACK_SHAPE_FIELDS,
  globalShapeValueBase,
  resolvedShapeValueBase,
  formatShapeValue,
  setTrackShapeFieldBase,
  clearTrackShape,
  wireNumberControl,
  mix: {
    getLevel: selectedTrackLevelFor,
    setLevel: setTrackLevel,
    getPan: selectedTrackPanFor,
    setPan: setTrackPan,
    getBusSend: selectedTrackBusSend,
    setBusSend: setTrackBusSend,
    getReverbSend: selectedTrackReverbSend,
    setReverbSend: setTrackReverbSend
  },
  applyConfig,
  buildStepGrid,
  renderStepGrid,
  syncJson,
  setStatus: (msg) => { status.textContent = msg; },
  resetSelectedPanel,
  selectRow,
  selectRowWithModifiers,
  orderBySelectedGrid,
  toggleSolo,
  previewConfig,
  getEngine: () => state.engine
});

// Hoisted wrappers around the controller API (preserve the original names that
// the rest of the editor and the global-mix panel call).
function reconcileGridTracks() { return trackPanels.reconcileGridTracks(); }
function addGridTrack(trackId) { return trackPanels.addGridTrack(trackId); }
function addTrackInstance(baseId, opts) { return trackPanels.addTrackInstance(baseId, opts); }
function removeGridTrack(trackId) { return trackPanels.removeGridTrack(trackId); }
function instanceLabel(id) { return trackPanels.instanceLabel(id); }
function renderAddTrackDialog() { return trackPanels.renderAddTrackDialog(); }
function renderTrackExplorer() { return trackPanels.renderTrackExplorer(); }
function renderTrackInspector() { return trackPanels.renderTrackInspector(); }
function trackSupportsShape(hit) { return trackPanels.trackSupportsShape(hit); }
function renderTrackShapeControls(hit, container) { return trackPanels.renderTrackShapeControls(hit, container); }
function assignSampleToTrack(hit, sample) { return trackPanels.assignSampleToTrack(hit, sample); }
function clearTrackSample(hit) { return trackPanels.clearTrackSample(hit); }
function reapplyTrackSamples() { return trackPanels.reapplyTrackSamples(); }

// ══ Global Mix view (dedicated full-screen track-level mixer) ════════════════
// The overlay (live spectrum + mastering EQ + per-track mixer strips) lives in
// its own controller; the editor supplies state-aware accessors/callbacks.
const globalMixPanel = createGlobalMixPanel({
  $,
  getEngine: () => state.engine,
  getConfig: () => state.config,
  applyConfig,
  setStatus: (msg) => { status.textContent = msg; },
  clamp,
  formatPan,
  trackGroups: TRACK_GROUPS,
  getTrackDef,
  isInstanceId,
  instanceLabel,
  getGridTrackIds: () => state.gridTrackIds,
  mix: {
    getLevel: selectedTrackLevelFor,
    setLevel: setTrackLevel,
    getPan: selectedTrackPanFor,
    setPan: setTrackPan,
    getBusSend: selectedTrackBusSend,
    setBusSend: setTrackBusSend,
    getReverbSend: selectedTrackReverbSend,
    setReverbSend: setTrackReverbSend
  },
  trackSupportsShape,
  renderTrackShapeControls,
  onInspect: (hit) => {
    selectRow(hit);
    renderStepGrid();
  }
});
const openGlobalMixView = () => globalMixPanel.open();
const closeGlobalMixView = () => globalMixPanel.close();
const resetMasterEq = () => globalMixPanel.reset();

// ── Project Manager (save/load slots + WAV export) ─────────────────────────
const projectManager = createProjectManager({
  getConfig: () => clone(state.config),
  applyLoadedConfig,
  getEngine: () => state.engine,
  startPlayback,
  stopPlayback,
  setStatus: (msg) => { status.textContent = msg; }
});

// ── Sample Browser ──────────────────────────────────────────
// The browse/audition/load flow lives in a self-contained controller; the
// editor only wires it to its DOM elements and supplies the few hooks it needs
// (status line, current selection, and the "load into track" action).
const sampleBrowser = createSampleBrowser({
  openBtn: sampleOpenBtn,
  fileInput: sampleFileInput,
  breadcrumb: sampleBreadcrumb,
  list: sampleBrowserList,
  setStatus: (text) => { status.textContent = text; },
  getSelectedHit: () => state.selected?.hit ?? null,
  assignSample: (hit, sample) => assignSampleToTrack(hit, sample)
});

buildLoopTabs();
buildBarTabs();
buildStepGrid();
wireEvents();
applyZoom(8);
applySegments(2);
refreshLoopBarButton();

// ── Attach loop-track scheduler whenever the engine starts/restarts ─────────
// The engine emits "play" once it's running and has a live AudioContext;
// we (re)subscribe loop-track bar events at that point so the buffer source
// nodes are scheduled against the same clock.
state.engine.on("play", () => loopPanel.attachScheduler());
state.engine.on("stop", () => loopPanel.detachScheduler());

// ── Bottom-panel resize handle ──────────────────────────────────────────────
{
  const handle = $("#selected-step-resize-handle");
  const panel = $("#selected-step-panel");
  if (handle && panel) {
    let startY = 0;
    let startHeight = 0;
    const clampPanelHeight = (h) => {
      // Never exceed ~60% of the viewport height so the panel can't swallow the grid
      const maxH = Math.floor(window.innerHeight * 0.6);
      return Math.max(60, Math.min(maxH, h));
    };

    handle.addEventListener("mousedown", (e) => {
      startY = e.clientY;
      startHeight = panel.getBoundingClientRect().height;
      handle.classList.add("is-dragging");
      const onMove = (me) => {
        const delta = startY - me.clientY;
        panel.style.height = `${clampPanelHeight(startHeight + delta)}px`;
      };
      const onUp = () => {
        handle.classList.remove("is-dragging");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // Re-clamp on window resize so a previously set height can't overflow
    window.addEventListener("resize", () => {
      if (panel.style.height) {
        panel.style.height = `${clampPanelHeight(parseInt(panel.style.height, 10))}px`;
      }
    });
  }
}
// Register every inspector slider/number input so setPairedControl never
// clobbers a value while the user is actively dragging or typing.
selectedControls.forEach(registerInteractiveInput);

syncSliders();
syncJson();
renderTrackExplorer();
renderTrackInspector();
void sampleBrowser.loadRoots();
void loadSavedRhythmConfig();
