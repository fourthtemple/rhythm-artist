import {
  assignMidiTrackNote,
  gridTrackToMidiNote,
  normalizeMidiTrackNoteMap
} from "./midi-note-map.js";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const noteNameForMidi = (noteNumber) => {
  const note = Math.max(0, Math.min(127, Math.round(Number(noteNumber) || 0)));
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
};

export function createMidiMapPanel({
  state,
  section = null,
  list = null,
  countEl = null,
  setStatus = () => {},
  trackName = (id) => id,
  getTrackDef = () => null,
  baseTrackId = (id) => id,
  syncJson = () => {},
  onLearnStart = () => {},
  showContextMenu = null
} = {}) {
  const gridTrackIds = () => Array.isArray(state.gridTrackIds)
    ? state.gridTrackIds.filter((id) => typeof id === "string" && id)
    : [];

  const configuredMap = () => normalizeMidiTrackNoteMap(state.config?.midiNoteMap, gridTrackIds());
  const normalizeControlMap = (source = {}) => {
    if (!source || typeof source !== "object") return {};
    return Object.fromEntries(
      Object.entries(source)
        .filter(([paramId, mapping]) =>
          typeof paramId === "string"
          && paramId
          && mapping
          && typeof mapping === "object"
          && (mapping.kind === "cc" || mapping.kind === "note"))
        .map(([paramId, mapping]) => [paramId, {
          kind: mapping.kind === "note" ? "note" : "cc",
          channel: Math.max(1, Math.min(16, Math.round(Number(mapping.channel) || 1))),
          controller: Math.max(0, Math.min(127, Math.round(Number(mapping.controller) || 0))),
          noteNumber: Math.max(0, Math.min(127, Math.round(Number(mapping.noteNumber) || 0))),
          label: typeof mapping.label === "string" && mapping.label ? mapping.label : paramId
        }])
    );
  };
  const configuredControlMap = () => normalizeControlMap(state.config?.midiControlMap);

  const mapTrackIds = () => {
    const samples = state.config?.trackSamples || {};
    return gridTrackIds().filter((trackId) => {
      const def = getTrackDef(trackId) || {};
      const base = baseTrackId(trackId);
      return base === "sampler"
        || def.voice === "sampler"
        || def.voice === "sample"
        || Boolean(samples[trackId]);
    });
  };

  function persistMap(nextMap) {
    if (!state.config) return;
    state.config.midiNoteMap = normalizeMidiTrackNoteMap(nextMap, gridTrackIds());
    syncJson();
  }

  function persistControlMap(nextMap) {
    if (!state.config) return;
    state.config.midiControlMap = normalizeControlMap(nextMap);
    syncJson();
  }

  function defaultNoteFor(trackId) {
    return gridTrackToMidiNote(trackId, gridTrackIds(), { trackNoteMap: {} });
  }

  function assignedNoteFor(trackId) {
    return gridTrackToMidiNote(trackId, gridTrackIds(), { trackNoteMap: configuredMap() });
  }

  function assignedNoteLabelFor(trackId) {
    const note = assignedNoteFor(trackId);
    if (note == null) return "";
    return `${note} ${noteNameForMidi(note)}`;
  }

  function hasCustomTrackNote(trackId) {
    return configuredMap()[trackId] != null;
  }

  function setTrackNote(trackId, noteNumber, { announce = true } = {}) {
    const defaultNote = defaultNoteFor(trackId);
    const nextMap = assignMidiTrackNote(configuredMap(), trackId, noteNumber, {
      defaultNote,
      validTrackIds: gridTrackIds()
    });
    persistMap(nextMap);
    if (state.midiLearnTarget === trackId) state.midiLearnTarget = null;
    render();
    if (announce) setStatus(`${trackName(trackId)} MIDI ${noteNumber} ${noteNameForMidi(noteNumber)}`);
  }

  function resetTrackNote(trackId) {
    const nextMap = assignMidiTrackNote(configuredMap(), trackId, null, {
      validTrackIds: gridTrackIds()
    });
    persistMap(nextMap);
    if (state.midiLearnTarget === trackId) state.midiLearnTarget = null;
    render();
    const note = defaultNoteFor(trackId);
    setStatus(`${trackName(trackId)} MIDI reset to ${note} ${noteNameForMidi(note)}`);
  }

  function startLearning(trackId) {
    state.midiLearnTarget = trackId;
    state.midiControlLearnTarget = null;
    onLearnStart(trackId);
    render();
    setStatus(`Learning MIDI for ${trackName(trackId)}`);
  }

  function learnFromNote(noteNumber, { channel = 1 } = {}) {
    if (state.midiControlLearnTarget) {
      learnControlFromNote(noteNumber, { channel });
      return true;
    }
    const target = state.midiLearnTarget;
    if (!target || !gridTrackIds().includes(target)) return false;
    setTrackNote(target, noteNumber, { announce: true });
    return true;
  }

  function descriptorFromElement(element) {
    const paramId = element?.dataset?.midiParam;
    if (!paramId) return null;
    const label = element.dataset.midiLabel || element.closest("label")?.querySelector("span")?.textContent || paramId;
    return {
      paramId,
      label,
      action: element.dataset.midiAction || (element.tagName === "BUTTON" ? "click" : "value")
    };
  }

  function startControlLearning(element) {
    const descriptor = descriptorFromElement(element);
    if (!descriptor) return;
    state.midiControlLearnTarget = descriptor;
    state.midiLearnTarget = null;
    onLearnStart(descriptor.paramId);
    render();
    setStatus(`Learning MIDI for ${descriptor.label}`);
  }

  function learnControlFromControlChange({ channel = 1, controller = 0 } = {}) {
    const target = state.midiControlLearnTarget;
    if (!target) return false;
    const next = configuredControlMap();
    next[target.paramId] = {
      kind: "cc",
      channel: Math.max(1, Math.min(16, Math.round(Number(channel) || 1))),
      controller: Math.max(0, Math.min(127, Math.round(Number(controller) || 0))),
      label: target.label
    };
    persistControlMap(next);
    state.midiControlLearnTarget = null;
    render();
    setStatus(`${target.label} mapped to CC ${next[target.paramId].controller}`);
    return true;
  }

  function learnControlFromNote(noteNumber, { channel = 1 } = {}) {
    const target = state.midiControlLearnTarget;
    if (!target) return false;
    const note = Math.max(0, Math.min(127, Math.round(Number(noteNumber) || 0)));
    const next = configuredControlMap();
    next[target.paramId] = {
      kind: "note",
      channel: Math.max(1, Math.min(16, Math.round(Number(channel) || 1))),
      noteNumber: note,
      controller: 0,
      label: target.label
    };
    persistControlMap(next);
    state.midiControlLearnTarget = null;
    render();
    setStatus(`${target.label} mapped to note ${note} ${noteNameForMidi(note)}`);
    return true;
  }

  function clearControlMap(paramId) {
    const next = configuredControlMap();
    const label = next[paramId]?.label || paramId;
    delete next[paramId];
    persistControlMap(next);
    if (state.midiControlLearnTarget?.paramId === paramId) state.midiControlLearnTarget = null;
    render();
    setStatus(`${label} MIDI map cleared`);
  }

  function setElementFromUnit(element, unitValue) {
    if (!element || element.disabled) return false;
    const action = element.dataset.midiAction || (element.tagName === "BUTTON" ? "click" : "value");
    if (action === "click") {
      if (unitValue >= 0.5) element.click();
      return true;
    }
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) return false;
    const min = Number(element.min);
    const max = Number(element.max);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      const next = min + Math.max(0, Math.min(1, unitValue)) * (max - min);
      const step = Number(element.step);
      element.value = Number.isFinite(step) && step > 0
        ? String(Math.round(next / step) * step)
        : String(next);
    } else {
      element.value = String(unitValue);
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function applyControlChange({ channel = 1, controller = 0, value = 0 } = {}) {
    let applied = false;
    Object.entries(configuredControlMap()).forEach(([paramId, mapping]) => {
      if (mapping.kind !== "cc") return;
      if (mapping.channel !== channel || mapping.controller !== controller) return;
      const selector = `[data-midi-param="${CSS.escape(paramId)}"]`;
      const element = document.querySelector(`input${selector}, select${selector}, button${selector}[data-midi-action="click"]`)
        || document.querySelector(selector);
      if (setElementFromUnit(element, value)) applied = true;
    });
    return applied;
  }

  function applyNote({ noteNumber, velocity = 1, channel = 1 } = {}) {
    let applied = false;
    Object.entries(configuredControlMap()).forEach(([paramId, mapping]) => {
      if (mapping.kind !== "note" || mapping.noteNumber !== noteNumber) return;
      if (mapping.channel !== channel) return;
      const selector = `[data-midi-param="${CSS.escape(paramId)}"]`;
      const element = document.querySelector(`button${selector}[data-midi-action="click"], input${selector}, select${selector}`)
        || document.querySelector(selector);
      if (setElementFromUnit(element, velocity > 0 ? 1 : 0)) applied = true;
    });
    return applied;
  }

  function installContextMenu() {
    if (!showContextMenu || section?.dataset.midiContextInstalled === "1") return;
    if (section) section.dataset.midiContextInstalled = "1";
    document.addEventListener("contextmenu", (event) => {
      const element = event.target?.closest?.("[data-midi-param]");
      if (!element) return;
      const descriptor = descriptorFromElement(element);
      if (!descriptor) return;
      const mapped = configuredControlMap()[descriptor.paramId];
      showContextMenu(event, [
        { label: "Map to MIDI", action: () => startControlLearning(element) },
        { label: "Clear MIDI Map", disabled: !mapped, action: () => clearControlMap(descriptor.paramId) }
      ]);
    });
  }

  function renderRow(trackId) {
    const row = document.createElement("div");
    row.className = `midi-map-row ${state.midiLearnTarget === trackId ? "is-learning" : ""}`;
    row.dataset.trackId = trackId;

    const name = document.createElement("span");
    name.className = "midi-map-track";
    name.textContent = trackName(trackId);

    const noteInput = document.createElement("input");
    noteInput.type = "number";
    noteInput.min = "0";
    noteInput.max = "127";
    noteInput.step = "1";
    noteInput.className = "midi-map-note-input";
    noteInput.value = String(assignedNoteFor(trackId) ?? 0);
    noteInput.title = `MIDI note for ${trackName(trackId)}`;
    noteInput.addEventListener("change", () => {
      const note = Math.max(0, Math.min(127, Math.round(Number(noteInput.value) || 0)));
      setTrackNote(trackId, note);
    });
    noteInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      noteInput.blur();
    });

    const noteLabel = document.createElement("span");
    noteLabel.className = "midi-map-note-label";
    noteLabel.textContent = noteNameForMidi(noteInput.value);

    const learn = document.createElement("button");
    learn.type = "button";
    learn.className = "midi-map-learn";
    learn.textContent = state.midiLearnTarget === trackId ? "..." : "Learn";
    learn.title = `Learn next MIDI note for ${trackName(trackId)}`;
    learn.addEventListener("click", () => startLearning(trackId));

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "midi-map-reset";
    reset.textContent = "Reset";
    reset.title = `Reset ${trackName(trackId)} to its row note`;
    reset.disabled = configuredMap()[trackId] == null;
    reset.addEventListener("click", () => resetTrackNote(trackId));

    row.append(name, noteInput, noteLabel, learn, reset);
    return row;
  }

  function render() {
    if (!list) return;
    const tracks = mapTrackIds();
    const controlMappings = configuredControlMap();
    const controlEntries = Object.entries(controlMappings);
    if (countEl) countEl.textContent = `${tracks.length + controlEntries.length}`;
    if (section) section.hidden = false;
    list.innerHTML = "";
    if (!tracks.length && !controlEntries.length) {
      const empty = document.createElement("p");
      empty.className = "midi-map-empty";
      empty.textContent = "No MIDI maps";
      list.appendChild(empty);
      return;
    }
    tracks.forEach((trackId) => list.appendChild(renderRow(trackId)));
    controlEntries.forEach(([paramId, mapping]) => {
      const row = document.createElement("div");
      row.className = "midi-map-row midi-map-control-row";
      const name = document.createElement("span");
      name.className = "midi-map-track";
      name.textContent = mapping.label || paramId;
      const source = document.createElement("span");
      source.className = "midi-map-control-source";
      source.textContent = mapping.kind === "note"
        ? `Note ${mapping.noteNumber}`
        : `CC ${mapping.controller}`;
      const clear = document.createElement("button");
      clear.type = "button";
      clear.textContent = "Clear";
      clear.addEventListener("click", () => clearControlMap(paramId));
      row.append(name, source, clear);
      list.appendChild(row);
    });
  }

  installContextMenu();

  return {
    applyControlChange,
    applyNote,
    assignedNoteLabelFor,
    hasCustomTrackNote,
    learnControlFromControlChange,
    learnFromNote,
    render,
    resetTrackNote,
    startLearning,
    sync: render
  };
}
