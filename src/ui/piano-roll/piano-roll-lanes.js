// Piano-roll lane renderer.
//
// This module owns the MIDI-style note-bar layout that can sit below the main
// grid. The step-grid builder decides where the lanes are mounted; this file
// decides how opened piano-roll instruments are drawn.

import { createAutomationLane } from "./automation/automation-lane.js";
import { PITCH_OFFSET_MAX, PITCH_OFFSET_MIN } from "../../audio/rhythm-config.js";

const DEFAULT_ACCENT = "#c4b5fd";
const DEFAULT_LANE_HEIGHT = 58;
const MIN_LANE_HEIGHT = 40;
const MAX_LANE_HEIGHT = 1600;
let editSerial = 0;

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

function pitchRange(notes) {
  if (!notes.length) return { min: -12, max: 12 };
  let min = Math.min(...notes.map((note) => note.pitch));
  let max = Math.max(...notes.map((note) => note.pitch));
  min = Math.max(PITCH_OFFSET_MIN, min - 3);
  max = Math.min(PITCH_OFFSET_MAX, max + 3);
  while (max - min < 12) {
    if (min > PITCH_OFFSET_MIN) min -= 1;
    if (max - min >= 12) break;
    if (max < PITCH_OFFSET_MAX) max += 1;
    else break;
  }
  return { min, max };
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

const parseQuantizeValue = (value) => {
  if (typeof value === "string" && value.includes("/")) {
    const [top, bottom] = value.split("/").map(Number);
    if (Number.isFinite(top) && Number.isFinite(bottom) && bottom !== 0) return top / bottom;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const quantizeGridSteps = (state, baseStepsPerBar) => {
  const q = state.quantize || {};
  if (!q.enabled) return 0;
  const bars = parseQuantizeValue(q.value);
  return bars > 0 ? Math.max(0.0001, bars * baseStepsPerBar) : 0;
};

const quantizedAbsStep = (state, absStep, totalSteps, baseStepsPerBar) => {
  const grid = quantizeGridSteps(state, baseStepsPerBar);
  const raw = clampNumber(absStep, 0, Math.max(0, totalSteps - 0.0001), 0);
  const snapped = grid > 0 ? Math.round(raw / grid) * grid : raw;
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
  return clampNumber(height, MIN_LANE_HEIGHT, MAX_LANE_HEIGHT, DEFAULT_LANE_HEIGHT);
}

function setLaneHeight(state, trackId, height) {
  state.config.pianoRollLaneHeights = {
    ...(state.config.pianoRollLaneHeights || {}),
    [trackId]: clampNumber(height, MIN_LANE_HEIGHT, MAX_LANE_HEIGHT, DEFAULT_LANE_HEIGHT)
  };
}

function positionForPointer({ event, noteArea, min, max, renderedSegmentCount, baseStepsPerBar, normalizeStepPosition, state, viewStartBar = 0 }) {
  const rect = noteArea.getBoundingClientRect();
  const x = clampNumber((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1, 0);
  const y = clampNumber((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1, 0);
  const totalSteps = Math.max(1, renderedSegmentCount * baseStepsPerBar);
  const absStep = quantizedAbsStep(state, x * totalSteps, totalSteps, baseStepsPerBar);
  const viewBar = Math.max(0, Math.min(renderedSegmentCount - 1, Math.floor(absStep / baseStepsPerBar)));
  const bar = Math.max(0, Math.round(Number(viewStartBar) || 0)) + viewBar;
  const step = normalizeStepPosition(absStep % baseStepsPerBar);
  const pitchRows = Math.max(1, max - min + 1);
  const pitch = Math.max(min, Math.min(max, max - Math.round(y * (pitchRows - 1))));
  return { absStep, bar, viewBar, step, pitch };
}

function movePositionForPointer({ event, noteArea, min, max, renderedSegmentCount, baseStepsPerBar, normalizeStepPosition, drag, state, viewStartBar = 0 }) {
  const pointer = positionForPointer({
    event,
    noteArea,
    min,
    max,
    renderedSegmentCount,
    baseStepsPerBar,
    normalizeStepPosition,
    state,
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
  const pitchRows = Math.max(1, max - min + 1);
  const viewBar = position.viewBar ?? position.bar;
  noteEl.style.left = `${((viewBar + position.step / baseStepsPerBar) / Math.max(1, renderedSegmentCount)) * 100}%`;
  noteEl.style.top = `${((max - position.pitch) / pitchRows) * 100}%`;
  if (position.durationSteps) {
    noteEl.style.width = `${Math.max(0.65, (position.durationSteps / baseStepsPerBar / Math.max(1, renderedSegmentCount)) * 100)}%`;
  }
  noteEl.dataset.previewBar = String(position.bar);
  noteEl.dataset.previewStep = String(position.step);
  noteEl.dataset.previewPitch = String(position.pitch);
  noteEl.setAttribute("aria-label", `${note.trackLabel} moving to bar ${position.bar + 1} step ${Math.floor(position.step) + 1}`);
}

function appendPitchLabelOverlay(noteArea, { notes, min, max, pitchRows, noteNameForPitch, formatPitch }) {
  const overlay = document.createElement("div");
  overlay.className = "piano-roll-pitch-overlay";
  const notePitches = new Set(notes.map((note) => note.pitch));
  for (let pitch = max; pitch >= min; pitch -= 1) {
    const name = noteNameForPitch(pitch);
    const show = pitchRows <= 14
      || notePitches.has(pitch)
      || pitch === 0
      || /^C-?\d+$/.test(name);
    if (!show) continue;
    const item = document.createElement("span");
    item.className = `piano-roll-pitch-label ${notePitches.has(pitch) ? "is-note-row" : ""}`;
    item.style.top = `${((max - pitch + 0.5) / Math.max(1, pitchRows)) * 100}%`;
    item.textContent = name;
    item.title = `${name} ${formatPitch(pitch)}`;
    overlay.appendChild(item);
  }
  noteArea.appendChild(overlay);
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
  setStatus
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
    const { min, max } = pitchRange(notes);
    const pitchRows = Math.max(1, max - min + 1);
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
    lane.style.gridColumn = "2 / -1";
    lane.style.gridRow = gridRow;
    lane.style.height = `${laneHeight}px`;
    lane.style.setProperty("--track-accent", row.accent || DEFAULT_ACCENT);
	    lane.style.setProperty("--pitch-rows", String(pitchRows));
	    lane.style.setProperty("--bar-count", String(renderedSegmentCount));
	    lane.style.setProperty("--lane-height", `${laneHeight}px`);
	    lane.classList.toggle("is-automation-active", automationActive);

    const noteArea = document.createElement("div");
    noteArea.className = "piano-roll-note-area";
    lane.appendChild(noteArea);
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

    const moveNote = (note, position) => {
      if (typeof setHitData !== "function") return;
      const nextRootPitch = position.pitch - note.interval;
      const nextOptions = { ...note.options, pitch: nextRootPitch, pianoRoll: 1 };
      const sameSlot = note.bar === position.bar && Math.abs(note.rootStep - position.step) < 0.0001;
      const historyGroupKey = `piano-roll:${row.id}:move:${++editSerial}`;
      const history = {
        historyGroupKey,
        historyLabel: `${row.label} note move`,
        historyField: "piano-roll-move"
      };
      if (sameSlot) {
        setHitData(row.id, note.rootStep, { velocity: note.velocity, options: nextOptions, ...history }, note.bar);
      } else {
        setHitData(row.id, note.rootStep, { velocity: 0, ...history }, note.bar);
        setHitData(row.id, position.step, { velocity: note.velocity, options: nextOptions, ...history }, position.bar);
      }
      selectStep(row.id, position.step, "step", position.bar, state.intensity, row.type === "generated", {
        previewVelocity: note.velocity
      });
      setStatus?.(`${row.label} moved to ${noteNameForPitch(nextRootPitch)} ${formatPitch(nextRootPitch)} · bar ${position.bar + 1} step ${Math.floor(position.step) + 1}`);
      refreshLane();
    };

    const resizeNote = (note, position) => {
      if (typeof setHitData !== "function") return;
      const nextOptions = {
        ...note.options,
        pianoRoll: 1,
        durationSteps: clampNumber(position.durationSteps, 0.25, 64, noteDurationSteps(note))
      };
      const sameSlot = note.bar === position.bar && Math.abs(note.rootStep - position.step) < 0.0001;
      const historyGroupKey = `piano-roll:${row.id}:resize:${++editSerial}`;
      const history = {
        historyGroupKey,
        historyLabel: `${row.label} note length`,
        historyField: "piano-roll-resize"
      };
      if (sameSlot) {
        setHitData(row.id, note.rootStep, { velocity: note.velocity, options: nextOptions, ...history }, note.bar);
      } else {
        setHitData(row.id, note.rootStep, { velocity: 0, ...history }, note.bar);
        setHitData(row.id, position.step, { velocity: note.velocity, options: nextOptions, ...history }, position.bar);
      }
      selectStep(row.id, position.step, "step", position.bar, state.intensity, row.type === "generated", {
        previewVelocity: note.velocity
      });
      setStatus?.(`${row.label} note length ${nextOptions.durationSteps.toFixed(2)} steps`);
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
      const top = ((max - note.pitch) / pitchRows) * 100;
      const height = Math.max(3.5, (0.82 / pitchRows) * 100);
      noteEl.style.left = `${left}%`;
      noteEl.style.width = `${width}%`;
      noteEl.style.top = `${top}%`;
      noteEl.style.height = `${height}%`;
      noteEl.style.setProperty("--level", String(Math.max(0.22, Math.min(1, note.velocity / 0.9))));
      noteEl.dataset.noteLabel = `${noteNameForPitch(note.pitch)} ${formatPitch(note.pitch)}`;
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
        const startPointer = positionForPointer({
          event,
          noteArea,
          min,
          max,
          renderedSegmentCount,
          baseStepsPerBar,
          normalizeStepPosition,
          state,
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

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "piano-roll-resize-handle";
    resizeHandle.title = "Drag to resize piano roll";
    resizeHandle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const startY = event.clientY;
      const startHeight = laneHeightForTrack(state, row.id);
      resizeHandle.setPointerCapture?.(event.pointerId);
      const onMove = (moveEvent) => {
        const nextHeight = clampNumber(startHeight + moveEvent.clientY - startY, MIN_LANE_HEIGHT, MAX_LANE_HEIGHT, startHeight);
        lane.style.height = `${nextHeight}px`;
        lane.style.setProperty("--lane-height", `${nextHeight}px`);
        label.style.minHeight = `${nextHeight}px`;
        label.style.height = `${nextHeight}px`;
        label.style.setProperty("--lane-height", `${nextHeight}px`);
        moveEvent.preventDefault();
      };
      const onUp = (upEvent) => {
        const nextHeight = clampNumber(startHeight + upEvent.clientY - startY, MIN_LANE_HEIGHT, MAX_LANE_HEIGHT, startHeight);
        resizeHandle.releasePointerCapture?.(event.pointerId);
        resizeHandle.removeEventListener("pointermove", onMove);
        resizeHandle.removeEventListener("pointerup", onUp);
        resizeHandle.removeEventListener("pointercancel", onUp);
        setLaneHeight(state, row.id, nextHeight);
        setStatus?.(`${row.label} piano roll height ${Math.round(nextHeight)}px`);
        renderStepGrid();
        upEvent.preventDefault();
      };
      resizeHandle.addEventListener("pointermove", onMove);
      resizeHandle.addEventListener("pointerup", onUp);
      resizeHandle.addEventListener("pointercancel", onUp);
    });
    label.appendChild(resizeHandle);
    stepGrid.appendChild(lane);
  });

  return ids.length;
}
