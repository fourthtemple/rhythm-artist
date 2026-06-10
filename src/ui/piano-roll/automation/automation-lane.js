import {
  AUTOMATION_PARAMETERS,
  automationLevel,
  automationParameterById,
  clampAutomationValue,
  readAutomationValue
} from "../../automation/automation-parameters.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const clampNumber = (value, min, max, fallback = 0) => {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
};

const noteWidthPercent = (renderedSegmentCount, baseStepsPerBar) =>
  Math.max(0.65, (0.92 / baseStepsPerBar / Math.max(1, renderedSegmentCount)) * 100);

const noteLeftPercent = (note, renderedSegmentCount, baseStepsPerBar) =>
  (((note.viewBar ?? note.bar) + note.step / baseStepsPerBar) / Math.max(1, renderedSegmentCount)) * 100;

const anchorXPercent = (note, renderedSegmentCount, baseStepsPerBar) =>
  noteLeftPercent(note, renderedSegmentCount, baseStepsPerBar)
    + (noteWidthPercent(renderedSegmentCount, baseStepsPerBar) * 0.5);

function rootAutomationNotes(notes = []) {
  return notes
    .filter((note) => note.interval === 0)
    .sort((a, b) => (a.bar - b.bar) || (a.rootStep - b.rootStep));
}

function pointerToValue(event, lane, param) {
  const rect = lane.getBoundingClientRect();
  const y = clampNumber((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1, 0);
  return clampAutomationValue(param, param.min + (1 - y) * (param.max - param.min));
}

function pointerToTime(event, lane, renderedSegmentCount, baseStepsPerBar, normalizeStepPosition, viewStartBar = 0) {
  const rect = lane.getBoundingClientRect();
  const x = clampNumber((event.clientX - rect.left) / Math.max(1, rect.width), 0, 0.999999, 0);
  const totalSteps = Math.max(1, renderedSegmentCount * baseStepsPerBar);
  const absStep = Math.max(0, Math.min(totalSteps - 1, Math.round(x * totalSteps)));
  const viewBar = Math.max(0, Math.min(renderedSegmentCount - 1, Math.floor(absStep / baseStepsPerBar)));
  return {
    bar: Math.max(0, Math.round(Number(viewStartBar) || 0)) + viewBar,
    viewBar,
    step: normalizeStepPosition(absStep % baseStepsPerBar)
  };
}

function anchorYPercent(param, value) {
  return clampNumber(100 - automationLevel(param, value) * 100, 9, 91, 50);
}

function curvePoints(notes, param, preview, renderedSegmentCount, baseStepsPerBar) {
  if (!notes.length) return "";
  const points = notes.map((note) => {
    const previewing = preview
      && preview.bar === note.bar
      && Math.abs(Number(preview.step) - Number(note.rootStep)) < 0.0001;
    const value = previewing ? preview.value : readAutomationValue(note, param);
    return {
      x: anchorXPercent(note, renderedSegmentCount, baseStepsPerBar),
      y: anchorYPercent(param, value)
    };
  });
  const first = points[0];
  const last = points[points.length - 1];
  return [
    { x: 0, y: first.y },
    ...points,
    { x: 100, y: last.y }
  ].map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(" ");
}

function pitchForNewAnchor(rootNotes, state, row) {
  if (state.selected?.hit === row.id) {
    const selected = rootNotes.find((note) => (
      note.bar === state.selected.bar && Math.abs(note.rootStep - state.selected.step) < 0.0001
    ));
    if (selected) return selected.rootPitch;
  }
  return rootNotes[rootNotes.length - 1]?.rootPitch ?? 0;
}

function setAnchorVisual(anchor, note, param, value, renderedSegmentCount, baseStepsPerBar) {
  anchor.style.left = `${anchorXPercent(note, renderedSegmentCount, baseStepsPerBar)}%`;
  anchor.style.top = `${anchorYPercent(param, value)}%`;
  anchor.style.setProperty("--level", String(automationLevel(param, value)));
  anchor.dataset.value = param.display(value);
}

function titleForAnchor(row, note, param, value = readAutomationValue(note, param)) {
  return `${row.label} ${param.label} ${param.display(value)} · bar ${note.bar + 1} step ${Math.floor(note.rootStep) + 1}`;
}

export function createAutomationLane({
  notes,
  row,
  state,
  renderedSegmentCount,
  baseStepsPerBar,
  viewStartBar = 0,
  normalizeStepPosition,
  setHitData,
  selectStep,
  renderStepGrid,
  setStatus
}) {
  const rootNotes = rootAutomationNotes(notes);
  const param = automationParameterById(state.pianoRollAutomationParam);
  state.pianoRollAutomationParam = param.id;

  const wrap = document.createElement("div");
  wrap.className = "piano-roll-automation";

  const toolbar = document.createElement("div");
  toolbar.className = "piano-roll-automation-toolbar";
  const label = document.createElement("span");
  label.className = "piano-roll-automation-label";
  label.textContent = "Automation";
  const select = document.createElement("select");
  select.className = "piano-roll-automation-select";
  select.setAttribute("aria-label", "Automation parameter");
  AUTOMATION_PARAMETERS.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    option.selected = item.id === param.id;
    select.appendChild(option);
  });
  select.addEventListener("pointerdown", (event) => event.stopPropagation());
  select.addEventListener("change", () => {
    state.pianoRollAutomationParam = select.value;
    setStatus?.(`Automation: ${automationParameterById(select.value).label}`);
    renderStepGrid();
  });
  toolbar.append(label, select);
  wrap.appendChild(toolbar);

  const lane = document.createElement("div");
  lane.className = "piano-roll-automation-lane";
  lane.title = "Automation curve: drag anchors, double-click to add, Option-click or Delete to remove";
  const curve = document.createElementNS(SVG_NS, "svg");
  curve.classList.add("piano-roll-automation-curve");
  curve.setAttribute("viewBox", "0 0 100 100");
  curve.setAttribute("preserveAspectRatio", "none");
  curve.setAttribute("aria-hidden", "true");
  const shadowLine = document.createElementNS(SVG_NS, "polyline");
  shadowLine.classList.add("piano-roll-automation-curve-shadow");
  const line = document.createElementNS(SVG_NS, "polyline");
  line.classList.add("piano-roll-automation-curve-line");
  const updateCurve = (preview = null) => {
    const points = curvePoints(rootNotes, param, preview, renderedSegmentCount, baseStepsPerBar);
    shadowLine.setAttribute("points", points);
    line.setAttribute("points", points);
  };
  updateCurve();
  curve.append(shadowLine, line);
  lane.appendChild(curve);

  const commitValue = (note, value) => {
    if (typeof setHitData !== "function") return;
    const nextValue = clampAutomationValue(param, value);
    if (param.target === "velocity") {
      setHitData(row.id, note.rootStep, { velocity: nextValue }, note.bar);
    } else {
      setHitData(row.id, note.rootStep, { options: { [param.optionKey]: nextValue } }, note.bar);
    }
    selectStep(row.id, note.rootStep, "step", note.bar, state.intensity, row.type === "generated", {
      previewVelocity: param.target === "velocity" ? nextValue : note.velocity
    });
    setStatus?.(`${row.label} ${param.label} ${param.display(nextValue)}`);
    renderStepGrid();
  };

  const deleteAnchor = (note) => {
    if (typeof setHitData !== "function") return;
    if (param.target === "velocity") {
      setHitData(row.id, note.rootStep, { velocity: 0 }, note.bar);
    } else {
      setHitData(row.id, note.rootStep, { options: { [param.optionKey]: param.fallback } }, note.bar);
    }
    selectStep(row.id, note.rootStep, "step", note.bar, state.intensity, row.type === "generated", {
      previewVelocity: param.target === "velocity" ? 0 : note.velocity
    });
    setStatus?.(`${row.label} ${param.label} anchor reset`);
    renderStepGrid();
  };

  rootNotes.forEach((note) => {
    const value = readAutomationValue(note, param);
    const anchor = document.createElement("button");
    anchor.type = "button";
    anchor.className = "piano-roll-automation-anchor";
    if (state.selected?.hit === row.id
      && state.selected?.bar === note.bar
      && Math.abs(Number(state.selected?.step) - Number(note.rootStep)) < 0.0001) {
      anchor.classList.add("is-selected");
    }
    setAnchorVisual(anchor, note, param, value, renderedSegmentCount, baseStepsPerBar);
    anchor.title = titleForAnchor(row, note, param, value);
    anchor.setAttribute("aria-label", `${anchor.title}. Drag to edit automation. Option-click or Delete to remove.`);

    let drag = null;
    anchor.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.altKey) {
        deleteAnchor(note);
        return;
      }
      drag = {
        pointerId: event.pointerId,
        value: pointerToValue(event, lane, param)
      };
      anchor.setPointerCapture?.(event.pointerId);
      anchor.classList.add("is-dragging");
      setAnchorVisual(anchor, note, param, drag.value, renderedSegmentCount, baseStepsPerBar);
      updateCurve({ bar: note.bar, step: note.rootStep, value: drag.value });
    });
    anchor.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      drag.value = pointerToValue(event, lane, param);
      setAnchorVisual(anchor, note, param, drag.value, renderedSegmentCount, baseStepsPerBar);
      updateCurve({ bar: note.bar, step: note.rootStep, value: drag.value });
      anchor.title = titleForAnchor(row, note, param, drag.value);
    });
    const finishDrag = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      anchor.releasePointerCapture?.(event.pointerId);
      anchor.classList.remove("is-dragging");
      const nextValue = drag.value;
      drag = null;
      commitValue(note, nextValue);
    };
    anchor.addEventListener("pointerup", finishDrag);
    anchor.addEventListener("pointercancel", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      anchor.releasePointerCapture?.(event.pointerId);
      anchor.classList.remove("is-dragging");
      drag = null;
      updateCurve();
    });
    anchor.addEventListener("keydown", (event) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      event.preventDefault();
      event.stopPropagation();
      deleteAnchor(note);
    });
    lane.appendChild(anchor);
  });

  lane.addEventListener("dblclick", (event) => {
    if (event.target?.closest?.(".piano-roll-automation-anchor")) return;
    if (typeof setHitData !== "function") return;
    event.preventDefault();
    event.stopPropagation();
    const position = pointerToTime(event, lane, renderedSegmentCount, baseStepsPerBar, normalizeStepPosition, viewStartBar);
    const value = pointerToValue(event, lane, param);
    const options = { pitch: pitchForNewAnchor(rootNotes, state, row) };
    if (param.target !== "velocity") options[param.optionKey] = value;
    const velocity = param.target === "velocity" ? value : 0.5;
    setHitData(row.id, position.step, { velocity, options }, position.bar);
    selectStep(row.id, position.step, "step", position.bar, state.intensity, row.type === "generated", {
      previewVelocity: velocity
    });
    setStatus?.(`${row.label} ${param.label} ${param.display(value)} added`);
    renderStepGrid();
  });

  wrap.appendChild(lane);
  return wrap;
}
