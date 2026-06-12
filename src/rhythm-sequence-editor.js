import {
  DEFAULT_RHYTHM_CONFIG,
  generatedSynthEventsForStep,
  MAX_SEQUENCE_BARS,
  effectiveStepOptionsForTrack,
  normalizeSequencedRhythmConfig,
  normalizeDefaultNote,
  normalizeSectionBars,
  normalizeStepOptions,
  normalizeTrackOptionDefaults,
  normalizeTimeSignature,
  normalizeVerseBars,
  PHRASE_BARS,
  PITCH_OFFSET_MAX,
  PITCH_OFFSET_MIN,
  STEP_OPTION_DEFAULTS,
  SYNTH_ROOT_HZ,
  SYNTH_SCALE,
  sequencedBassPitchForStep,
  TRACK_SHAPE_RANGES
} from "./audio/rhythm-config.js";
import {
  TRACK_REGISTRY,
  TRACK_GROUPS,
  GROUP_BY_ID,
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
  removeTrackFromConfigMaps,
  replaceTrackIdInConfig
} from "./audio/grid-tracks.js";
import { RhythmEngine } from "./audio/rhythm-engine.js";
import { createGlobalMixPanel } from "./ui/global-mix-panel.js";
import { createProjectManager } from "./ui/project-manager.js";
import { showContextMenu, closeContextMenu } from "./ui/context-menu.js";
import { createSampleBrowser } from "./ui/sample-browser.js";
import { createLoopTrackPanel } from "./ui/wave-edit/loop-track-panel.js";
import { createTrackPanels } from "./ui/track-panels.js";
import { createArrangementClipboard } from "./ui/arrangement-clipboard.js";
import { createTransport } from "./ui/transport.js";
import { createNoteInspector } from "./ui/note-inspector.js";
import { createFakeMidiKeyboard } from "./ui/piano-roll/fake-midi-keyboard.js";
import { createMidiMapPanel } from "./ui/midi/midi-map-panel.js";
import { createConfigFile } from "./ui/config-file.js";
import { createStepGridBuilder } from "./ui/grid/step-grid-builder.js";
import { createRowSelection } from "./ui/row-selection.js";
import { createEventWiring } from "./ui/event-wiring.js";
import { installRotaryControls } from "./ui/rotary-control.js";
import { createHitData } from "./audio/hit-data.js";
import { createConfigSync } from "./ui/config-sync.js";
import {
  getPathValue as getConfigPath,
  setPathValue as setConfigPath
} from "./lib/object-path.js";
import {
  downloadJsonFile,
  saveDefaultProject,
  loadDefaultProject,
  getLocalServerMode,
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
  const group = def?.group ? GROUP_BY_ID[def.group] : null;
  return {
    id,
    label: isInstanceId(id) ? instanceLabel(id) : (def?.label || id),
    type: def?.kind === "pattern" ? "pattern" : "generated",
    group: def?.group || null,
    accent: group?.accent || "#7dd3fc"
  };
};
const hiddenGridTrackSet = () => new Set(Array.isArray(state.config?.hiddenGridTrackIds) ? state.config.hiddenGridTrackIds : []);
const gridRows = () => {
  const hidden = hiddenGridTrackSet();
  return state.gridTrackIds.filter((id) => !hidden.has(id)).map(trackRowDescriptor);
};
const pianoRollRows = () => {
  const open = new Set(Array.isArray(state.config?.pianoRollTracks) ? state.config.pianoRollTracks : []);
  return state.gridTrackIds.filter((id) => open.has(id)).map(trackRowDescriptor);
};
const PATTERN_ROW_IDS = new Set(PATTERN_TRACK_IDS);
const ROW_LABELS = TRACK_LABELS;
const DEFAULT_VELOCITY = TRACK_DEFAULT_VELOCITY;

const DEFAULT_LOOP_BAR_COUNT = PHRASE_BARS;
const PITCH_SLIDER_MIN = PITCH_OFFSET_MIN;
const PITCH_SLIDER_MAX = PITCH_OFFSET_MAX;
const SAVED_RHYTHM_URL = "./assets/projects/default-project.rhythm-project.json";
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
  trackEditorMode: "grid",
  pianoRollTargetTrack: null,
  midiKeyboardArmed: false,
  midiRecording: false,
  pianoRollLastVelocity: 0.42,
  computerKeyboardOctave: 4,
  computerKeyboardChordId: "single",
  midiLearnTarget: null,
  midiControlLearnTarget: null,
  performanceMidi: {
    controls: {},
    pressure: 0,
    pitchBend: 0,
    program: null
  },
  // Shift-click selections for loops & bars (ordered, with anchors for ranges).
  selectedLoops: [],
  loopAnchor: null,
  selectedBars: [],
  barAnchor: null,
  soloTracks: new Set(),
  mutedTracks: new Set(),
  playing: false,
  intensity: 0.45,
  loopBar: false,
  loopBarIndex: 0,
  loopBarLength: 0,
  loopBeatRange: null,
  pausedPlayback: null,
  twoBarClipboard: null,
  trackClipboard: null,
  // Rich clipboards for the new shift-select copy/paste flows.
  loopClipboard: null,
  barClipboard: null,
  playheadStep: 0,
  uiTimer: null,
  segmentsCount: 2,
  cameraMode: true,
  cameraFollow: false,
  timeSig: DEFAULT_RHYTHM_CONFIG.timeSignature,
  // Registry-driven list of track ids shown in the grid (order = render order).
  gridTrackIds: [...DEFAULT_GRID_TRACK_IDS],
  // Quantize grid for loop-lane editing (enabled + value in bars)
  quantize: { enabled: false, value: 0.25 }
};
let loopPanel = null;
let fakeMidiKeyboard = null;
let midiMapPanel = null;
let editorLaneOrder = Array.isArray(state.config.editorLaneOrder) ? [...state.config.editorLaneOrder] : [];

const editorLaneKey = (kind, id) => `${kind}:${id}`;
const parseEditorLaneKey = (key) => {
  const match = /^([^:]+):(.+)$/.exec(String(key || ""));
  return match ? { kind: match[1], id: match[2] } : null;
};

function syncEditorLaneOrderFromConfig(config = state.config) {
  editorLaneOrder = Array.isArray(config?.editorLaneOrder) ? [...config.editorLaneOrder] : [];
  state.config.editorLaneOrder = [...editorLaneOrder];
}

function liveWaveEditorLaneKeys() {
  const liveTracks = Array.isArray(loopPanel?._tracks) ? loopPanel._tracks : [];
  const configTracks = Array.isArray(state.config?.loopTracks) ? state.config.loopTracks : [];
  return (liveTracks.length ? liveTracks : configTracks)
    .map((track) => track?.id)
    .filter((id) => typeof id === "string" && id)
    .map((id) => editorLaneKey("wave", id));
}

function livePianoEditorLaneKeys() {
  return (Array.isArray(state.config?.pianoRollTracks) ? state.config.pianoRollTracks : [])
    .filter((id) => typeof id === "string" && id)
    .map((id) => editorLaneKey("piano", id));
}

function liveGridEditorLaneKeys() {
  return gridRows()
    .map((row) => row?.id)
    .filter((id) => typeof id === "string" && id)
    .map((id) => editorLaneKey("grid", id));
}

function activeEditorLaneOrder() {
  if (!editorLaneOrder.length && Array.isArray(state.config.editorLaneOrder) && state.config.editorLaneOrder.length) {
    editorLaneOrder = [...state.config.editorLaneOrder];
  }
  const activeKeys = [...liveGridEditorLaneKeys(), ...livePianoEditorLaneKeys(), ...liveWaveEditorLaneKeys()];
  const active = new Set(activeKeys);
  const ordered = [];
  editorLaneOrder.forEach((key) => {
    if (!active.has(key) || ordered.includes(key)) return;
    ordered.push(key);
  });
  activeKeys.forEach((key) => {
    if (!ordered.includes(key)) ordered.push(key);
  });
  return ordered;
}

function registerEditorLane(kind, id) {
  if (!id) return;
  const key = editorLaneKey(kind, id);
  if (!editorLaneOrder.length) {
    editorLaneOrder = activeEditorLaneOrder().filter((existingKey) => existingKey !== key);
  }
  if (!editorLaneOrder.includes(key)) editorLaneOrder.push(key);
  state.config.editorLaneOrder = [...editorLaneOrder];
}

function editorLaneGridRow(kind, id, fallbackIndex = 0, gridTrackRows = gridRows().length) {
  const order = activeEditorLaneOrder();
  const key = editorLaneKey(kind, id);
  const index = order.indexOf(key);
  return (index >= 0 ? index : Math.max(0, fallbackIndex)) + 2;
}

function editorLaneCount() {
  return activeEditorLaneOrder().length;
}

function scrollEditorLaneIntoView(kind, id) {
  if (!kind || !id || typeof window === "undefined") return;
  const key = editorLaneKey(kind, id);
  const scroll = () => {
    if (!stepGrid) return;
    const target = trackLaneElements().find((el) => el.dataset.laneKey === key);
    if (!target) return;
    const gridRect = stepGrid.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const pad = 18;
    if (rect.top < gridRect.top + pad) {
      stepGrid.scrollTop -= Math.ceil(gridRect.top + pad - rect.top);
    } else if (rect.bottom > gridRect.bottom - pad) {
      stepGrid.scrollTop += Math.ceil(rect.bottom - (gridRect.bottom - pad));
    }
  };
  window.requestAnimationFrame(() => window.requestAnimationFrame(scroll));
}

let activeTrackLaneMove = null;

function trackLaneElements() {
  return Array.from(stepGrid?.querySelectorAll?.(".track-label[data-lane-key]") || [])
    .filter((el) => el.dataset.laneKey)
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
}

function laneMoveRows(excludingKey = "") {
  return trackLaneElements()
    .filter((el) => el.dataset.laneKey !== excludingKey)
    .map((el) => ({
      key: el.dataset.laneKey,
      el,
      rect: el.getBoundingClientRect()
    }));
}

function laneDropIndexForY(clientY, rows) {
  if (!rows.length) return 0;
  for (let index = 0; index < rows.length; index += 1) {
    const rect = rows[index].rect;
    if (clientY < rect.top + rect.height / 2) return index;
  }
  return rows.length;
}

function updateLaneMoveMarker(move, clientY = move.lastClientY ?? 0) {
  if (!move?.marker || !stepGrid) return;
  const rows = laneMoveRows(move.key);
  const gridRect = stepGrid.getBoundingClientRect();
  const dropIndex = laneDropIndexForY(clientY, rows);
  const targetRect = rows[dropIndex]?.rect;
  const previousRect = rows[dropIndex - 1]?.rect;
  const top = targetRect
    ? targetRect.top
    : previousRect
      ? previousRect.bottom
      : gridRect.top + 22;
  move.dropIndex = dropIndex;
  move.marker.style.left = `${Math.round(gridRect.left)}px`;
  move.marker.style.width = `${Math.round(gridRect.width)}px`;
  move.marker.style.top = `${Math.round(top)}px`;
}

function stopLaneMove({ commit = false } = {}) {
  const move = activeTrackLaneMove;
  if (!move) return;
  activeTrackLaneMove = null;
  window.cancelAnimationFrame(move.scrollRaf || 0);
  document.removeEventListener("pointerdown", move.onPointerDown, true);
  document.removeEventListener("pointermove", move.onPointerMove);
  document.removeEventListener("click", move.onClick, true);
  document.removeEventListener("keydown", move.onKeyDown, true);
  stepGrid?.removeEventListener?.("scroll", move.onScroll);
  move.marker?.remove();
  stepGrid?.classList.remove("is-moving-track-lane");
  document.querySelectorAll(".track-label.is-moving-lane").forEach((el) => el.classList.remove("is-moving-lane"));

  if (!commit) {
    status.textContent = "Track move cancelled";
    return;
  }
  const order = activeEditorLaneOrder();
  const without = order.filter((key) => key !== move.key);
  const index = Math.max(0, Math.min(without.length, move.dropIndex ?? without.length));
  without.splice(index, 0, move.key);
  editorLaneOrder = without;
  state.config.editorLaneOrder = [...editorLaneOrder];
  buildStepGrid();
  renderTrackExplorer();
  syncJson();
  status.textContent = `Moved ${move.label || "track"}`;
}

function startLaneMoveAutoscroll(move) {
  const tick = () => {
    if (activeTrackLaneMove !== move) return;
    const rect = stepGrid.getBoundingClientRect();
    const y = move.lastClientY;
    let delta = 0;
    const edge = 54;
    if (y < rect.top + edge) delta = -Math.ceil((rect.top + edge - y) / 5);
    else if (y > rect.bottom - edge) delta = Math.ceil((y - (rect.bottom - edge)) / 5);
    if (delta) {
      stepGrid.scrollTop += delta;
      updateLaneMoveMarker(move);
    }
    move.scrollRaf = window.requestAnimationFrame(tick);
  };
  move.scrollRaf = window.requestAnimationFrame(tick);
}

function moveTrackLane(kind, id, label = "") {
  const key = editorLaneKey(kind, id);
  stopLaneMove({ commit: false });
  const marker = document.createElement("div");
  marker.className = "track-move-marker";
  document.body.appendChild(marker);
  const source = trackLaneElements().find((el) => el.dataset.laneKey === key);
  source?.classList.add("is-moving-lane");
  activeTrackLaneMove = {
    key,
    label,
    marker,
    dropIndex: activeEditorLaneOrder().indexOf(key),
    lastClientY: source?.getBoundingClientRect?.().top ?? stepGrid.getBoundingClientRect().top,
    scrollRaf: 0,
    onPointerDown: null,
    onPointerMove: null,
    onClick: null,
    onKeyDown: null,
    onScroll: null
  };
  const move = activeTrackLaneMove;
  move.onPointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation?.();
    event.stopPropagation();
    move.lastClientY = event.clientY;
    updateLaneMoveMarker(move, event.clientY);
  };
  move.onPointerMove = (event) => {
    move.lastClientY = event.clientY;
    updateLaneMoveMarker(move, event.clientY);
  };
  move.onClick = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation?.();
    event.stopPropagation();
    if (activeTrackLaneMove === move) {
      move.lastClientY = event.clientY;
      updateLaneMoveMarker(move, event.clientY);
      stopLaneMove({ commit: true });
    }
  };
  move.onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    stopLaneMove({ commit: false });
  };
  move.onScroll = () => updateLaneMoveMarker(move);
  stepGrid.classList.add("is-moving-track-lane");
  status.textContent = `Move ${label || "track"}: click where it should go`;
  updateLaneMoveMarker(move);
  startLaneMoveAutoscroll(move);
  setTimeout(() => {
    if (activeTrackLaneMove !== move) return;
    document.addEventListener("pointerdown", move.onPointerDown, true);
    document.addEventListener("pointermove", move.onPointerMove);
    document.addEventListener("click", move.onClick, true);
    document.addEventListener("keydown", move.onKeyDown, true);
    stepGrid.addEventListener("scroll", move.onScroll);
  }, 0);
}

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
const selectedControlsWrap = $("#selected-controls");
const selectedTrackPanel = $("#selected-track-panel");
const selectedTrackTab = $("#selected-tab-track");
const selectedEffectsChainPanel = $("#selected-effects-chain-panel");
const selectedGridSteps = $("#selected-grid-steps");
const selectedGridStepsInput = $("#selected-grid-steps-input");
const selectedGridStepsOutput = $("#selected-grid-steps-output");
const effectsDefaultControls = $("#selected-effects-default-controls");
const effectsDefaultLevel = $("#effects-default-level");
const effectsDefaultLevelValue = $("#effects-default-level-value");
const effectsDefaultPan = $("#effects-default-pan");
const effectsDefaultPanValue = $("#effects-default-pan-value");
const effectsDefaultDubEcho = $("#effects-default-dub-echo");
const effectsDefaultDubEchoValue = $("#effects-default-dub-echo-value");
const effectsDefaultDelay = $("#effects-default-delay");
const effectsDefaultDelayValue = $("#effects-default-delay-value");
const effectsDefaultVerb = $("#effects-default-verb");
const effectsDefaultVerbValue = $("#effects-default-verb-value");
// Right-side panels
const trackExplorerList = $("#track-explorer-list");
const trackInspectorSection = $("#track-inspector-section");
const trackInspectorName = $("#track-inspector-name");
const trackInspectorPanels = $("#track-inspector-panels");
const trackInspectorTemplate = $("#track-inspector-template");
const trackInspectorMultiHint = $("#track-inspector-multi-hint");
const sampleRootSelect = null; // replaced by server-backed sample paths
const sampleOpenBtn = $("#sample-open-folder-btn");
const sampleFileInput = /** @type {HTMLInputElement} */ ($("#sample-open-folder-input"));
const sampleBreadcrumb = $("#sample-breadcrumb");
const sampleBrowserList = $("#sample-browser-list");
const midiMapSection = $("#midi-map-section");
const midiMapList = $("#midi-map-list");
const midiMapCount = $("#midi-map-count");
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

if (selectedTrackPanel && trackInspectorSection) {
  selectedTrackPanel.appendChild(trackInspectorSection);
}

function selectedPanelTrackId() {
  return state.selectedTracks?.[0] || state.selected?.hit || defaultNoteInstrumentId();
}

function selectedDefaultTrackId() {
  if (state.selected) return "";
  const hit = state.selectedTracks?.[0] || "";
  return hit && getTrackDef(hit) ? hit : "";
}

function trackDefaultVelocity(hit) {
  const base = baseTrackId(hit);
  const fallback = DEFAULT_VELOCITY[hit] ?? DEFAULT_VELOCITY[base] ?? 0.32;
  const stored = state.config.trackDefaultVelocities?.[hit] ?? state.config.trackDefaultVelocities?.[base];
  return clamp(stored, 0, 0.9, fallback);
}

function trackDefaultNoteState(hit) {
  return {
    instrument: hit,
    velocity: trackDefaultVelocity(hit),
    options: normalizeStepOptions(state.config.trackOptionDefaults?.[hit] || {})
  };
}

function globalDefaultNoteState() {
  state.config.defaultNote = normalizeDefaultNote(state.config.defaultNote);
  return state.config.defaultNote;
}

function defaultNoteState() {
  const selectedTrack = selectedDefaultTrackId();
  return selectedTrack ? trackDefaultNoteState(selectedTrack) : globalDefaultNoteState();
}

function defaultNoteInstrumentId() {
  return globalDefaultNoteState().instrument;
}

function setTrackDefaultNotePatch(hit, patch = {}) {
  if (!hit) return defaultNoteState();
  if (patch.velocity !== undefined) {
    const velocity = trackDefaultVelocityForPatch(hit, patch.velocity);
    const base = baseTrackId(hit);
    const fallback = DEFAULT_VELOCITY[hit] ?? DEFAULT_VELOCITY[base] ?? 0.32;
    const nextVelocities = { ...(state.config.trackDefaultVelocities || {}) };
    if (Math.abs(velocity - fallback) > 0.0001) nextVelocities[hit] = velocity;
    else delete nextVelocities[hit];
    state.config.trackDefaultVelocities = nextVelocities;
  }
  if (patch.options && typeof patch.options === "object") {
    const nextOptions = normalizeTrackOptionDefaults({
      ...(state.config.trackOptionDefaults?.[hit] || {}),
      ...patch.options
    });
    const nextDefaults = { ...(state.config.trackOptionDefaults || {}) };
    if (Object.keys(nextOptions).length) nextDefaults[hit] = nextOptions;
    else delete nextDefaults[hit];
    state.config.trackOptionDefaults = nextDefaults;
  }
  syncJson();
  return trackDefaultNoteState(hit);
}

function trackDefaultVelocityForPatch(hit, value) {
  const base = baseTrackId(hit);
  const fallback = DEFAULT_VELOCITY[hit] ?? DEFAULT_VELOCITY[base] ?? 0.32;
  return clamp(value, 0, 0.9, fallback);
}

function setDefaultNotePatch(patch = {}) {
  const selectedTrack = selectedDefaultTrackId();
  if (selectedTrack && (patch.velocity !== undefined || patch.options)) {
    return setTrackDefaultNotePatch(selectedTrack, patch);
  }
  state.config.defaultNote = normalizeDefaultNote({
    ...globalDefaultNoteState(),
    ...patch,
    options: {
      ...(globalDefaultNoteState().options || {}),
      ...(patch.options || {})
    }
  });
  syncJson();
  return state.config.defaultNote;
}

function setDefaultNoteInstrument(instrument) {
  const next = setDefaultNotePatch({ instrument });
  status.textContent = `Default instrument ${trackName(next.instrument)}`;
  renderTrackInspector();
  syncSelectedEffectsDefaults();
  return next.instrument;
}

function setDefaultNoteVelocity(velocity) {
  const selectedTrack = selectedDefaultTrackId();
  const next = setDefaultNotePatch({ velocity });
  status.textContent = selectedTrack
    ? `${trackName(selectedTrack)} default note volume ${Number(next.velocity).toFixed(2)}`
    : `Default note volume ${Number(next.velocity).toFixed(2)}`;
  return next.velocity;
}

function setDefaultNoteOption(field, value) {
  const next = setDefaultNotePatch({ options: { [field]: value } });
  return next.options[field];
}

function selectedPanelGridTrackId() {
  if (!state.selectedTracks?.length && !state.selected?.hit) return "";
  const hit = selectedPanelTrackId();
  if (!hit || state.trackEditorMode !== "grid") return "";
  return state.gridTrackIds.includes(hit) ? hit : "";
}

function syncSelectedGridStepsControl() {
  const hit = selectedPanelGridTrackId();
  const visible = Boolean(hit && selectedGridStepsInput && trackPanels?.trackStepCount);
  if (selectedGridSteps) selectedGridSteps.hidden = !visible;
  if (!visible) return;
  const steps = trackPanels.trackStepCount(hit);
  selectedGridStepsInput.value = String(steps);
  if (selectedGridStepsOutput) selectedGridStepsOutput.textContent = String(steps);
  if (selectedGridSteps) selectedGridSteps.title = `${trackName(hit)} grid steps per bar`;
}

function commitSelectedGridSteps() {
  const hit = selectedPanelGridTrackId();
  if (!hit || !selectedGridStepsInput || !trackPanels?.setTrackStepCount) return;
  trackPanels.setTrackStepCount(hit, selectedGridStepsInput.value);
  syncSelectedGridStepsControl();
}

function syncSelectedEffectsDefaults() {
  const hit = selectedPanelTrackId();
  const visible = Boolean(hit);
  if (effectsDefaultControls) effectsDefaultControls.hidden = !visible;
  if (!visible) return;
  const level = selectedTrackLevelFor(hit);
  const pan = selectedTrackPanFor(hit);
  const dubEcho = selectedEffectsDubEchoAmount();
  const delay = selectedTrackBusSend(hit);
  const verb = selectedTrackReverbSend(hit);
  if (effectsDefaultLevel) effectsDefaultLevel.value = String(level);
  if (effectsDefaultLevelValue) effectsDefaultLevelValue.textContent = Number(level).toFixed(2);
  if (effectsDefaultPan) effectsDefaultPan.value = String(pan);
  if (effectsDefaultPanValue) effectsDefaultPanValue.textContent = formatPan(pan);
  if (effectsDefaultDubEcho) effectsDefaultDubEcho.value = String(dubEcho);
  if (effectsDefaultDubEchoValue) effectsDefaultDubEchoValue.textContent = Number(dubEcho).toFixed(2);
  if (effectsDefaultDelay) effectsDefaultDelay.value = String(delay);
  if (effectsDefaultDelayValue) effectsDefaultDelayValue.textContent = Number(delay).toFixed(2);
  if (effectsDefaultVerb) effectsDefaultVerb.value = String(verb);
  if (effectsDefaultVerbValue) effectsDefaultVerbValue.textContent = Number(verb).toFixed(2);
}

function selectedEffectsDubEchoAmount() {
  const options = state.selected && Number.isFinite(Number(state.selected.step))
    ? getHitData(state.selected.hit, state.selected.step, state.activeBar).options
    : defaultNoteState().options;
  return clamp(options?.dubEcho, 0, 1, 0);
}

function commitSelectedEffectDefault(kind, value, options = {}) {
  const hit = selectedPanelTrackId();
  if (!hit) return;
  if (kind === "level") {
    const next = clamp(value, 0, 2, 1);
    setTrackLevel(hit, next);
    if (effectsDefaultLevel) effectsDefaultLevel.value = String(next);
    if (effectsDefaultLevelValue) effectsDefaultLevelValue.textContent = next.toFixed(2);
  } else if (kind === "pan") {
    const next = clamp(value, -1, 1, 0);
    setTrackPan(hit, next);
    if (effectsDefaultPan) effectsDefaultPan.value = String(next);
    if (effectsDefaultPanValue) effectsDefaultPanValue.textContent = formatPan(next);
  } else if (kind === "dubEcho") {
    const next = clamp(value, 0, 1, 0);
    setSelectedDubEchoFromControl(next, options);
    if (effectsDefaultDubEcho) effectsDefaultDubEcho.value = String(next);
    if (effectsDefaultDubEchoValue) effectsDefaultDubEchoValue.textContent = next.toFixed(2);
  } else if (kind === "delay") {
    const next = clamp(value, 0, 1, 0);
    setTrackBusSend(hit, next);
    if (effectsDefaultDelay) effectsDefaultDelay.value = String(next);
    if (effectsDefaultDelayValue) effectsDefaultDelayValue.textContent = next.toFixed(2);
  } else if (kind === "verb") {
    const next = clamp(value, 0, 1, 0);
    setTrackReverbSend(hit, next);
    if (effectsDefaultVerb) effectsDefaultVerb.value = String(next);
    if (effectsDefaultVerbValue) effectsDefaultVerbValue.textContent = next.toFixed(2);
  }
}

function setSelectedBottomTab(tab = "note") {
  const noteAvailable = state.trackEditorMode === "grid";
  const requested = tab === "track" || tab === "effects" ? tab : "note";
  const next = requested === "note" && !noteAvailable ? "track" : requested;
  if (selectedControlsWrap) selectedControlsWrap.dataset.bottomTab = next;
  if (selectedTrackPanel) selectedTrackPanel.hidden = next !== "track";
  if (selectedEffectsChainPanel) selectedEffectsChainPanel.hidden = next !== "effects";
  syncSelectedTrackTabLabel();
  document.querySelectorAll("[data-selected-bottom-tab]").forEach((button) => {
    if (button.dataset.selectedBottomTab === "note") {
      button.hidden = !noteAvailable;
      button.disabled = !noteAvailable;
    }
    const active = button.dataset.selectedBottomTab === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  syncSelectedGridStepsControl();
  syncSelectedEffectsDefaults();
}

function syncSelectedTrackTabLabel(trackCount = null) {
  if (!selectedTrackTab) return;
  const count = Number.isFinite(trackCount)
    ? trackCount
    : (state.selectedTracks?.length || (state.selected?.hit ? 1 : 0));
  selectedTrackTab.textContent = count > 1 ? "Instruments" : "Instrument";
}

document.querySelectorAll("[data-selected-bottom-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    setSelectedBottomTab(button.dataset.selectedBottomTab || "note");
  });
});

if (selectedGridStepsInput) {
  selectedGridStepsInput.addEventListener("change", commitSelectedGridSteps);
  selectedGridStepsInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commitSelectedGridSteps();
    selectedGridStepsInput.blur();
  });
}

effectsDefaultLevel?.addEventListener("input", () => {
  commitSelectedEffectDefault("level", effectsDefaultLevel.value);
});
effectsDefaultLevel?.addEventListener("change", syncSelectedEffectsDefaults);
effectsDefaultPan?.addEventListener("input", () => {
  commitSelectedEffectDefault("pan", effectsDefaultPan.value);
});
effectsDefaultPan?.addEventListener("change", syncSelectedEffectsDefaults);
effectsDefaultDubEcho?.addEventListener("input", () => {
  commitSelectedEffectDefault("dubEcho", effectsDefaultDubEcho.value, { live: true, renderGrid: false });
});
effectsDefaultDubEcho?.addEventListener("change", () => {
  commitSelectedEffectDefault("dubEcho", effectsDefaultDubEcho.value, { live: false, renderGrid: false });
  syncSelectedEffectsDefaults();
});
effectsDefaultDelay?.addEventListener("input", () => {
  commitSelectedEffectDefault("delay", effectsDefaultDelay.value);
});
effectsDefaultDelay?.addEventListener("change", syncSelectedEffectsDefaults);
effectsDefaultVerb?.addEventListener("input", () => {
  commitSelectedEffectDefault("verb", effectsDefaultVerb.value);
});
effectsDefaultVerb?.addEventListener("change", syncSelectedEffectsDefaults);

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

function tagMidiParam(input, paramId, label, action = "value") {
  if (!input) return;
  input.dataset.midiParam = paramId;
  input.dataset.midiLabel = label;
  input.dataset.midiAction = action;
}

tagMidiParam(selectedVelocity, "selected.velocity", "Volume");
tagMidiParam(selectedPitch, "selected.pitch", "Pitch");
tagMidiParam(selectedDubEcho, "selected.dubEcho", "Dub Echo");
Object.entries(selectedOptionControls).forEach(([field, control]) => {
  const labels = {
    offsetMs: "Offset",
    attackMs: "Attack",
    delayMs: "Timing Delay",
    wobble: "LFO",
    delaySend: "Note Delay",
    reverbSend: "Reverb"
  };
  tagMidiParam(control.range, `selected.${field}`, labels[field] || field);
});

function normalizeEditorConfig(config = {}) {
  return normalizeSequencedRhythmConfig(config, { pressure: 0.45 });
}

function serializableConfig() {
  const next = clone(state.config);
  next.soloTracks = Array.from(state.soloTracks);
  next.mutedTracks = Array.from(state.mutedTracks);
  next.loopTracks = loopPanel?.serializeTracks?.() || [];
  next.editorLaneOrder = activeEditorLaneOrder();
  return normalizeEditorConfig(next);
}

function bars() {
  return state.config.patterns.jazz.bars;
}

function loopBarCount(config = state.config) {
  return normalizeVerseBars(config?.barsPerVerse ?? DEFAULT_LOOP_BAR_COUNT);
}

function sectionBarCount(config = state.config) {
  return normalizeSectionBars(config?.barsPerSection);
}

function maxLoopCount(config = state.config) {
  return Math.max(1, Math.floor(MAX_SEQUENCE_BARS / loopBarCount(config)));
}

function loopCount() {
  return loopCountFor(bars().length, loopBarCount());
}

function localBarIndex(barIndex = state.activeBar) {
  return localBarIndexMath(barIndex, loopBarCount());
}

function loopIndexForBar(barIndex = state.activeBar) {
  return loopIndexForBarMath(barIndex, loopBarCount(), maxLoopCount());
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
  return loopStartBarMath(loopIndex, bars().length, loopBarCount());
}

function activeLoopLength() {
  if (!state.loopBar) return 0;
  return Math.max(1, Math.round(state.loopBarLength || 1));
}

function clampLoopStart(start = state.activeBar, length = activeLoopLength() || 1) {
  return clampLoopStartMath(start, length, bars().length);
}

function barLabel(barIndex) {
  return barLabelMath(barIndex, loopBarCount(), maxLoopCount());
}

function loopRangeLabel(start = state.loopBarIndex, length = activeLoopLength() || 1) {
  const safeStart = clampLoopStart(start, length);
  if (length <= 1) return barLabel(safeStart);
  return `${barLabel(safeStart)}-${barLabel(safeStart + length - 1)}`;
}

function beatRangeStepLabel(stepAbs = 0) {
  const step = Math.max(0, Math.round(Number(stepAbs) || 0));
  const bar = Math.floor(step / 16);
  const localStep = step % 16;
  return `${bar + 1}.${String(localStep + 1).padStart(2, "0")}`;
}

function beatRangeLabel(range = state.loopBeatRange) {
  if (!range?.lengthSteps) return "";
  const start = Math.max(0, Math.round(Number(range.startStepAbs) || 0));
  const endInclusive = Math.max(start, Math.round(Number(range.endStepAbs ?? start + range.lengthSteps) || start + range.lengthSteps) - 1);
  return `${beatRangeStepLabel(start)}-${beatRangeStepLabel(endInclusive)}`;
}

function loopBarSlice(loopIndex = state.activeLoopIndex) {
  const start = loopStartBar(loopIndex);
  return Array.from({ length: loopBarCount() }, (_, index) => clone(bars()[start + index] || bars()[index % Math.max(1, bars().length)] || {}));
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
  loopBarCount,
  maxLoopCount,
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
  buildStepGrid,
  renderStepGrid,
  refreshLoopBarButton,
  selectStep,
  showContextMenu,
  resetSelectedPanel,
  trackName,
  moveTrackLane,
  startTrackMidiLearn: (hit) => midiMapPanel?.startLearning?.(hit),
  resetTrackMidiTrigger: (hit) => midiMapPanel?.resetTrackNote?.(hit),
  midiTriggerLabel: (hit) => midiMapPanel?.assignedNoteLabelFor?.(hit) || "",
  hasCustomMidiTrigger: (hit) => Boolean(midiMapPanel?.hasCustomTrackNote?.(hit)),
  playFromBar,
  loopFromBar,
  removeGridTrack: (hit) => removeGridTrack(hit)
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
function openTrackContextMenu(event, hit, laneKey) { return arrangement.openTrackContextMenu(event, hit, laneKey); }
function setLoopCount(nextCount, opts) { return arrangement.setLoopCount(nextCount, opts); }
function duplicateCurrentLoop() { return arrangement.duplicateCurrentLoop(); }
function deleteCurrentLoop() { return arrangement.deleteCurrentLoop(); }

// ══ Sequencer edit history ══════════════════════════════════════════════════
// Pattern-note edits are config mutations, not DOM-only operations. Snapshot
// the editor config before each meaningful change so Cmd/Ctrl-Z can restore
// added notes and per-note inspector edits such as volume and pitch.
const EDIT_HISTORY_LIMIT = 100;
const EDIT_HISTORY_COALESCE_MS = 900;
const editUndoStack = [];
const editRedoStack = [];
let editHistoryGroup = "";
let editHistoryAt = 0;
let restoringEditHistory = false;

function editSnapshot() {
  return {
    config: clone(state.config),
    activeBar: state.activeBar,
    activeLoopIndex: state.activeLoopIndex,
    selected: state.selected ? clone(state.selected) : null,
    selectedTracks: state.selectedTracks.slice(),
    trackAnchor: state.trackAnchor
  };
}

function clearEditHistory() {
  editUndoStack.length = 0;
  editRedoStack.length = 0;
  editHistoryGroup = "";
  editHistoryAt = 0;
}

function pushEditHistory({ groupKey = "", label = "edit" } = {}) {
  if (restoringEditHistory) return;
  const now = Date.now();
  if (groupKey && groupKey === editHistoryGroup && now - editHistoryAt < EDIT_HISTORY_COALESCE_MS) {
    editHistoryAt = now;
    return;
  }
  editUndoStack.push({ ...editSnapshot(), label });
  if (editUndoStack.length > EDIT_HISTORY_LIMIT) editUndoStack.shift();
  editRedoStack.length = 0;
  editHistoryGroup = groupKey;
  editHistoryAt = now;
}

function restoreEditSnapshot(snapshot, label) {
  if (!snapshot) return false;
  restoringEditHistory = true;
  try {
    state.config = normalizeEditorConfig(clone(snapshot.config));
    syncEditorLaneOrderFromConfig(state.config);
    state.activeBar = Math.max(0, Math.round(Number(snapshot.activeBar) || 0));
    clampActiveBar();
    state.activeLoopIndex = Math.max(0, Math.round(Number(snapshot.activeLoopIndex) || 0));
    syncActiveLoopToBar();
    state.selected = snapshot.selected ? clone(snapshot.selected) : null;
    state.selectedTracks = Array.isArray(snapshot.selectedTracks) ? snapshot.selectedTracks.slice() : [];
    state.trackAnchor = snapshot.trackAnchor ?? null;
    state.soloTracks = new Set(state.config.soloTracks || []);
    state.mutedTracks = new Set(state.config.mutedTracks || []);
    applyConfig();
    buildLoopTabs();
    buildBarTabs();
    buildStepGrid();
    refreshLoopBarButton();
    if (state.selected) {
      selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step", state.selected.bar ?? state.activeBar);
    } else {
      resetSelectedPanel();
    }
    renderStepGrid();
    renderTrackExplorer();
    renderTrackInspector();
    updateTwoBarClipboardButtons();
    updateTrackClipboardButtons();
    status.textContent = label;
    return true;
  } finally {
    restoringEditHistory = false;
    editHistoryGroup = "";
    editHistoryAt = 0;
  }
}

function undoEdit() {
  if (!editUndoStack.length) return false;
  editRedoStack.push(editSnapshot());
  return restoreEditSnapshot(editUndoStack.pop(), "Undo");
}

function redoEdit() {
  if (!editRedoStack.length) return false;
  editUndoStack.push(editSnapshot());
  return restoreEditSnapshot(editRedoStack.pop(), "Redo");
}

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
  applyConfig,
  pushEditHistory
});

function patternBar(index) { return hitData.patternBar(index); }
function getHitData(hit, step, barIndex) { return hitData.getHitData(hit, step, barIndex); }
function setHitData(hit, step, patch, barIndex) { return hitData.setHitData(hit, step, patch, barIndex); }
function setHitVelocity(hit, step, velocity, barIndex) { return hitData.setHitVelocity(hit, step, velocity, barIndex); }
function setHitVelocities(edits) { return hitData.setHitVelocities(edits); }
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
  defaultNoteState,
  setDefaultNoteVelocity,
  setDefaultNoteOption,
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
function setSelectedVelocityFromControl(value, options) { return noteInspector.setSelectedVelocityFromControl(value, options); }
function setSelectedOptionFromControl(field, value, options) { return noteInspector.setSelectedOptionFromControl(field, value, options); }
function syncSelectedDubEchoDisplay(options = null) { return noteInspector.syncSelectedDubEchoDisplay(options); }
function setSelectedDubEchoFromControl(value, options) { return noteInspector.setSelectedDubEchoFromControl(value, options); }

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
  // Track-level Level/Pan/Echo/Reverb live in the per-track inspector panels,
  // which are (re)built on selection changes and self-update on drag, so there
  // is nothing to mirror here anymore. Kept as a hook for callers.
}

function previewConfig() {
  const config = clone(state.config);
  config.soloTracks = Array.from(state.soloTracks);
  config.mutedTracks = Array.from(state.mutedTracks);
  if (loopPanel?.hasActiveSolo?.()) {
    config.soloTracks = ["__loop_solo_mute__"];
  }
  const beatRange = state.loopBeatRange;
  if (beatRange?.lengthSteps > 0) {
    config.loopPhraseBar = null;
    config.loopPhraseBarStart = null;
    config.loopPhraseBarLength = 0;
    config.loopPhraseStepStart = Math.max(0, Math.round(Number(beatRange.startStepAbs) || 0));
    config.loopPhraseStepLength = Math.max(1, Math.round(Number(beatRange.lengthSteps) || 1));
    return config;
  }
  config.loopPhraseStepStart = null;
  config.loopPhraseStepLength = 0;
  const loopLength = activeLoopLength();
  if (loopLength > 0) {
    const loopStart = clampLoopStart(state.loopBarIndex, loopLength);
    const sourceBars = Array.from({ length: loopLength }, (_, index) => clone(
      state.config.patterns.jazz.bars[loopStart + index]
        || state.config.patterns.jazz.bars[loopStart]
        || state.config.patterns.jazz.bars[state.activeBar]
        || {}
    ));
    config.patterns.jazz.bars = Array.from({ length: loopBarCount() }, (_, index) => clone(sourceBars[index % loopLength]));
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
  const beatRange = state.loopBeatRange;
  const loopButton = $("#loop-bar");
  if (loopButton) {
    loopButton.classList.toggle("is-active", loopLength > 0 || Boolean(beatRange?.lengthSteps));
    if (beatRange?.lengthSteps > 0) {
      loopButton.textContent = `Loop Beats ${beatRangeLabel(beatRange)}`;
    } else if (loopLength > 0) {
      const start = state.loopBarIndex + 1;
      const end = state.loopBarIndex + loopLength;
      loopButton.textContent = loopLength === 1
        ? `Loop Bar ${start}`
        : `Loop Bars ${start}–${end}`;
    } else {
      loopButton.textContent = "Loop Selected";
    }
  }
  $("#play-song")?.classList.toggle("is-active", loopLength === 0 && !beatRange?.lengthSteps);
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
let trackPanels = null;
const gridBuilder = createStepGridBuilder({
  state,
  stepGrid,
  barTabs,
  loopTabs,
  loopCountInput,
  status,
  loopBarCount,
  maxLoopCount,
  sectionBarCount,
  DEFAULT_VELOCITY,
  gridRows,
  pianoRollRows,
  trackStepCount: (hit) => trackPanels?.trackStepCount?.(hit) ?? 16,
  loopCount,
  localBarIndex,
  loopIndexForBar,
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
  toggleMute,
  paintSelectedVelocityPreview,
  previewRowSelectionControls,
  previewStepSelectionControls,
  selectRowWithModifiers,
  selectRowToggle,
  selectStep,
  getHitData,
  setHitData,
  setHitVelocity,
  setHitVelocities,
  displayedPitchForHit,
  formatPitch,
  noteNameForPitch,
  toggleLoopMultiSelect,
  toggleBarMultiSelect,
  openLoopContextMenu,
  openBarContextMenu,
  openTrackContextMenu,
  showContextMenu,
  loopBeatSelection,
  playBeatSelection,
  clearBeatLoop,
  editorLaneGridRow,
  editorLaneCount,
  resetSelectedPanel,
  onAfterBuild: () => loopPanel.rebuildStepGridRows(),
  onAfterRender: () => loopPanel.renderAllLanes()
});

function buildStepGrid() { return gridBuilder.buildStepGrid(); }
function buildLoopTabs() { return gridBuilder.buildLoopTabs(); }
function buildBarTabs() { return gridBuilder.buildBarTabs(); }
function renderStepGrid() {
  gridBuilder.renderStepGrid();
}
function refreshPianoRollLanes() { return gridBuilder.refreshPianoRollLanes(); }
function renderCameraPlayheadHits(barIndex, stepIndex) { return gridBuilder.renderCameraPlayheadHits(barIndex, stepIndex); }
function clearCameraPlayheadHits() { return gridBuilder.clearCameraPlayheadHits(); }
function updatePlaybackTabHighlights(barIndex) { return gridBuilder.updatePlaybackTabHighlights(barIndex); }

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
  DEFAULT_VELOCITY,
  setPairedControl, formatPitch,
  effectiveStepOptionsForTrack,
  getHitData, setHitVelocity,
  syncSelectedPitchDisplay, syncSelectedDubEchoDisplay, renderSelectedPiano,
  soundingStepForRow,
  updateTrackClipboardButtons,
  renderTrackInspector, renderTrackExplorer,
  renderStepGrid,
  previewConfig,
  defaultNoteState,
  trackName
});

function selectStep(hit, step, mode, barIndex, pressure, generated, options) {
  const result = rowSelection.selectStep(hit, step, mode, barIndex, pressure, generated, options);
  if (mode !== "row") {
    setSelectedBottomTab("note");
    requestAnimationFrame(() => {
      if (state.selected?.mode !== "row") setSelectedBottomTab("note");
    });
  }
  return result;
}
function bottomTabForRowSelection(options = {}) {
  if (options.bottomTab === "note" || options.bottomTab === "track" || options.bottomTab === "effects") {
    return options.bottomTab;
  }
  return selectedControlsWrap?.dataset.bottomTab || "note";
}
function selectRow(hit, opts = {}) {
  const result = rowSelection.selectRow(hit, opts);
  setSelectedBottomTab(bottomTabForRowSelection(opts));
  return result;
}
function paintSelectedVelocityPreview(value) { return rowSelection.paintSelectedVelocityPreview(value); }
function previewRowSelectionControls(hit) { return rowSelection.previewRowSelectionControls(hit); }
function previewStepSelectionControls(hit, step, barIndex, fallbackVelocity) { return rowSelection.previewStepSelectionControls(hit, step, barIndex, fallbackVelocity); }
function selectRowToggle(hit, options = {}) {
  const result = rowSelection.selectRowToggle(hit, options);
  setSelectedBottomTab(bottomTabForRowSelection(options));
  return result;
}
function selectRowWithModifiers(hit, event, options = {}) {
  const result = rowSelection.selectRowWithModifiers(hit, event, options);
  setSelectedBottomTab(bottomTabForRowSelection(options));
  return result;
}
function orderBySelectedGrid(ids) { return rowSelection.orderBySelectedGrid(ids); }
function resetSelectedPanel() { return rowSelection.resetSelectedPanel(); }
function clearSelection() { return rowSelection.clearSelection(); }
function toggleSolo(track) { return rowSelection.toggleSolo(track); }
function toggleMute(track) { return rowSelection.toggleMute(track); }
function clearSolo() { return rowSelection.clearSolo(); }
function renderSoloButtons() { return rowSelection.renderSoloButtons(); }

// ══ Config sync controller ══════════════════════════════════════════════════
// getPathValue, setPathValue, syncSliders, syncJson, applyConfig
// live in their own controller. Hoisted wrappers below preserve all call sites.
const configSync = createConfigSync({
  $,
  state,
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

function applySegments(count) {
  const n = Math.max(1, Math.min(loopBarCount(), Math.round(count) || 2));
  state.segmentsCount = n;
  const input = /** @type {HTMLInputElement|null} */ ($("#segments-count"));
  if (input) {
    input.max = String(loopBarCount());
    input.value = String(n);
  }
  buildStepGrid();
}

function applyCameraFollow(enabled) {
  state.cameraFollow = Boolean(enabled);
  const input = /** @type {HTMLInputElement|null} */ ($("#camera-follow-enabled"));
  if (input) input.checked = state.cameraFollow;
  updatePlaybackTabHighlights(state.cameraPlayheadBar ?? state.activeBar);
  status.textContent = state.cameraFollow ? "Follow on" : "Follow off";
}

function parseQuantizeValue(value) {
  if (typeof value === "string" && value.includes("/")) {
    const [top, bottom] = value.split("/").map(Number);
    if (Number.isFinite(top) && Number.isFinite(bottom) && bottom !== 0) return top / bottom;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : 0.25;
}

function formatQuantizeValue(value) {
  const number = parseQuantizeValue(value);
  if (number >= 1) return `${number} bar${number === 1 ? "" : "s"}`;
  const denom = Math.round(1 / Math.max(0.0001, number));
  return `1/${denom}`;
}

function syncQuantizeControls() {
  const qEnabled = /** @type {HTMLInputElement|null} */ ($("#quantize-enabled"));
  const qValue = /** @type {HTMLSelectElement|null} */ ($("#quantize-value"));
  state.quantize = {
    enabled: Boolean(state.quantize?.enabled),
    value: parseQuantizeValue(state.quantize?.value ?? 0.25)
  };
  if (qEnabled) qEnabled.checked = state.quantize.enabled;
  if (qValue) {
    const target = String(state.quantize.value);
    const match = [...qValue.options].find((option) => Math.abs(parseQuantizeValue(option.value) - state.quantize.value) < 0.000001);
    qValue.value = match?.value || target;
    qValue.disabled = !state.quantize.enabled;
  }
}

function syncContextPanels() {
  const quantizePanel = $("#quantize-panel");
  if (quantizePanel) {
    const sampleEditorMode = document.querySelector("#sample-browser-section")?.dataset.sampleAddMode === "loop";
    quantizePanel.hidden = !(state.trackEditorMode === "pianoRoll" || state.trackEditorMode === "wave" || sampleEditorMode);
    syncQuantizeControls();
  }
  const loopTracksGroup = $("#loop-tracks-group");
  if (loopTracksGroup) loopTracksGroup.hidden = state.trackEditorMode !== "wave";
  setSelectedBottomTab(selectedControlsWrap?.dataset.bottomTab || "note");
  midiMapPanel?.sync?.();
  fakeMidiKeyboard?.sync?.();
}

function selectedBarIsVisible() {
  if (!state.selected) return false;
  const bar = Math.max(0, Math.round(Number(state.selected.bar ?? state.activeBar) || 0));
  const start = Math.max(0, Math.round(Number(state.activeBar) || 0));
  const segments = Math.max(1, Math.round(Number(state.segmentsCount) || 1));
  return bar >= start && bar < start + segments;
}

function refreshArrangementScaleUi(message = "") {
  clampActiveBar();
  if (state.segmentsCount > loopBarCount()) state.segmentsCount = loopBarCount();
  applyConfig();
  applySegments(state.segmentsCount);
  buildLoopTabs();
  buildBarTabs();
  renderStepGrid();
  refreshLoopBarButton();
  if (state.selected?.mode === "row") {
    selectStep(state.selected.hit, state.selected.step, "row", state.activeBar);
  } else if (selectedBarIsVisible()) {
    selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step", state.selected.bar ?? state.activeBar);
  } else if (state.selected) {
    resetSelectedPanel();
  }
  if (message) status.textContent = message;
}

function applyVerseBarCount(value) {
  const next = normalizeVerseBars(value);
  if (state.config.barsPerVerse === next) {
    syncSliders();
    return;
  }
  state.config.barsPerVerse = next;
  state.activeLoopIndex = loopIndexForBar(state.activeBar);
  refreshArrangementScaleUi(`Bars per verse: ${next}`);
}

function applySectionBarCount(value) {
  const next = normalizeSectionBars(value);
  if (state.config.barsPerSection === next) {
    syncSliders();
    return;
  }
  state.config.barsPerSection = next;
  applyConfig();
  buildBarTabs();
  renderStepGrid();
  status.textContent = `Bars per section: ${next}`;
}

function applyMetronomeEnabled(enabled) {
  state.config.metronomeEnabled = enabled ? 1 : 0;
  applyConfig();
  status.textContent = enabled ? "Metronome on" : "Metronome off";
}

function applyMetronomeVolume(value) {
  state.config.metronomeVolume = Math.max(0, Math.min(1, Number(value) || 0));
  applyConfig();
  const output = $("#metronome-volume-value");
  if (output) output.textContent = state.config.metronomeVolume.toFixed(2);
}

function applyTimeSig(value) {
  const next = normalizeTimeSignature(value);
  state.timeSig = next;
  state.config.timeSignature = next;
  stepGrid.dataset.timeSig = next;
  applyConfig();
  buildStepGrid();
  renderStepGrid();
  const sel = /** @type {HTMLSelectElement|null} */ ($("#time-sig-select"));
  if (sel) {
    sel.value = [...sel.options].some((option) => option.value === next) ? next : "";
  }
  const [numerator, denominator] = next.split("/");
  const numeratorInput = /** @type {HTMLInputElement|null} */ ($("#time-sig-numerator"));
  const denominatorInput = /** @type {HTMLInputElement|null} */ ($("#time-sig-denominator"));
  if (numeratorInput) numeratorInput.value = numerator;
  if (denominatorInput) denominatorInput.value = denominator;
  document.querySelectorAll("[data-time-sig]").forEach((option) => {
    const active = option.dataset.timeSig === next;
    option.classList.toggle("is-active", active);
    option.setAttribute("aria-selected", active ? "true" : "false");
  });
  status.textContent = `Time signature: ${next}`;
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
  renderCameraPlayheadHits,
  clearCameraPlayheadHits,
  updatePlaybackTabHighlights,
  selectStep,
  soundingStepForRow,
  getHitData,
  syncSelectedPitchDisplay,
  onEngineRestart: () => loopPanel.attachScheduler()
});

function startPlayback() { return transport.startPlayback(); }
function stopPlayback() { return transport.stopPlayback(); }
function setLoopPlayback(length) { return transport.setLoopPlayback(length); }
function loopBeatSelection(range) { return transport.loopBeatSelection(range); }
function playBeatSelection(range) { return transport.playBeatSelection(range); }
function clearBeatLoop() { return transport.clearBeatLoop(); }
function toggleBarLoop() { return transport.toggleBarLoop(); }
function toggleTwoBarLoop() { return transport.toggleTwoBarLoop(); }
function playFullSong() { return transport.playFullSong(); }
function playFromBar(barIndex) { return transport.playFromBar(barIndex); }
function loopFromBar(barIndex, length) { return transport.loopFromBar(barIndex, length); }
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
  getSerializableConfig: serializableConfig,
  syncJson,
  applyConfig,
  downloadJsonFile,
  saveDefaultProject,
  loadDefaultProject,
  getLocalServerMode,
  fetchSavedConfig,
  reconcileGridTracks,
  resetSelectedPanel,
  buildLoopTabs,
  buildBarTabs,
  buildStepGrid,
  renderTrackExplorer,
  renderTrackInspector,
  reapplyTrackSamples,
  restoreLoopTracks: (tracks) => loopPanel.restoreTracks(tracks),
  onConfigLoaded: syncEditorLaneOrderFromConfig,
  updateTwoBarClipboardButtons,
  updateTrackClipboardButtons
});

function downloadConfig() { return configFile.downloadConfig(); }
function applyLoadedConfig(nextConfig) {
  clearEditHistory();
  syncEditorLaneOrderFromConfig(normalizeEditorConfig(nextConfig));
  return configFile.applyLoadedConfig(nextConfig);
}
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
    wireNumberControl,
    startPlayback, stopPlayback, restartPlayback,
    playFullSong, toggleBarLoop, toggleTwoBarLoop,
    duplicateCurrentLoop, deleteCurrentLoop,
    copyTwoBars, pasteTwoBars, fillRestWithTwoBars,
    copyTrackTwoBars, pasteTrackTwoBars, fillRestWithTrackTwoBars,
    setLoopCount,
    applySegments, applyCameraFollow, applyVerseBarCount, applySectionBarCount, applyMetronomeEnabled, applyMetronomeVolume, applyTimeSig,
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
    renderAddTrackDialog, openAddTrackDialog,
    openGlobalMixView, closeGlobalMixView, resetMasterEq,
    projectManager,
    sampleBrowser,
    closeContextMenu,
    undoEdit,
    redoEdit,
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
let sampleBrowser = null;
loopPanel = createLoopTrackPanel({
  stepGrid,
  $,
  getBarsLength: () => bars().length,
  getSegmentsCount: () => state.renderedSegmentsCount || state.segmentsCount,
  getActiveBar: () => state.cameraMode ? 0 : state.activeBar,
  setStatus: (msg) => { status.textContent = msg; },
  getEngine: () => state.engine,
  getQuantize: () => state.quantize,
  getCameraMode: () => state.cameraMode,
  getTrackEditorMode: () => state.trackEditorMode,
  getSelectedPatternTrack: () => state.selected?.hit || state.selectedTracks[0] || null,
  onEditorLaneOpen: registerEditorLane,
  onEditorLaneFocus: scrollEditorLaneIntoView,
  onTrackSelect: selectWaveTrack,
  onTrackRemove: (track) => {
    if (state.selected?.hit === track?.id) {
      resetSelectedPanel();
      renderStepGrid();
    } else {
      renderTrackInspector();
    }
    syncJson();
  },
  editorLaneGridRow,
  rebuildTrackStack: buildStepGrid,
  showContextMenu,
  moveTrackLane,
  addSampleToBrowser: (sample) => sampleBrowser?.addCapturedSample?.(sample),
  trackName: (id) => trackPanels?.instanceLabel?.(id) || trackName(id),
  isTrackMuted: (id) => state.mutedTracks?.has?.(id) || false,
  toggleMute: (id) => toggleMute(id),
  onSoloChange: () => state.engine.setConfig(previewConfig()),
  onNavigate: (bar) => {
    // Scroll the step-grid view to show the given bar, then repaint lanes
    const seg = state.segmentsCount || 2;
    state.activeBar = Math.max(0, Math.floor(bar / seg) * seg);
    renderStepGrid(); // rebuilds bar tabs + calls renderAllLanes
  }
});

// ── Quantize panel wiring ──────────────────────────────────────────────────
{
  const qEnabled = /** @type {HTMLInputElement|null} */ ($("#quantize-enabled"));
  const qValue   = /** @type {HTMLSelectElement|null}  */ ($("#quantize-value"));
  const applyQuantizeUiChange = () => {
    syncQuantizeControls();
    fakeMidiKeyboard?.sync?.();
    refreshPianoRollLanes();
    status.textContent = state.quantize.enabled
      ? `Quantize ${formatQuantizeValue(state.quantize.value)}`
      : "Quantize off";
  };
  if (qEnabled) qEnabled.addEventListener("change", () => {
    state.quantize.enabled = qEnabled.checked;
    applyQuantizeUiChange();
  });
  if (qValue) qValue.addEventListener("change", () => {
    state.quantize.value = parseQuantizeValue(qValue.value);
    applyQuantizeUiChange();
  });
}

// ══ Track panels controller (grid mgmt + Add-Track + Explorer + Inspector) ══
// The right-side track UI cluster lives in its own controller; the editor keeps
// thin, hoisted wrappers so the rest of the file calls these by their old names.
trackPanels = createTrackPanels({
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
  replaceTrackIdInConfig,
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
  previewRowSelectionControls,
  selectRowWithModifiers,
  orderBySelectedGrid,
  toggleSolo,
  toggleMute,
  previewConfig,
  getEngine: () => state.engine,
  showContextMenu,
  onEditorLaneOpen: registerEditorLane,
  onTrackIdReplaced: () => syncEditorLaneOrderFromConfig(state.config),
  onTrackEditorModeChange: syncContextPanels,
  onTrackInspectorSelectionChange: syncSelectedTrackTabLabel,
  defaultNoteState,
  setDefaultNoteInstrument
});

// Hoisted wrappers around the controller API (preserve the original names that
// the rest of the editor and the global-mix panel call).
function reconcileGridTracks() { return trackPanels.reconcileGridTracks(); }
function addGridTrack(trackId, opts) { return trackPanels.addGridTrack(trackId, opts); }
function addTrackInstance(baseId, opts) { return trackPanels.addTrackInstance(baseId, opts); }
function addProjectTrack(trackId, opts) { return trackPanels.addProjectTrack(trackId, opts); }
function openTrackPianoRoll(trackId, opts) {
  const result = trackPanels.openTrackPianoRoll(trackId, opts);
  scrollEditorLaneIntoView("piano", trackId);
  return result;
}
function removeGridTrack(trackId) { return trackPanels.removeGridTrack(trackId); }
function instanceLabel(id) { return trackPanels.instanceLabel(id); }

function wireTrackPaletteButtons() {
  const instrumentList = $("#instrument-palette-list");
  const effectsList = $("#effects-palette-list");
  const instrumentCount = $("#instrument-palette-count");
  const effectsCount = $("#effects-palette-count");
  const effectPalette = [
    {
      id: "dubEcho",
      label: "Dub Echo",
      title: "Edit per-note dub echo amount",
      control: selectedDubEcho
    },
    {
      id: "noteDelay",
      label: "Note Delay",
      title: "Edit per-note delay send",
      control: selectedNoteDelaySend
    },
    {
      id: "reverb",
      label: "Reverb",
      title: "Edit per-note reverb send",
      control: selectedNoteReverbSend
    }
  ];
  const projectIds = () => new Set([
    ...(Array.isArray(state.config.trackViewTrackIds) ? state.config.trackViewTrackIds : []),
    ...Object.keys(state.config.trackSamples || {}),
    ...(Array.isArray(state.config.pianoRollTracks) ? state.config.pianoRollTracks : [])
  ]);
  const baseProjectCount = (id) => {
    const ids = projectIds();
    return state.gridTrackIds.filter((trackId) => baseTrackId(trackId) === id && ids.has(trackId)).length
      + (ids.has(id) && !state.gridTrackIds.includes(id) ? 1 : 0);
  };
  const currentSampleAddMode = () =>
    document.querySelector("#sample-browser-section")?.dataset.sampleAddMode || "hit";
  const addFromPalette = (track, { respectsAddMode = false } = {}) => {
    let trackId = track.id;
    const alreadyProject = baseProjectCount(track.id) > 0;
    const mode = currentSampleAddMode();
    if (respectsAddMode && mode === "loop") {
      status.textContent = "Wave Edit is for samples only";
      return;
    }
    if (track.instanceable && alreadyProject) {
      trackId = addTrackInstance(track.id, { select: true });
    } else {
      addGridTrack(track.id, { expose: true });
      addProjectTrack(track.id, { render: false });
      selectRow(track.id, { deferTrackPanels: true });
      renderStepGrid();
    }
    if (!trackId) return;
    if (respectsAddMode && mode === "pianoRoll") {
      openTrackPianoRoll(trackId);
      status.textContent = `Opened ${track.label} in Piano Roll`;
    }
    renderTrackPaletteButtons();
    renderTrackExplorer();
    renderTrackInspector();
    syncJson();
    if (!(respectsAddMode && mode === "pianoRoll")) {
      status.textContent = alreadyProject && track.instanceable
        ? `Added another ${track.label}`
        : `Added ${track.label} to Track View`;
    }
  };
  const renderPalette = (host, countEl, tracks, { respectsAddMode = false } = {}) => {
    if (!host) return;
    host.innerHTML = "";
    if (countEl) countEl.textContent = `${tracks.length}`;
    tracks.forEach((track) => {
      const count = baseProjectCount(track.id);
      const mode = currentSampleAddMode();
      const disabled = respectsAddMode && mode === "loop";
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.trackPaletteAdd = track.id;
      button.className = count > 0 ? "is-added" : "";
      button.textContent = count > 1 ? `${track.label} ${count}` : count === 1 ? `${track.label} added` : track.label;
      button.disabled = disabled;
      button.title = disabled
        ? "Wave Edit is for samples only"
        : respectsAddMode && mode === "pianoRoll"
          ? `Open ${track.label} in Piano Roll`
          : count > 0 && track.instanceable
            ? `Add another ${track.label}`
            : `Add ${track.label} to Track View`;
      button.addEventListener("click", () => addFromPalette(track, { respectsAddMode }));
      host.appendChild(button);
    });
  };
  const focusEffectControl = (effect) => {
    if (state.trackEditorMode !== "grid") {
      status.textContent = `${effect.label} is available on grid notes`;
      return;
    }
    setSelectedBottomTab("note");
    effect.control?.focus?.();
    effect.control?.closest?.("label")?.classList.add("is-palette-target");
    window.setTimeout(() => {
      effect.control?.closest?.("label")?.classList.remove("is-palette-target");
    }, 420);
    status.textContent = `${effect.label} is edited in the Note panel`;
  };
  const renderEffectPalette = () => {
    if (!effectsList) return;
    effectsList.innerHTML = "";
    if (effectsCount) effectsCount.textContent = `${effectPalette.length}`;
    effectPalette.forEach((effect) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "is-effect-control";
      button.dataset.effectPalette = effect.id;
      button.textContent = effect.label;
      button.title = effect.title;
      button.addEventListener("click", () => focusEffectControl(effect));
      effectsList.appendChild(button);
    });
  };
  function renderTrackPaletteButtons() {
    const instruments = TRACK_REGISTRY.filter((track) => track.group !== "fx" && track.voice !== "sample");
    renderPalette(instrumentList, instrumentCount, instruments, { respectsAddMode: true });
    renderEffectPalette();
  }
  renderTrackPaletteButtons();
  window.rhythmEditorRenderTrackPalettes = renderTrackPaletteButtons;
}
function renderAddTrackDialog() { return trackPanels.renderAddTrackDialog(); }
function openAddTrackDialog(groupId) { return trackPanels.openAddTrackDialog(groupId); }
function renderTrackExplorer() {
  const result = trackPanels.renderTrackExplorer();
  midiMapPanel?.sync?.();
  fakeMidiKeyboard?.sync?.();
  return result;
}
function trackSupportsShape(hit) { return trackPanels.trackSupportsShape(hit); }
function renderTrackShapeControls(hit, container) { return trackPanels.renderTrackShapeControls(hit, container); }
function assignSampleToTrack(hit, sample, opts) { return trackPanels.assignSampleToTrack(hit, sample, opts); }
function clearTrackSample(hit) { return trackPanels.clearTrackSample(hit); }
function reapplyTrackSamples() { return trackPanels.reapplyTrackSamples(); }

function selectedWaveTrackForInspector() {
  const hit = state.selected?.hit;
  if (!hit || state.selected?.mode !== "row") return null;
  return loopPanel?._tracks?.find?.((track) => track.id === hit) || null;
}

function renderWaveTrackInspector(track) {
  if (!trackInspectorPanels) return;
  trackInspectorPanels.innerHTML = "";
  if (trackInspectorName) trackInspectorName.textContent = track.name || "Wave Edit";
  if (trackInspectorMultiHint) trackInspectorMultiHint.hidden = false;

  const panel = document.createElement("div");
  panel.className = "track-inspector-body";
  panel.dataset.trackPanel = "";
  panel.dataset.waveTrackId = track.id;

  const head = document.createElement("div");
  head.className = "track-inspector-panel-head";
  const name = document.createElement("strong");
  name.className = "track-inspector-panel-name";
  name.textContent = track.name || "Wave Edit";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "track-inspector-panel-close";
  close.title = "Remove from inspector";
  close.textContent = "x";
  close.addEventListener("click", () => {
    resetSelectedPanel();
    renderStepGrid();
  });
  head.append(name, close);

  const sample = document.createElement("div");
  sample.className = "track-inspector-sample";
  const sampleLabel = document.createElement("span");
  sampleLabel.className = "track-inspector-sublabel";
  sampleLabel.textContent = "Wave Edit";
  const sampleRow = document.createElement("div");
  sampleRow.className = "track-inspector-sample-row";
  const sampleName = document.createElement("span");
  sampleName.className = "track-sample-name is-custom";
  sampleName.textContent = track.fileName || track.path || track.name || "Audio sample";
  sampleRow.appendChild(sampleName);
  sample.append(sampleLabel, sampleRow);

  const layout = document.createElement("div");
  layout.className = "track-inspector-layout";
  const regionCount = Array.isArray(track.regions) ? track.regions.length : 0;
  const layoutLabel = document.createElement("span");
  layoutLabel.className = "track-inspector-sublabel";
  layoutLabel.textContent = "Region Settings";
  const regionOutput = document.createElement("output");
  regionOutput.textContent = `${regionCount} region${regionCount === 1 ? "" : "s"}`;
  layout.append(layoutLabel, regionOutput);

  panel.append(head, sample, layout);
  trackInspectorPanels.appendChild(panel);
}

function renderTrackInspector() {
  const waveTrack = selectedWaveTrackForInspector();
  const result = waveTrack ? renderWaveTrackInspector(waveTrack) : trackPanels.renderTrackInspector();
  setSelectedBottomTab(selectedControlsWrap?.dataset.bottomTab || "note");
  return result;
}

function selectWaveTrack(track) {
  if (!track?.id) return;
  state.selected = {
    hit: track.id,
    step: 0,
    mode: "row",
    generated: false,
    bar: state.activeBar
  };
  state.selectedTracks = [];
  state.trackAnchor = null;
  selectedLabel.textContent = `${track.name || "Wave Edit"} wave`;
  renderTrackInspector();
  renderStepGrid();
  status.textContent = `Selected ${track.name || "Wave Edit"}`;
}

midiMapPanel = createMidiMapPanel({
  state,
  section: midiMapSection,
  list: midiMapList,
  countEl: midiMapCount,
  setStatus: (msg) => { status.textContent = msg; },
  trackName: (id) => trackPanels?.instanceLabel?.(id) || trackName(id),
  getTrackDef,
  baseTrackId,
  syncJson,
  showContextMenu,
  onLearnStart: () => {
    fakeMidiKeyboard?.setKeyboardArmed?.(true, { announce: false });
  }
});
midiMapPanel.sync();

fakeMidiKeyboard = createFakeMidiKeyboard({
  $,
  state,
  runningFromFile,
  setStatus: (msg) => { status.textContent = msg; },
  normalizeStepOptions,
  readStoredHit,
  setHitData,
  selectStep,
  buildStepGrid,
  refreshPianoRollLanes,
  renderStepGrid,
  addGridTrack,
  renderTrackExplorer,
  renderTrackInspector,
  renderSelectedPiano,
  SYNTH_ROOT_HZ,
  PITCH_SLIDER_MIN,
  PITCH_SLIDER_MAX,
  BLACK_NOTE_PITCH_CLASSES,
  A1_MIDI_NOTE,
  noteNameForPitch,
  formatPitch,
  midiMapPanel,
  trackName: (id) => trackPanels?.instanceLabel?.(id) || id,
  showContextMenu,
  onTrackEditorModeChange: syncContextPanels
});

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
  getConfig: serializableConfig,
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
sampleBrowser = createSampleBrowser({
  openBtn: sampleOpenBtn,
  fileInput: sampleFileInput,
  breadcrumb: sampleBreadcrumb,
  list: sampleBrowserList,
  setStatus: (text) => { status.textContent = text; },
  getSelectedHit: () => state.selected?.hit ?? null,
  assignSample: (hit, sample) => assignSampleToTrack(hit, sample),
  addSampleTrack: ({ name, file, source }) => {
    const cleanName = String(name || "Sample").replace(/\.[^.]+$/, "");
    state.trackEditorMode = "wave";
    syncContextPanels();
    return loopPanel.addTrack(cleanName, file, 4, false, {
      ...source,
      fileName: source?.fileName ?? name
    });
  },
  addPianoRollTrack: async ({ name, sample }) => {
    const id = addTrackInstance("sampler", { select: false, expose: false });
    if (!id) {
      status.textContent = "Could not create sampler instrument";
      return;
    }
    await assignSampleToTrack(id, {
      ...sample,
      label: sample?.label || name,
      fileName: sample?.fileName ?? name
    }, { expose: false });
    openTrackPianoRoll(id, { exposeGrid: false });
    status.textContent = `Opened ${name || "sample"} as piano-roll sampler`;
  },
  onSampleFolderConfigured: (options) => loopPanel.relinkMissingFromSampleFolder(options),
  onAddModeChange: () => {
    syncContextPanels();
    window.rhythmEditorRenderTrackPalettes?.();
  }
});

buildLoopTabs();
buildBarTabs();
fakeMidiKeyboard.wire();
buildStepGrid();
wireEvents();
wireTrackPaletteButtons();
syncContextPanels();
installRotaryControls(document);
applySegments(2);
refreshLoopBarButton();

window.addEventListener("resize", () => buildStepGrid());

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
