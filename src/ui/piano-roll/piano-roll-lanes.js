// Piano-roll lane renderer.
//
// This module owns the MIDI-style note-bar layout that can sit below the main
// grid. The step-grid builder decides where the lanes are mounted; this file
// decides how opened piano-roll instruments are drawn.

import { createAutomationLane } from "./automation/automation-lane.js";
import { PITCH_OFFSET_MAX, PITCH_OFFSET_MIN } from "../../audio/rhythm-config.js";
import { syncStepGridLaneRows } from "../grid/lane-grid-layout.js";

const DEFAULT_ACCENT = "#c4b5fd";
const DEFAULT_LANE_HEIGHT = 58;
const MIN_LANE_HEIGHT = 40;
const MAX_LANE_HEIGHT = 1600;
const DEFAULT_TRACK_STEPS_PER_BAR = 16;
const PITCH_WINDOW_ROWS = 12;
const PITCH_ROW_HEIGHT = 10;
const DEFAULT_PITCH_WINDOW_MIN = -5;
const PITCH_WHEEL_PIXEL_THRESHOLD = 56;
const PITCH_WHEEL_MAX_ROWS_PER_EVENT = 1;
let editSerial = 0;

const escapeSelectorValue = (value) => {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
};

function openPianoRollTrackIds(state) {
  return Array.isArray(state.config?.pianoRollTracks)
    ? state.config.pianoRollTracks.filter((id) => typeof id === "string" && id)
    : [];
}

function chordIntervalsForEntry(options = {}) {
  const raw = Array.isArray(options.chordIntervals) && options.chordIntervals.length
    ? options.chordIntervals
    : [0];
  const intervals = [];
  raw.forEach((entry) => {
    const interval = Math.round(Number(entry) || 0);
    if (!intervals.includes(interval)) intervals.push(interval);
  });
  if (!intervals.includes(0)) intervals.unshift(0);
  return intervals.slice(0, 8);
}

const uniqueSortedPitches = (pitches = []) => Array.from(new Set(
  pitches
    .map((pitch) => Math.round(Number(pitch) || 0))
    .filter((pitch) => Number.isFinite(pitch))
)).sort((a, b) => a - b);

function chordPitchesForOptions(options = {}) {
  const rootPitch = Math.round(Number(options.pitch) || 0);
  return uniqueSortedPitches(chordIntervalsForEntry(options).map((interval) => rootPitch + interval));
}

function optionsForChordPitches(templateOptions = {}, pitches = []) {
  const normalized = uniqueSortedPitches(pitches);
  if (!normalized.length) return null;
  const rootPitch = normalized[0];
  return {
    ...templateOptions,
    pitch: rootPitch,
    chordIntervals: normalized.map((pitch) => pitch - rootPitch),
    pianoRoll: 1
  };
}

export function optionsWithoutPianoRollNote(note = {}) {
  const options = note.options || {};
  const rootPitch = Math.round(Number(note.rootPitch ?? options.pitch) || 0);
  const removedInterval = Math.round(Number(note.interval) || 0);
  const remaining = chordIntervalsForEntry(options)
    .filter((interval) => interval !== removedInterval)
    .map((interval) => rootPitch + interval);
  return optionsForChordPitches(options, remaining);
}

export function optionsWithPianoRollNote(options = {}, pitch = 0, templateOptions = options) {
  return optionsForChordPitches(templateOptions, [
    ...chordPitchesForOptions(options),
    Math.round(Number(pitch) || 0)
  ]);
}

export function notesForTrack({ state, trackId, renderedSegmentCount, normalizeStepPosition, baseStepsPerBar, viewStartBar = 0 }) {
  const bars = state.config?.patterns?.jazz?.bars || [];
  const notes = [];
  const startBar = Math.max(0, Math.round(Number(viewStartBar) || 0));
  const endBar = startBar + Math.max(1, Math.round(Number(renderedSegmentCount) || 1));
  const appendNote = ({ bar, step, velocity, options, hitIndex = -1, live = false, liveId = "", source = null }) => {
    if (bar < startBar || bar >= endBar) return;
    if (!Number.isFinite(velocity) || velocity <= 0.005) return;
    if (!(Number(options.pianoRoll) >= 0.5 || options.pianoRoll === true)) return;
    const viewBar = bar - startBar;
    const rootPitch = Math.round(Number(options.pitch) || 0);
    chordIntervalsForEntry(options).forEach((interval, chordIndex) => {
      notes.push({
        bar,
        viewBar,
        step,
        velocity,
        rootStep: step,
        pitch: rootPitch + interval,
        rootPitch,
        interval,
        hitIndex,
        chordIndex,
        options,
        baseStepsPerBar,
        live,
        liveId,
        source
      });
    });
  };
  for (let viewBar = 0; viewBar < renderedSegmentCount; viewBar += 1) {
    const bar = startBar + viewBar;
    const hits = Array.isArray(bars[bar]?.[trackId]) ? bars[bar][trackId] : [];
    hits.forEach((entry, hitIndex) => {
      if (!Array.isArray(entry)) return;
      const step = normalizeStepPosition(entry[0]);
      const velocity = Number(entry[1]);
      const options = entry[2] && typeof entry[2] === "object" ? entry[2] : {};
      appendNote({ bar, step, velocity, options, hitIndex });
    });
  }
  (Array.isArray(state.livePianoRollNotes) ? state.livePianoRollNotes : []).forEach((entry) => {
    if (!entry || entry.track !== trackId) return;
    const bar = Math.max(0, Math.round(Number(entry.bar) || 0));
    const step = normalizeStepPosition(entry.step);
    const velocity = Number(entry.velocity);
    const options = {
      ...(entry.options && typeof entry.options === "object" ? entry.options : {}),
      pitch: Number(entry.pitch),
      pianoRoll: 1
    };
    appendNote({
      bar,
      step,
      velocity,
      options,
      live: true,
      liveId: String(entry.id || ""),
      source: entry
    });
  });
  return notes;
}

function rowInfoForTrack(trackId, rowsById) {
  return rowsById.get(trackId) || {
    id: trackId,
    label: trackId,
    type: "generated",
    accent: DEFAULT_ACCENT
  };
}

const clampNumber = (value, min, max, fallback = 0) => {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
};

function pitchRowsForLaneHeight(height) {
  const maxRows = PITCH_OFFSET_MAX - PITCH_OFFSET_MIN + 1;
  const visibleRows = Math.ceil(clampNumber(height, MIN_LANE_HEIGHT, MAX_LANE_HEIGHT, DEFAULT_LANE_HEIGHT) / PITCH_ROW_HEIGHT);
  return Math.max(1, Math.min(maxRows, visibleRows));
}

const normalizePitchWindowMin = (value, fallback = DEFAULT_PITCH_WINDOW_MIN, pitchRows = PITCH_WINDOW_ROWS) => {
  const maxMin = PITCH_OFFSET_MAX - Math.max(1, pitchRows) + 1;
  return Math.round(clampNumber(value, PITCH_OFFSET_MIN, maxMin, fallback));
};

function pitchRangeForTrack(state, trackId, pitchRows = PITCH_WINDOW_ROWS) {
  const rows = Math.max(1, pitchRows);
  const min = normalizePitchWindowMin(state.config?.pianoRollPitchMins?.[trackId], DEFAULT_PITCH_WINDOW_MIN, rows);
  return { min, max: min + rows - 1 };
}

function setPitchRangeMin(state, trackId, min, pitchRows = PITCH_WINDOW_ROWS) {
  if (!state.config) return normalizePitchWindowMin(min, DEFAULT_PITCH_WINDOW_MIN, pitchRows);
  const next = normalizePitchWindowMin(min, DEFAULT_PITCH_WINDOW_MIN, pitchRows);
  state.config.pianoRollPitchMins = {
    ...(state.config.pianoRollPitchMins || {}),
    [trackId]: next
  };
  return next;
}

function setPitchRangeTop(state, trackId, topPitch, pitchRows = PITCH_WINDOW_ROWS) {
  const top = Math.round(Number(topPitch));
  if (!Number.isFinite(top)) {
    return normalizePitchWindowMin(state.config?.pianoRollPitchMins?.[trackId], DEFAULT_PITCH_WINDOW_MIN, pitchRows);
  }
  return setPitchRangeMin(state, trackId, top - Math.max(1, pitchRows) + 1, pitchRows);
}

export function centerPianoRollTrackOnPitch(state, trackId, pitch) {
  if (!state?.config || !trackId) return false;
  const targetPitch = Math.round(Number(pitch));
  if (!Number.isFinite(targetPitch)) return false;
  const pitchRows = pitchRowsForLaneHeight(laneHeightForTrack(state, trackId));
  const nextMin = normalizePitchWindowMin(
    targetPitch - Math.floor((pitchRows - 1) / 2),
    DEFAULT_PITCH_WINDOW_MIN,
    pitchRows
  );
  const currentMin = normalizePitchWindowMin(
    state.config?.pianoRollPitchMins?.[trackId],
    DEFAULT_PITCH_WINDOW_MIN,
    pitchRows
  );
  if (nextMin === currentMin) return false;
  state.config.pianoRollPitchMins = {
    ...(state.config.pianoRollPitchMins || {}),
    [trackId]: nextMin
  };
  return true;
}

const trackSnapStepSize = (state, trackId, baseStepsPerBar) => {
  if (!state.quantize?.enabled) return 0;
  const configured = state.config?.trackStepCounts?.[trackId];
  const stepsPerBar = clampNumber(configured ?? DEFAULT_TRACK_STEPS_PER_BAR, 1, 128, DEFAULT_TRACK_STEPS_PER_BAR);
  return baseStepsPerBar / Math.max(1, stepsPerBar);
};

const quantizedAbsStep = (state, trackId, absStep, totalSteps, baseStepsPerBar) => {
  const grid = trackSnapStepSize(state, trackId, baseStepsPerBar);
  const raw = clampNumber(absStep, 0, Math.max(0, totalSteps - 0.0001), 0);
  if (!(grid > 0)) return raw;
  const snapped = Math.round(raw / grid) * grid;
  return clampNumber(snapped, 0, Math.max(0, totalSteps - 0.0001), 0);
};

const noteLeftPercent = (note, renderedSegmentCount, baseStepsPerBar) =>
  (((note.viewBar ?? note.bar) + note.step / baseStepsPerBar) / Math.max(1, renderedSegmentCount)) * 100;

const noteDurationSteps = (note) =>
  clampNumber(note.options?.durationSteps ?? note.options?.duration ?? 1, 0.25, 64, 1);

const noteWidthPercent = (note, renderedSegmentCount, baseStepsPerBar) =>
  Math.max(0.65, (noteDurationSteps(note) / baseStepsPerBar / Math.max(1, renderedSegmentCount)) * 100);

const absStepForNote = (note, baseStepsPerBar) =>
  (note.viewBar ?? note.bar) * baseStepsPerBar + note.rootStep;

const positionFromAbsStep = (absStep, renderedSegmentCount, baseStepsPerBar, normalizeStepPosition, viewStartBar = 0) => {
  const totalSteps = Math.max(1, renderedSegmentCount * baseStepsPerBar);
  const nextAbs = clampNumber(absStep, 0, Math.max(0, totalSteps - 0.0001), 0);
  const viewBar = Math.max(0, Math.min(renderedSegmentCount - 1, Math.floor(nextAbs / baseStepsPerBar)));
  return {
    absStep: nextAbs,
    bar: Math.max(0, Math.round(Number(viewStartBar) || 0)) + viewBar,
    viewBar,
    step: normalizeStepPosition(nextAbs % baseStepsPerBar)
  };
};

function laneHeightForTrack(state, trackId) {
  const height = state.config?.pianoRollLaneHeights?.[trackId];
  return Math.round(clampNumber(height, MIN_LANE_HEIGHT, MAX_LANE_HEIGHT, DEFAULT_LANE_HEIGHT));
}

function setLaneHeight(state, trackId, height) {
  state.config.pianoRollLaneHeights = {
    ...(state.config.pianoRollLaneHeights || {}),
    [trackId]: Math.round(clampNumber(height, MIN_LANE_HEIGHT, MAX_LANE_HEIGHT, DEFAULT_LANE_HEIGHT))
  };
}

export function pitchWheelDelta(event, carry = 0) {
  const rawDelta = Number(event?.deltaY) || 0;
  if (Math.abs(rawDelta) < 0.01) return { rows: 0, carry };
  const deltaMode = Number(event?.deltaMode) || 0;
  const pixels = rawDelta * (deltaMode === 1 ? 16 : deltaMode === 2 ? 120 : 1);
  const direction = pixels < 0 ? 1 : -1;
  if (event?.shiftKey) return { rows: direction * PITCH_WINDOW_ROWS, carry: 0 };

  const nextCarry = carry + pixels;
  const rawRows = Math.trunc(nextCarry / PITCH_WHEEL_PIXEL_THRESHOLD);
  if (!rawRows) return { rows: 0, carry: nextCarry };
  const rowSteps = clampNumber(rawRows, -PITCH_WHEEL_MAX_ROWS_PER_EVENT, PITCH_WHEEL_MAX_ROWS_PER_EVENT, 0);
  return {
    rows: -rowSteps,
    carry: nextCarry - rowSteps * PITCH_WHEEL_PIXEL_THRESHOLD
  };
}

function positionForPointer({ event, noteArea, min, max, renderedSegmentCount, baseStepsPerBar, normalizeStepPosition, state, trackId, viewStartBar = 0 }) {
  const rect = noteArea.getBoundingClientRect();
  const x = clampNumber((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1, 0);
  const totalSteps = Math.max(1, renderedSegmentCount * baseStepsPerBar);
  const absStep = quantizedAbsStep(state, trackId, x * totalSteps, totalSteps, baseStepsPerBar);
  const viewBar = Math.max(0, Math.min(renderedSegmentCount - 1, Math.floor(absStep / baseStepsPerBar)));
  const bar = Math.max(0, Math.round(Number(viewStartBar) || 0)) + viewBar;
  const step = normalizeStepPosition(absStep % baseStepsPerBar);
  const pitchRows = Math.max(1, max - min + 1);
  const row = clampNumber(Math.floor((event.clientY - rect.top) / PITCH_ROW_HEIGHT), 0, pitchRows - 1, 0);
  const pitch = Math.max(min, Math.min(max, max - row));
  return { absStep, bar, viewBar, step, pitch };
}

function readPianoRollSlot(state, trackId, barIndex, step, normalizeStepPosition) {
  const row = state.config?.patterns?.jazz?.bars?.[barIndex]?.[trackId];
  if (!Array.isArray(row)) return null;
  const normalizedStep = normalizeStepPosition(step);
  for (const entry of row) {
    if (!Array.isArray(entry)) continue;
    const entryStep = normalizeStepPosition(entry[0]);
    if (Math.abs(entryStep - normalizedStep) > 0.0001) continue;
    const velocity = Number(entry[1]);
    const options = entry[2] && typeof entry[2] === "object" ? entry[2] : {};
    return { step: entryStep, velocity, options };
  }
  return null;
}

function movePositionForPointer({ event, noteArea, min, max, renderedSegmentCount, baseStepsPerBar, normalizeStepPosition, drag, state, trackId, viewStartBar = 0 }) {
  const pointer = positionForPointer({
    event,
    noteArea,
    min,
    max,
    renderedSegmentCount,
    baseStepsPerBar,
    normalizeStepPosition,
    state,
    trackId,
    viewStartBar
  });
  const startAbs = absStepForNote(drag.note, baseStepsPerBar);
  const nextAbs = startAbs + pointer.absStep - drag.startPointer.absStep;
  const time = positionFromAbsStep(nextAbs, renderedSegmentCount, baseStepsPerBar, normalizeStepPosition, viewStartBar);
  return {
    bar: time.bar,
    viewBar: time.viewBar,
    step: time.step,
    pitch: Math.max(min, Math.min(max, drag.note.pitch + pointer.pitch - drag.startPointer.pitch))
  };
}

function updateNotePositionPreview(noteEl, position, note, min, max, renderedSegmentCount, baseStepsPerBar) {
  const viewBar = position.viewBar ?? position.bar;
  noteEl.style.left = `${((viewBar + position.step / baseStepsPerBar) / Math.max(1, renderedSegmentCount)) * 100}%`;
  noteEl.style.top = `${(max - position.pitch) * PITCH_ROW_HEIGHT}px`;
  if (position.durationSteps) {
    noteEl.style.width = `${Math.max(0.65, (position.durationSteps / baseStepsPerBar / Math.max(1, renderedSegmentCount)) * 100)}%`;
  }
  noteEl.dataset.previewBar = String(position.bar);
  noteEl.dataset.previewStep = String(position.step);
  noteEl.dataset.previewPitch = String(position.pitch);
  noteEl.setAttribute("aria-label", `${note.trackLabel} moving to bar ${position.bar + 1} step ${Math.floor(position.step) + 1}`);
}

function appendPitchGrid(noteArea, pitchRows) {
  const grid = document.createElement("div");
  grid.className = "piano-roll-pitch-lines";
  for (let index = 0; index <= pitchRows; index += 1) {
    const line = document.createElement("span");
    line.className = "piano-roll-pitch-line";
    line.style.top = `${index * PITCH_ROW_HEIGHT}px`;
    grid.appendChild(line);
  }
  noteArea.appendChild(grid);
}

function appendPitchLabelOverlay(noteArea, { notes, min, max, pitchRows, noteNameForPitch, formatPitch }) {
  const overlay = document.createElement("div");
  overlay.className = "piano-roll-pitch-overlay";
  const notePitches = new Set(notes.map((note) => note.pitch));
  const rowHeight = PITCH_ROW_HEIGHT;
  for (let pitch = max; pitch >= min; pitch -= 1) {
    const name = noteNameForPitch(pitch);
    const show = rowHeight >= 16
      || notePitches.has(pitch)
      || pitch === 0
      || /^C-?\d+$/.test(name);
    if (!show) continue;
    const item = document.createElement("span");
    item.className = `piano-roll-pitch-label ${notePitches.has(pitch) ? "is-note-row" : ""}`;
    item.style.top = `${(max - pitch + 0.5) * PITCH_ROW_HEIGHT}px`;
    item.textContent = name;
    item.title = `${name} ${formatPitch(pitch)}`;
    overlay.appendChild(item);
  }
  noteArea.appendChild(overlay);
}

function pitchStyleForNote(note, { min, max, renderedSegmentCount, baseStepsPerBar }) {
  if (note.pitch < min || note.pitch > max) return null;
  return {
    left: `${noteLeftPercent(note, renderedSegmentCount, baseStepsPerBar)}%`,
    width: `${noteWidthPercent(note, renderedSegmentCount, baseStepsPerBar)}%`,
    top: `${(max - note.pitch) * PITCH_ROW_HEIGHT}px`,
    height: `${Math.max(3.5, PITCH_ROW_HEIGHT * 0.82)}px`
  };
}

function noteDomKey(note) {
  return [
    Math.max(0, Math.round(Number(note.bar) || 0)),
    Number(note.rootStep ?? note.step).toFixed(4),
    Math.round(Number(note.pitch) || 0),
    Math.round(Number(note.interval) || 0)
  ].join(":");
}

function applyNoteElementDataset(noteEl, note, { noteNameForPitch, formatPitch } = {}) {
  noteEl.dataset.pitch = String(note.pitch);
  noteEl.dataset.bar = String(note.bar);
  noteEl.dataset.step = String(note.step);
  noteEl.dataset.rootStep = String(note.rootStep ?? note.step);
  noteEl.dataset.interval = String(note.interval ?? 0);
  noteEl.dataset.noteKey = noteDomKey(note);
  if (note.liveId) noteEl.dataset.liveId = String(note.liveId);
  if (typeof noteNameForPitch === "function" && typeof formatPitch === "function") {
    noteEl.dataset.noteLabel = `${noteNameForPitch(note.pitch)} ${formatPitch(note.pitch)}`;
  }
  noteEl.style.setProperty("--level", String(Math.max(0.22, Math.min(1, note.velocity / 0.9))));
}

function applyNoteElementStyle(noteEl, note, range, renderedSegmentCount, baseStepsPerBar) {
  const style = pitchStyleForNote(note, { ...range, renderedSegmentCount, baseStepsPerBar });
  if (!style) {
    noteEl.style.display = "none";
    return false;
  }
  noteEl.style.display = "";
  noteEl.style.left = style.left;
  noteEl.style.width = style.width;
  noteEl.style.top = style.top;
  noteEl.style.height = style.height;
  return true;
}

function applyNoteElementPitchWindow(noteEl, range) {
  const pitch = Math.round(Number(noteEl.dataset.pitch));
  if (!Number.isFinite(pitch) || pitch < range.min || pitch > range.max) {
    noteEl.style.display = "none";
    return false;
  }
  noteEl.style.display = "";
  noteEl.style.top = `${(range.max - pitch) * PITCH_ROW_HEIGHT}px`;
  noteEl.style.height = `${Math.max(3.5, PITCH_ROW_HEIGHT * 0.82)}px`;
  return true;
}

function syncRecordedNoteElements(noteArea, notes, range, renderedSegmentCount, baseStepsPerBar) {
  const notesByKey = new Map();
  notes.filter((note) => !note.live).forEach((note) => {
    notesByKey.set(noteDomKey(note), note);
  });
  noteArea.querySelectorAll(".piano-roll-note:not(.is-live)").forEach((noteEl) => {
    const note = notesByKey.get(noteEl.dataset.noteKey || "");
    if (!note) return;
    applyNoteElementStyle(noteEl, note, range, renderedSegmentCount, baseStepsPerBar);
    noteEl.style.setProperty("--level", String(Math.max(0.22, Math.min(1, note.velocity / 0.9))));
  });
}

function repaintPitchWindow({ lane, noteArea, state, trackId, notes, height, noteNameForPitch, formatPitch }) {
  const nextPitchRows = pitchRowsForLaneHeight(height);
  const range = pitchRangeForTrack(state, trackId, nextPitchRows);
  lane.style.setProperty("--pitch-rows", String(nextPitchRows));
  lane.dataset.pitchRows = String(nextPitchRows);
  lane.dataset.pitchMin = String(range.min);
  lane.dataset.pitchMax = String(range.max);
  noteArea.querySelector(".piano-roll-pitch-lines")?.remove();
  noteArea.querySelector(".piano-roll-pitch-overlay")?.remove();
  appendPitchGrid(noteArea, nextPitchRows);
  appendPitchLabelOverlay(noteArea, {
    notes,
    min: range.min,
    max: range.max,
    pitchRows: nextPitchRows,
    noteNameForPitch,
    formatPitch
  });
  return { ...range, pitchRows: nextPitchRows };
}

export function refreshLivePianoRollNotes({
  state,
  stepGrid,
  renderedSegmentCount,
  viewStartBar = 0,
  baseStepsPerBar,
  normalizeStepPosition,
  noteNameForPitch,
  formatPitch
}) {
  if (!stepGrid) return 0;
  let rendered = 0;
  openPianoRollTrackIds(state).forEach((trackId) => {
    const lane = stepGrid.querySelector(`.piano-roll-lane[data-hit="${escapeSelectorValue(trackId)}"]`);
    const noteArea = lane?.querySelector?.(".piano-roll-note-area");
    if (!lane || !noteArea) return;
    const laneHeight = laneHeightForTrack(state, trackId);
    const allNotes = notesForTrack({
      state,
      trackId,
      renderedSegmentCount,
      normalizeStepPosition,
      baseStepsPerBar,
      viewStartBar
    });
    const nextPitchRows = pitchRowsForLaneHeight(laneHeight);
    const nextRange = pitchRangeForTrack(state, trackId, nextPitchRows);
    const cachedPitchRows = Number(lane.dataset.pitchRows);
    const cachedPitchMin = Number(lane.dataset.pitchMin);
    const range = cachedPitchRows === nextPitchRows && cachedPitchMin === nextRange.min
      ? { ...nextRange, pitchRows: nextPitchRows }
      : repaintPitchWindow({
          lane,
          noteArea,
          state,
          trackId,
          notes: allNotes,
          height: laneHeight,
          noteNameForPitch,
          formatPitch
        });
    syncRecordedNoteElements(noteArea, allNotes, range, renderedSegmentCount, baseStepsPerBar);
    noteArea.querySelectorAll(".piano-roll-note.is-live").forEach((node) => node.remove());
    allNotes.filter((note) => note.live).forEach((note) => {
      const style = pitchStyleForNote(note, { ...range, renderedSegmentCount, baseStepsPerBar });
      if (!style) return;
      const noteEl = document.createElement("button");
      noteEl.type = "button";
      noteEl.className = `piano-roll-note ${note.interval === 0 ? "is-root" : "is-chord"} is-live`;
      noteEl.tabIndex = -1;
      applyNoteElementDataset(noteEl, note, { noteNameForPitch, formatPitch });
      applyNoteElementStyle(noteEl, note, range, renderedSegmentCount, baseStepsPerBar);
      noteEl.setAttribute("aria-label", `${noteEl.dataset.noteLabel} · live MIDI`);
      noteArea.appendChild(noteEl);
      rendered += 1;
    });
  });
  return rendered;
}

export function appendPianoRollLanes({
  state,
  stepGrid,
  rows,
  startRow,
  renderedSegmentCount,
  viewStartBar = 0,
  baseStepsPerBar,
  makeTrackLabel,
  normalizeStepPosition,
  setHitData,
  selectStep,
  renderStepGrid,
  refreshPianoRollLanes = null,
  noteNameForPitch,
  formatPitch,
  editorLaneGridRow = null,
  setStatus,
  showContextMenu = null
}) {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const ids = openPianoRollTrackIds(state).filter((id) => rowsById.has(id));

	ids.forEach((trackId, index) => {
	    const row = rowInfoForTrack(trackId, rowsById);
	    const laneHeight = laneHeightForTrack(state, row.id);
	    const laneKey = `piano:${row.id}`;
	    const automationActive = state.activeAutomationLaneKey === laneKey;
	    const automationParam = state.config?.trackAutomationParams?.[laneKey] || state.pianoRollAutomationParam;
	    const notes = notesForTrack({
      state,
      trackId: row.id,
      renderedSegmentCount,
      normalizeStepPosition,
      baseStepsPerBar,
      viewStartBar
    });
    const pitchRows = pitchRowsForLaneHeight(laneHeight);
    const { min, max } = pitchRangeForTrack(state, row.id, pitchRows);
    const gridRow = String(editorLaneGridRow?.("piano", row.id, index) ?? (startRow + index));
	    const label = makeTrackLabel(row.id, row.label, row.type, row.accent, "piano");
	    label.classList.add("piano-roll-lane-label");
	    label.classList.toggle("is-automation-active", automationActive);
    label.dataset.laneKey = `piano:${row.id}`;
    label.style.gridColumn = "1";
    label.style.gridRow = gridRow;
    label.style.minHeight = `${laneHeight}px`;
    label.style.height = `${laneHeight}px`;
    label.style.setProperty("--lane-height", `${laneHeight}px`);
    stepGrid.appendChild(label);

    const lane = document.createElement("div");
    lane.className = "piano-roll-lane";
    lane.dataset.hit = row.id;
    lane.dataset.pitchRows = String(pitchRows);
    lane.dataset.pitchMin = String(min);
    lane.dataset.pitchMax = String(max);
    lane.style.gridColumn = "2 / -1";
    lane.style.gridRow = gridRow;
    lane.style.height = `${laneHeight}px`;
    lane.style.setProperty("--track-accent", row.accent || DEFAULT_ACCENT);
	    lane.style.setProperty("--pitch-rows", String(pitchRows));
	    lane.style.setProperty("--pitch-row-height", `${PITCH_ROW_HEIGHT}px`);
	    lane.style.setProperty("--bar-count", String(renderedSegmentCount));
	    lane.style.setProperty("--lane-height", `${laneHeight}px`);
	    lane.classList.toggle("is-automation-active", automationActive);

    const noteArea = document.createElement("div");
    noteArea.className = "piano-roll-note-area";
    lane.appendChild(noteArea);
    appendPitchGrid(noteArea, pitchRows);
    appendPitchLabelOverlay(noteArea, {
      notes,
      min,
      max,
      pitchRows,
      noteNameForPitch,
      formatPitch
    });

    if (!notes.length) {
      const empty = document.createElement("div");
      empty.className = "piano-roll-empty";
      lane.appendChild(empty);
    }

    const refreshLane = () => {
      if (typeof refreshPianoRollLanes === "function") refreshPianoRollLanes();
      else renderStepGrid();
    };

    const scrollPitchWindow = (direction) => {
      const current = pitchRangeForTrack(state, row.id, pitchRows);
      const nextMin = setPitchRangeMin(state, row.id, current.min + direction, pitchRows);
      const nextMax = nextMin + pitchRows - 1;
      setStatus?.(`${row.label} octave ${noteNameForPitch(nextMin)}-${noteNameForPitch(nextMax)}`);
      const range = repaintPitchWindow({
        lane,
        noteArea,
        state,
        trackId: row.id,
        notes,
        height: laneHeightForTrack(state, row.id),
        noteNameForPitch,
        formatPitch
      });
      noteArea.querySelectorAll(".piano-roll-note[data-pitch]").forEach((noteEl) => {
        applyNoteElementPitchWindow(noteEl, range);
      });
    };

    const paintPitchWindowForHeight = (height) => {
      const nextPitchRows = pitchRowsForLaneHeight(height);
      const currentTop = Number(lane.dataset.pitchMax);
      if (Number.isFinite(currentTop)) {
        setPitchRangeTop(state, row.id, currentTop, nextPitchRows);
      }
      const range = repaintPitchWindow({
        lane,
        noteArea,
        state,
        trackId: row.id,
        notes,
        height,
        noteNameForPitch,
        formatPitch
      });
      noteArea.querySelectorAll(".piano-roll-note[data-pitch]").forEach((noteEl) => {
        applyNoteElementPitchWindow(noteEl, range);
      });
    };

    const clampStepGridScroll = () => {
      if (!stepGrid) return;
      const maxScrollTop = Math.max(0, stepGrid.scrollHeight - stepGrid.clientHeight);
      stepGrid.scrollTop = clampNumber(stepGrid.scrollTop, 0, maxScrollTop, 0);
    };

    const syncLaneStack = () => {
      syncStepGridLaneRows(stepGrid);
      clampStepGridScroll();
    };

    const applyLaneHeight = (height) => {
      const nextHeight = Math.round(clampNumber(height, MIN_LANE_HEIGHT, MAX_LANE_HEIGHT, DEFAULT_LANE_HEIGHT));
      lane.style.height = `${nextHeight}px`;
      lane.style.setProperty("--lane-height", `${nextHeight}px`);
      label.style.minHeight = `${nextHeight}px`;
      label.style.height = `${nextHeight}px`;
      label.style.setProperty("--lane-height", `${nextHeight}px`);
      paintPitchWindowForHeight(nextHeight);
      syncLaneStack();
      return nextHeight;
    };

    noteArea.addEventListener("wheel", (event) => {
      if (Math.abs(event.deltaY) < 0.01) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = pitchWheelDelta(event, Number(lane.dataset.pitchWheelCarry) || 0);
      lane.dataset.pitchWheelCarry = String(delta.carry);
      if (delta.rows) scrollPitchWindow(delta.rows);
    }, { passive: false });

    const historyPatch = (kind, label) => {
      const historyGroupKey = `piano-roll:${row.id}:${kind}:${++editSerial}`;
      return {
        historyGroupKey,
        historyLabel: `${row.label} ${label}`,
        historyField: `piano-roll-${kind}`
      };
    };

    const removeIndividualNote = (note, history) => {
      const remainingOptions = optionsWithoutPianoRollNote(note);
      if (remainingOptions) {
        setHitData(row.id, note.rootStep, { velocity: note.velocity, options: remainingOptions, ...history }, note.bar);
      } else {
        setHitData(row.id, note.rootStep, { velocity: 0, ...history }, note.bar);
      }
    };

    const addIndividualNote = (note, position, history) => {
      const current = readPianoRollSlot(state, row.id, position.bar, position.step, normalizeStepPosition);
      const durationSteps = clampNumber(position.durationSteps ?? noteDurationSteps(note), 0.25, 64, noteDurationSteps(note));
      const templateOptions = {
        ...(current?.options || note.options || {}),
        durationSteps,
        pianoRoll: 1
      };
      const baseOptions = current?.velocity > 0.005
        ? current.options
        : { ...note.options, pitch: position.pitch, chordIntervals: [0], durationSteps, pianoRoll: 1 };
      const nextOptions = optionsWithPianoRollNote(baseOptions, position.pitch, templateOptions);
      if (!nextOptions) return;
      setHitData(row.id, position.step, {
        velocity: Math.max(note.velocity, Number(current?.velocity) || 0),
        options: nextOptions,
        ...history
      }, position.bar);
    };

    const moveNote = (note, position) => {
      if (typeof setHitData !== "function") return;
      const history = historyPatch("move", "note move");
      removeIndividualNote(note, history);
      addIndividualNote(note, {
        ...position,
        durationSteps: noteDurationSteps(note)
      }, history);
      selectStep(row.id, position.step, "step", position.bar, state.intensity, row.type === "generated", {
        previewVelocity: note.velocity
      });
      setStatus?.(`${row.label} moved to ${noteNameForPitch(position.pitch)} ${formatPitch(position.pitch)} · bar ${position.bar + 1} step ${Math.floor(position.step) + 1}`);
      refreshLane();
    };

    const resizeNote = (note, position) => {
      if (typeof setHitData !== "function") return;
      const history = historyPatch("resize", "note length");
      removeIndividualNote(note, history);
      addIndividualNote(note, {
        ...position,
        pitch: note.pitch,
        durationSteps: clampNumber(position.durationSteps, 0.25, 64, noteDurationSteps(note))
      }, history);
      selectStep(row.id, position.step, "step", position.bar, state.intensity, row.type === "generated", {
        previewVelocity: note.velocity
      });
      setStatus?.(`${row.label} note length ${clampNumber(position.durationSteps, 0.25, 64, noteDurationSteps(note)).toFixed(2)} steps`);
      refreshLane();
    };

    const deleteNote = (note) => {
      if (typeof setHitData !== "function") return;
      const history = historyPatch("delete", "note delete");
      removeIndividualNote(note, history);
      setStatus?.(`${row.label} deleted ${noteNameForPitch(note.pitch)} ${formatPitch(note.pitch)}`);
      refreshLane();
    };

    notes.forEach((note) => {
      const noteEl = document.createElement("button");
      noteEl.type = "button";
      noteEl.className = `piano-roll-note ${note.interval === 0 ? "is-root" : "is-chord"}`;
      if (note.live) noteEl.classList.add("is-live");
      note.trackLabel = row.label;
      const left = noteLeftPercent(note, renderedSegmentCount, baseStepsPerBar);
      const width = noteWidthPercent(note, renderedSegmentCount, baseStepsPerBar);
      const top = (max - note.pitch) * PITCH_ROW_HEIGHT;
      const height = Math.max(3.5, PITCH_ROW_HEIGHT * 0.82);
      noteEl.style.left = `${left}%`;
      noteEl.style.width = `${width}%`;
      noteEl.style.top = `${top}px`;
      noteEl.style.height = `${height}px`;
      applyNoteElementDataset(noteEl, note, { noteNameForPitch, formatPitch });
      noteEl.title = `${row.label} ${noteNameForPitch(note.pitch)} ${formatPitch(note.pitch)} · bar ${note.bar + 1} step ${Math.floor(note.step) + 1} · ${noteDurationSteps(note).toFixed(2)} steps`;
      noteEl.setAttribute("aria-label", noteEl.title);
      if (note.live) {
        noteEl.tabIndex = -1;
        noteEl.setAttribute("aria-label", `${noteEl.title} · live MIDI`);
        noteArea.appendChild(noteEl);
        return;
      }
      ["left", "right"].forEach((side) => {
        const handle = document.createElement("span");
        handle.className = `piano-roll-note-resize piano-roll-note-resize--${side}`;
        handle.dataset.resizeSide = side;
        handle.setAttribute("aria-hidden", "true");
        noteEl.appendChild(handle);
      });
      let drag = null;
      noteEl.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        const resizeSide = event.target?.dataset?.resizeSide;
        event.preventDefault();
        event.stopPropagation();
        noteEl.focus?.({ preventScroll: true });
        const startPointer = positionForPointer({
          event,
          noteArea,
          min,
          max,
          renderedSegmentCount,
          baseStepsPerBar,
          normalizeStepPosition,
          state,
          trackId: row.id,
          viewStartBar
        });
        drag = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          mode: resizeSide ? `resize-${resizeSide}` : "move",
          note,
          startPointer,
          startAbs: absStepForNote(note, baseStepsPerBar),
          startDuration: noteDurationSteps(note),
          position: { bar: note.bar, step: note.rootStep, pitch: note.pitch, durationSteps: noteDurationSteps(note) }
        };
        noteEl.setPointerCapture?.(event.pointerId);
        noteEl.classList.add("is-drag-ready");
      });
      noteEl.addEventListener("pointermove", (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (distance > 3) drag.moved = true;
        if (!drag.moved) return;
        const pointer = positionForPointer({
          event,
          noteArea,
          min,
          max,
          renderedSegmentCount,
          baseStepsPerBar,
          normalizeStepPosition,
          state,
          trackId: row.id,
          viewStartBar
        });
        let position;
        if (drag.mode === "resize-left") {
          const endAbs = drag.startAbs + drag.startDuration;
          const nextAbs = clampNumber(pointer.absStep, 0, endAbs - 0.25, drag.startAbs);
          const time = positionFromAbsStep(nextAbs, renderedSegmentCount, baseStepsPerBar, normalizeStepPosition, viewStartBar);
          position = {
            bar: time.bar,
            viewBar: time.viewBar,
            step: time.step,
            pitch: note.pitch,
            durationSteps: clampNumber(endAbs - nextAbs, 0.25, 64, drag.startDuration)
          };
        } else if (drag.mode === "resize-right") {
          const totalSteps = Math.max(1, renderedSegmentCount * baseStepsPerBar);
          position = {
            bar: note.bar,
            viewBar: note.viewBar,
            step: note.rootStep,
            pitch: note.pitch,
            durationSteps: clampNumber(pointer.absStep - drag.startAbs + 1, 0.25, totalSteps - drag.startAbs, drag.startDuration)
          };
        } else {
          position = movePositionForPointer({
            event,
            noteArea,
            min,
            max,
            renderedSegmentCount,
            baseStepsPerBar,
            normalizeStepPosition,
            drag,
            state,
            trackId: row.id,
            viewStartBar
          });
        }
        drag.position = position;
        noteEl.classList.add("is-dragging");
        updateNotePositionPreview(noteEl, position, note, min, max, renderedSegmentCount, baseStepsPerBar);
        event.preventDefault();
      });
      const finishDrag = (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        noteEl.releasePointerCapture?.(event.pointerId);
        noteEl.classList.remove("is-drag-ready", "is-dragging");
        const finalDrag = drag;
        drag = null;
        if (finalDrag.moved) {
          if (finalDrag.mode.startsWith("resize-")) resizeNote(note, finalDrag.position);
          else moveNote(note, finalDrag.position);
          event.preventDefault();
          return;
        }
        selectStep(row.id, note.rootStep, "step", note.bar, state.intensity, row.type === "generated", {
          previewVelocity: note.velocity
        });
        renderStepGrid();
      };
      noteEl.addEventListener("pointerup", finishDrag);
      noteEl.addEventListener("pointercancel", (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        noteEl.releasePointerCapture?.(event.pointerId);
        noteEl.classList.remove("is-drag-ready", "is-dragging");
        drag = null;
      });
      noteEl.addEventListener("keydown", (event) => {
        if (event.key !== "Delete" && event.key !== "Backspace") return;
        event.preventDefault();
        event.stopPropagation();
        deleteNote(note);
      });
      noteEl.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        noteEl.focus?.({ preventScroll: true });
        if (typeof showContextMenu === "function") {
          showContextMenu(event, [
            { label: `Delete ${noteNameForPitch(note.pitch)}`, action: () => deleteNote(note) }
          ]);
        } else {
          deleteNote(note);
        }
      });
      noteArea.appendChild(noteEl);
    });

	    if (automationActive) {
	      const automationLane = createAutomationLane({
	        notes,
	        row,
	        state,
	        renderedSegmentCount,
	        baseStepsPerBar,
	        viewStartBar,
	        normalizeStepPosition,
	        setHitData,
	        selectStep,
	        renderStepGrid,
	        setStatus,
	        parameterId: automationParam
	      });
	      lane.appendChild(automationLane);
	    }

    const wireResizeHandle = (resizeHandle, edge = "bottom") => {
      resizeHandle.title = "Drag to resize piano roll";
      resizeHandle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const startY = event.clientY;
        const startHeight = laneHeightForTrack(state, row.id);
        let lastHeight = startHeight;
        resizeHandle.setPointerCapture?.(event.pointerId);
        const onMove = (moveEvent) => {
          const delta = edge === "top" ? startY - moveEvent.clientY : moveEvent.clientY - startY;
          const nextHeight = Math.round(clampNumber(startHeight + delta, MIN_LANE_HEIGHT, MAX_LANE_HEIGHT, startHeight));
          if (edge === "top") {
            stepGrid.scrollTop += nextHeight - lastHeight;
            lastHeight = nextHeight;
          }
          applyLaneHeight(nextHeight);
          moveEvent.preventDefault();
        };
        const onUp = (upEvent) => {
          const delta = edge === "top" ? startY - upEvent.clientY : upEvent.clientY - startY;
          const nextHeight = Math.round(clampNumber(startHeight + delta, MIN_LANE_HEIGHT, MAX_LANE_HEIGHT, startHeight));
          resizeHandle.releasePointerCapture?.(event.pointerId);
          resizeHandle.removeEventListener("pointermove", onMove);
          resizeHandle.removeEventListener("pointerup", onUp);
          resizeHandle.removeEventListener("pointercancel", onUp);
          const appliedHeight = applyLaneHeight(nextHeight);
          setLaneHeight(state, row.id, appliedHeight);
          setStatus?.(`${row.label} piano roll height ${appliedHeight}px`);
          renderStepGrid();
          globalThis.requestAnimationFrame?.(syncLaneStack);
          upEvent.preventDefault();
        };
        resizeHandle.addEventListener("pointermove", onMove);
        resizeHandle.addEventListener("pointerup", onUp);
        resizeHandle.addEventListener("pointercancel", onUp);
      });
    };
    ["top", "bottom"].forEach((edge) => {
      const labelResizeHandle = document.createElement("div");
      labelResizeHandle.className = `piano-roll-resize-handle piano-roll-resize-handle--${edge}`;
      wireResizeHandle(labelResizeHandle, edge);
      label.appendChild(labelResizeHandle);
      const laneResizeHandle = document.createElement("div");
      laneResizeHandle.className = `piano-roll-resize-handle piano-roll-resize-handle--lane piano-roll-resize-handle--${edge}`;
      wireResizeHandle(laneResizeHandle, edge);
      lane.appendChild(laneResizeHandle);
    });
    stepGrid.appendChild(lane);
  });

  return ids.length;
}
