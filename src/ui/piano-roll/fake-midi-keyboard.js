import { createWebMidiInput } from "../midi/web-midi-input.js";
import { MIDI_DRUM_ROOT_NOTE, midiNoteToGridTrack } from "../midi/midi-note-map.js";

const GRID_MODE = "grid";
const PIANO_ROLL_MODE = "pianoRoll";
const WAVE_MODE = "wave";
const PITCH_ZERO_MIDI_NOTE = 33;
const COMPUTER_OCTAVE_MIN = 1;
const COMPUTER_OCTAVE_MAX = 10;
const DEFAULT_COMPUTER_OCTAVE = 4;

const COMPUTER_KEY_NOTES = [
  { semitone: 0, key: "a" }, { semitone: 1, key: "w" }, { semitone: 2, key: "s" },
  { semitone: 3, key: "e" }, { semitone: 4, key: "d" }, { semitone: 5, key: "f" },
  { semitone: 6, key: "t" }, { semitone: 7, key: "g" }, { semitone: 8, key: "y" },
  { semitone: 9, key: "h" }, { semitone: 10, key: "u" }, { semitone: 11, key: "j" },
  { semitone: 12, key: "k" }
];
const COMPUTER_KEY_CHORDS = [
  { key: "z", id: "single", label: "1", intervals: [0] },
  { key: "x", id: "triad", label: "1-3-5", intervals: [0, 4, 7] },
  { key: "c", id: "seventh", label: "7", intervals: [0, 4, 7, 10] },
  { key: "v", id: "ninth", label: "9", intervals: [0, 4, 7, 10, 14] },
  { key: "b", id: "sus2", label: "sus2", intervals: [0, 2, 7] },
  { key: "n", id: "sus4", label: "sus4", intervals: [0, 5, 7] },
  { key: "m", id: "power", label: "5", intervals: [0, 7, 12] }
];

const KEY_TO_NOTE = new Map(COMPUTER_KEY_NOTES.map((note) => [note.key, note]));
const KEY_TO_CHORD = new Map(COMPUTER_KEY_CHORDS.map((chord) => [chord.key, chord]));
const OCTAVE_KEY_TO_VALUE = new Map([
  ["1", 1], ["2", 2], ["3", 3], ["4", 4], ["5", 5],
  ["6", 6], ["7", 7], ["8", 8], ["9", 9], ["0", 10]
]);
const OCTAVE_KEY_DELTAS = new Map([
  ["arrowleft", -1],
  ["arrowdown", -1],
  ["arrowright", 1],
  ["arrowup", 1]
]);

export function computerOctaveFromKey(key, fallback = DEFAULT_COMPUTER_OCTAVE) {
  const value = OCTAVE_KEY_TO_VALUE.get(String(key || ""));
  if (value) return value;
  return Math.max(COMPUTER_OCTAVE_MIN, Math.min(COMPUTER_OCTAVE_MAX, Math.round(Number(fallback) || DEFAULT_COMPUTER_OCTAVE)));
}

export function computerOctaveDeltaForKey(key) {
  return OCTAVE_KEY_DELTAS.get(String(key || "").toLowerCase()) || 0;
}

export function pitchForComputerKey(key, octave = DEFAULT_COMPUTER_OCTAVE) {
  const note = KEY_TO_NOTE.get(String(key || "").toLowerCase());
  if (!note) return null;
  const slot = Math.max(COMPUTER_OCTAVE_MIN, Math.min(COMPUTER_OCTAVE_MAX, Math.round(Number(octave) || DEFAULT_COMPUTER_OCTAVE)));
  return (slot - 1) * 12 + note.semitone - PITCH_ZERO_MIDI_NOTE;
}

export function chordForComputerKey(key) {
  return KEY_TO_CHORD.get(String(key || "").toLowerCase()) || null;
}

export function resolvePerformanceTrack({
  trackEditorMode = GRID_MODE,
  selectedHit = null,
  selectedTracks = [],
  pianoRollTargetTrack = null,
  openPianoRollTracks = [],
  gridTrackIds = []
} = {}) {
  const grid = new Set(Array.isArray(gridTrackIds) ? gridTrackIds.filter((id) => typeof id === "string" && id) : []);
  const open = Array.isArray(openPianoRollTracks) ? openPianoRollTracks.filter((id) => typeof id === "string" && id) : [];
  const openSet = new Set(open);
  const selected = Array.isArray(selectedTracks) ? selectedTracks : [];
  const candidates = [
    selectedHit,
    pianoRollTargetTrack,
    ...selected
  ];
  if (trackEditorMode === PIANO_ROLL_MODE) {
    for (const id of candidates) {
      if (typeof id === "string" && openSet.has(id)) return id;
    }
    return open[0] || null;
  }
  for (const id of candidates) {
    if (typeof id !== "string" || !id) continue;
    if (grid.has(id) || openSet.has(id)) return id;
  }
  return open[0] || null;
}

const isTypingTarget = (target) => {
  const tag = target?.tagName?.toLowerCase?.() || "";
  return target?.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
};

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

const roundStep = (value) => Number(clampNumber(value, 0, 15, 0).toFixed(4));

/**
 * Virtual MIDI input for users without a physical controller.
 *
 * The computer keyboard only takes over when explicitly armed. Recording is
 * separate from previewing: armed keys can be used to practice over playback,
 * and record mode writes quantized notes to the active piano-roll instrument.
 */
export function createFakeMidiKeyboard({
  $,
  state,
  runningFromFile,
  setStatus,
  normalizeStepOptions,
  readStoredHit,
  setHitData,
  selectStep,
  buildStepGrid = null,
  refreshPianoRollLanes = null,
  renderStepGrid,
  addGridTrack,
  renderTrackExplorer,
  renderTrackInspector = null,
  renderSelectedPiano,
  PITCH_SLIDER_MIN,
  PITCH_SLIDER_MAX,
  BLACK_NOTE_PITCH_CLASSES,
  A1_MIDI_NOTE,
  noteNameForPitch,
  formatPitch,
  midiMapPanel = null,
  trackName = (id) => id,
  showContextMenu = null,
  onTrackEditorModeChange = () => {}
}) {
  const selectedPiano = $("#selected-piano");
  const gridModeBtn = $("#track-mode-grid");
  const pianoRollModeBtn = $("#track-mode-piano-roll");
  const waveModeBtn = $("#track-mode-wave");
  const keyboardToggle = $("#computer-keyboard-toggle");
  const recordToggle = $("#midi-record-toggle");
  const clearTakeButton = $("#midi-clear-take");
  const targetLabel = $("#midi-target-label");
  const keyboardMap = $("#computer-keyboard-map");
  const octaveOutput = $("#computer-keyboard-octave");
  const performanceHint = $("#midi-performance-hint");
  const selectedVelocity = $("#selected-velocity");
  const activeComputerKeys = new Map();
  const recordingTake = new Map();
  let pianoRollRebuildRaf = 0;
  let liveNoteSerial = 0;

  const totalBars = () => Math.max(1, state.config?.patterns?.jazz?.bars?.length || 1);
  const valueOf = (input, min, max, fallback) => clampNumber(input?.value, min, max, fallback);
  const computerKeyboardOctave = () => {
    const value = Math.round(clampNumber(state.computerKeyboardOctave, COMPUTER_OCTAVE_MIN, COMPUTER_OCTAVE_MAX, DEFAULT_COMPUTER_OCTAVE));
    state.computerKeyboardOctave = value;
    return value;
  };
  const computerKeyboardChord = () => {
    const chord = COMPUTER_KEY_CHORDS.find((item) => item.id === state.computerKeyboardChordId) || COMPUTER_KEY_CHORDS[0];
    state.computerKeyboardChordId = chord.id;
    return chord;
  };
  const computerKeyboardChordIntervals = () => [...computerKeyboardChord().intervals];
  const computerNoteForKey = (key) => {
    const note = KEY_TO_NOTE.get(String(key || "").toLowerCase());
    if (!note) return null;
    const pitch = pitchForComputerKey(note.key, computerKeyboardOctave());
    return pitch === null ? null : { ...note, pitch };
  };
  const velocityValue = () => {
    const value = valueOf(selectedVelocity, 0, 0.9, state.pianoRollLastVelocity ?? 0.42);
    return value > 0.005 ? value : 0.42;
  };
  const pressureValue = () => 0;
  const cloneHitEntry = (entry) => {
    if (!entry || !(Number(entry.velocity) > 0.005)) return null;
    return {
      step: roundStep(entry.step),
      velocity: clampNumber(entry.velocity, 0, 1, 0),
      options: normalizeStepOptions({ ...(entry.options || {}) })
    };
  };
  const takeKey = (track, barIndex, step) => `${barIndex}:${track}:${roundStep(step)}`;
  const rememberTakeEdit = (track, barIndex, step, previous) => {
    if (!isRecording() || !track) return;
    const key = takeKey(track, barIndex, step);
    if (!recordingTake.has(key)) {
      recordingTake.set(key, {
        track,
        barIndex,
        step: roundStep(step),
        previous: cloneHitEntry(previous)
      });
    }
  };
  const velocityFromKeyEvent = (event) => {
    const pressure = Number(event?.pressure ?? event?.webkitForce ?? 0);
    if (Number.isFinite(pressure) && pressure > 0.01) {
      const velocity = clampNumber(0.08 + pressure * 0.82, 0.08, 0.9, velocityValue());
      state.pianoRollLastVelocity = velocity;
      return velocity;
    }
    const key = event?.target?.closest?.(".selected-piano-key[data-pitch]");
    const rect = key?.getBoundingClientRect?.();
    if (rect && rect.height > 0 && Number.isFinite(Number(event.clientY))) {
      const strike = clampNumber((event.clientY - rect.top) / rect.height, 0, 1, 0.5);
      const velocity = clampNumber(0.18 + (1 - strike) * 0.72, 0.08, 0.9, velocityValue());
      state.pianoRollLastVelocity = velocity;
      return velocity;
    }
    return velocityValue();
  };
  const isPianoRollMode = () => state.trackEditorMode === PIANO_ROLL_MODE;
  const isKeyboardArmed = () => Boolean(state.midiKeyboardArmed);
  const isRecording = () => Boolean(state.midiKeyboardArmed && state.midiRecording);
  const activeMidiNotes = new Map();
  const openPianoRollTracks = () => Array.isArray(state.config?.pianoRollTracks)
    ? state.config.pianoRollTracks.filter((id) => typeof id === "string" && id)
    : [];
  const pianoRollTargetTrack = () => {
    const open = openPianoRollTracks();
    if (state.selected?.hit && open.includes(state.selected.hit)) return state.selected.hit;
    if (state.pianoRollTargetTrack && open.includes(state.pianoRollTargetTrack)) return state.pianoRollTargetTrack;
    return open[0] || null;
  };
  const gridHitTracks = () => Array.isArray(state.gridTrackIds)
    ? state.gridTrackIds.filter((id) => typeof id === "string" && id)
    : [];
  const schedulePianoRollRefresh = ({ immediate = false } = {}) => {
    const refresh = typeof refreshPianoRollLanes === "function"
      ? refreshPianoRollLanes
      : typeof buildStepGrid === "function"
        ? buildStepGrid
        : null;
    if (!refresh || !openPianoRollTracks().length) {
      renderStepGrid();
      return;
    }
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      refresh();
      return;
    }
    if (immediate) {
      if (pianoRollRebuildRaf) {
        window.cancelAnimationFrame?.(pianoRollRebuildRaf);
        pianoRollRebuildRaf = 0;
      }
      refresh();
      return;
    }
    if (pianoRollRebuildRaf) window.cancelAnimationFrame?.(pianoRollRebuildRaf);
    pianoRollRebuildRaf = window.requestAnimationFrame(() => {
      pianoRollRebuildRaf = 0;
      refresh();
    });
  };
  const liveNoteEntries = () => {
    if (!Array.isArray(state.livePianoRollNotes)) state.livePianoRollNotes = [];
    return state.livePianoRollNotes;
  };
  const removeLivePianoRollNote = (id, { refresh = true } = {}) => {
    if (!id || !Array.isArray(state.livePianoRollNotes) || !state.livePianoRollNotes.length) return false;
    const before = state.livePianoRollNotes.length;
    state.livePianoRollNotes = state.livePianoRollNotes.filter((entry) => entry?.id !== id);
    const changed = state.livePianoRollNotes.length !== before;
    if (changed && refresh) schedulePianoRollRefresh({ immediate: true });
    return changed;
  };
  const clearLivePianoRollNotes = ({ refresh = true } = {}) => {
    if (!Array.isArray(state.livePianoRollNotes) || !state.livePianoRollNotes.length) return false;
    state.livePianoRollNotes = [];
    if (refresh) schedulePianoRollRefresh({ immediate: true });
    return true;
  };
  const addLivePianoRollNote = ({
    id,
    track,
    pitch,
    velocity = velocityValue(),
    pressure = pressureValue(),
    chordIntervals = computerKeyboardChordIntervals()
  } = {}) => {
    const open = openPianoRollTracks();
    const targetId = track && open.includes(track)
      ? track
      : pianoRollTargetTrack();
    if (!targetId || !open.includes(targetId)) return null;
    const target = ensureRecordedPianoRollTarget(targetId);
    if (!target) return null;
    const liveId = id || `preview:${target}:${pitch}:${++liveNoteSerial}`;
    const { barIndex, step } = recordPosition();
    removeLivePianoRollNote(liveId, { refresh: false });
    liveNoteEntries().push({
      id: liveId,
      track: target,
      bar: barIndex,
      step,
      pitch,
      velocity: Math.max(0.01, velocity),
      options: normalizeStepOptions({
        pitch,
        chordIntervals: normalizeKeyboardChordIntervals(chordIntervals),
        pressure,
        pianoRoll: 1
      })
    });
    schedulePianoRollRefresh({ immediate: true });
    return { id: liveId, track: target, barIndex, step };
  };
  const selectedPerformanceTrack = () => resolvePerformanceTrack({
    trackEditorMode: state.trackEditorMode,
    selectedHit: state.selected?.hit,
    selectedTracks: state.selectedTracks,
    pianoRollTargetTrack: state.pianoRollTargetTrack,
    openPianoRollTracks: openPianoRollTracks(),
    gridTrackIds: gridHitTracks()
  });
  const inputTarget = () => {
    const selectedTrack = selectedPerformanceTrack();
    if (selectedTrack) return { mode: "track", track: selectedTrack };
    if (isPianoRollMode()) return { mode: "none" };
    const tracks = gridHitTracks();
    if (tracks.length) return { mode: "grid", tracks };
    return { mode: "none" };
  };
  const inputTargetSummary = (target = inputTarget()) => {
    if (target.mode === "track") return `${trackName(target.track)} keys`;
    if (target.mode === "grid") {
      const first = target.tracks[0] ? trackName(target.tracks[0]) : "row 1";
      return `Grid hits · note ${MIDI_DRUM_ROOT_NOTE}=${first}`;
    }
    return "No target";
  };
  const computerKeyToGridHit = (key) => {
    const note = KEY_TO_NOTE.get(String(key || "").toLowerCase());
    if (!note) return null;
    const index = COMPUTER_KEY_NOTES.indexOf(note);
    return index >= 0 ? gridHitTracks()[index] || null : null;
  };
  const keyboardNotes = () => Array.from(
    { length: Math.max(1, Math.round(PITCH_SLIDER_MAX - PITCH_SLIDER_MIN + 1)) },
    (_, index) => {
      const pitch = PITCH_SLIDER_MIN + index;
      const key = COMPUTER_KEY_NOTES.find((note) => pitchForComputerKey(note.key, computerKeyboardOctave()) === pitch)?.key?.toUpperCase() || "";
      return { pitch, key };
    }
  );
  const midiNoteToPitch = (noteNumber) => {
    const pitch = Math.round(Number(noteNumber) - A1_MIDI_NOTE);
    return pitch >= PITCH_SLIDER_MIN && pitch <= PITCH_SLIDER_MAX ? pitch : null;
  };
  const rememberPerformanceMidi = (patch = {}) => {
    state.performanceMidi = {
      controls: {},
      pressure: 0,
      pitchBend: 0,
      program: null,
      ...(state.performanceMidi || {}),
      ...patch
    };
  };
  const midiInput = createWebMidiInput({
    setStatus,
    isEnabled: isKeyboardArmed,
    onNoteOn: ({ noteNumber, velocity, pressure = 0, inputName, channel }) => {
      if (midiMapPanel?.learnFromNote?.(noteNumber, { channel })) return;
      if (midiMapPanel?.applyNote?.({ noteNumber, velocity, pressure, channel })) return;
      const target = inputTarget();
      if (target.mode === "grid") {
        const hit = midiNoteToGridTrack(noteNumber, target.tracks, {
          trackNoteMap: state.config?.midiNoteMap || {}
        });
        if (!hit) {
          setStatus(`MIDI note ${noteNumber} has no grid row`);
          return;
        }
        activeMidiNotes.set(noteNumber, { mode: "grid", hit });
        rememberPerformanceMidi({
          lastInput: inputName,
          lastNote: noteNumber,
          lastVelocity: velocity,
          lastTrack: hit,
          lastAt: Date.now()
        });
        void triggerGridHit(hit, { record: isRecording(), velocity, pressure });
        return;
      }
      if (target.mode === "track") {
        const pitch = midiNoteToPitch(noteNumber);
        if (pitch == null) {
          setStatus(`MIDI note outside pitch range · ${noteNumber}`);
          return;
        }
        const liveId = `midi:${channel ?? 0}:${noteNumber}`;
        activeMidiNotes.set(noteNumber, { mode: "piano", pitch, track: target.track, liveId });
        rememberPerformanceMidi({
          lastInput: inputName,
          lastNote: noteNumber,
          lastVelocity: velocity,
          lastTrack: target.track,
          lastAt: Date.now()
        });
        void triggerNote({ pitch }, { record: isRecording(), velocity, pressure, track: target.track, sourceId: liveId, hold: true });
        return;
      }
      setStatus("Select a track first");
    },
    onNoteOff: ({ noteNumber }) => {
      const active = activeMidiNotes.get(noteNumber);
      activeMidiNotes.delete(noteNumber);
      if (active?.mode === "grid") setGridActive(active.hit, false);
      if (active?.mode === "piano") {
        setActive(active.pitch, false);
        removeLivePianoRollNote(active.liveId);
      }
    },
    onPressure: ({ pressure, scoped, noteNumber }) => {
      rememberPerformanceMidi({
        pressure,
        lastPressureScope: scoped,
        lastPressureNote: noteNumber ?? null,
        lastAt: Date.now()
      });
    },
    onControlChange: ({ controller, value, valueRaw, channel, inputName }) => {
      rememberPerformanceMidi({
        controls: {
          ...(state.performanceMidi?.controls || {}),
          [`${channel}:${controller}`]: value
        },
        lastInput: inputName,
        lastControl: { channel, controller, value, valueRaw },
        lastAt: Date.now()
      });
      if (midiMapPanel?.learnControlFromControlChange?.({ channel, controller, value, valueRaw, inputName })) return;
      midiMapPanel?.applyControlChange?.({ channel, controller, value, valueRaw, inputName });
    },
    onPitchBend: ({ value, valueRaw, channel, inputName }) => {
      rememberPerformanceMidi({
        lastInput: inputName,
        pitchBend: value,
        lastPitchBend: { channel, value, valueRaw },
        lastAt: Date.now()
      });
    },
    onProgramChange: ({ program, channel, inputName }) => {
      rememberPerformanceMidi({
        lastInput: inputName,
        program,
        lastProgram: { channel, program },
        lastAt: Date.now()
      });
    }
  });

  function updateOutputs() {
    updateTarget();
  }

  function ensurePianoRollTrack() {
    const target = pianoRollTargetTrack();
    if (!target) {
      setStatus("Select a track or open a piano-roll instrument first");
      return null;
    }
    return ensureRecordedPianoRollTarget(target);
  }

  function ensureRecordedPianoRollTarget(target) {
    if (!target) return null;
    if (!state.config) return target;
    if (!Array.isArray(state.config.pianoRollTracks)) state.config.pianoRollTracks = [];
    if (!state.config.pianoRollTracks.includes(target)) {
      state.config.pianoRollTracks = [...state.config.pianoRollTracks, target];
    }
    if (!state.gridTrackIds.includes(target)) {
      addGridTrack?.(target);
      renderTrackExplorer?.();
    }
    if (state.config) state.config.generatedRowsEditable = 1;
    const bars = state.config?.patterns?.jazz?.bars || [];
    bars.forEach((bar) => {
      if (bar && !Array.isArray(bar[target])) bar[target] = [];
    });
    state.pianoRollTargetTrack = target;
    return target;
  }

  function rawRecordAbsStep() {
    const playingBar = clampNumber(state.cameraPlayheadBar ?? state.activeBar, 0, totalBars() - 1, 0);
    const playingStep = clampNumber(state.cameraPlayheadStep ?? state.playheadStep, 0, 15, 0);
    if (state.playing) return playingBar * 16 + playingStep;
    const selectedBar = clampNumber(state.selected?.bar ?? state.activeBar, 0, totalBars() - 1, 0);
    const selectedStep = clampNumber(state.selected?.step ?? state.playheadStep ?? 0, 0, 15, 0);
    return selectedBar * 16 + selectedStep;
  }

  function quantizedAbsStep(rawAbsStep) {
    const q = state.quantize || {};
    const raw = clampNumber(rawAbsStep, 0, totalBars() * 16 - 1, 0);
    const value = parseQuantizeValue(q.value);
    if (!q.enabled || !(value > 0)) return raw;
    const gridSteps = Math.max(0.0001, value * 16);
    const snapped = Math.round(raw / gridSteps) * gridSteps;
    return clampNumber(snapped, 0, totalBars() * 16 - 1, 0);
  }

  function recordPosition() {
    const absStep = quantizedAbsStep(rawRecordAbsStep());
    return {
      barIndex: Math.max(0, Math.min(totalBars() - 1, Math.floor(absStep / 16))),
      step: roundStep(absStep % 16)
    };
  }

  function quantizeLabel() {
    const q = state.quantize || {};
    const value = parseQuantizeValue(q.value);
    if (!q.enabled || !(value > 0)) return "free";
    if (value >= 1) return `${value} bar${value === 1 ? "" : "s"}`;
    return `1/${Math.round(1 / value)}`;
  }

  function updateTarget() {
    const target = inputTarget();
    if (target.mode === "none" && state.midiKeyboardArmed) {
      state.midiKeyboardArmed = false;
      clearActiveKeys();
      midiInput.setEnabled(false, { announce: false });
    }
    if (!state.midiKeyboardArmed) state.midiRecording = false;
    const armed = isKeyboardArmed();
    const recording = isRecording();
    const targetText = inputTargetSummary(target);
    const inputSummary = midiInput.summary();
    const octave = computerKeyboardOctave();
    const chord = computerKeyboardChord();
    if (octaveOutput) {
      octaveOutput.textContent = `O${octave} ${chord.label}`;
      octaveOutput.title = `Computer keyboard octave ${octave}, chord ${chord.label}. Press 1-9 or 0 for 10; arrows nudge octave; Z-M selects chord.`;
    }
    if (targetLabel) {
      targetLabel.textContent = targetText;
      targetLabel.title = target.mode !== "none"
        ? `Keyboard target: ${targetText} · ${inputSummary}`
        : "Select or add a track first";
    }
    keyboardToggle?.classList.toggle("is-active", armed);
    keyboardToggle?.setAttribute("aria-pressed", String(armed));
    if (keyboardToggle && keyboardToggle.dataset.iconButton !== "keyboard") {
      keyboardToggle.textContent = armed ? "Keyboard On" : "Keyboard";
    }
    if (keyboardToggle) {
      keyboardToggle.title = target.mode !== "none"
        ? `Use computer keys or MIDI for ${targetText} · octave ${octave} · ${inputSummary}`
        : "Select or add a track first";
    }
    recordToggle?.classList.toggle("is-active", recording);
    recordToggle?.classList.toggle("is-recording", recording);
    recordToggle?.setAttribute("aria-pressed", String(recording));
    if (recordToggle) recordToggle.textContent = recording ? "Recording" : "Record";
    if (recordToggle) {
      recordToggle.title = target.mode !== "none"
        ? `Record computer-keyboard or MIDI into ${targetText}`
        : "Select or add a track first";
    }
    if (clearTakeButton) {
      const hasTake = recordingTake.size > 0;
      clearTakeButton.disabled = !hasTake;
      clearTakeButton.classList.toggle("has-take", hasTake);
      clearTakeButton.title = hasTake
        ? `Clear ${recordingTake.size} recorded item${recordingTake.size === 1 ? "" : "s"} from the last take`
        : "No recording take to clear";
    }
    if (performanceHint) {
      performanceHint.textContent = target.mode !== "none"
        ? armed
          ? recording
            ? `Recording ${targetText} · ${quantizeLabel()} quantize · octave ${octave} · ${chord.label}`
            : `Keyboard armed for ${targetText} · octave ${octave} · ${chord.label}`
          : "Arm Keyboard to play A W S E D F T G Y H U J K"
        : "Select or add a track, then arm Keyboard.";
    }
  }

  function setComputerKeyboardOctave(octave, { announce = true } = {}) {
    state.computerKeyboardOctave = Math.round(clampNumber(octave, COMPUTER_OCTAVE_MIN, COMPUTER_OCTAVE_MAX, DEFAULT_COMPUTER_OCTAVE));
    updateKeyboardMap();
    updateTarget();
    if (announce) setStatus(`Computer keyboard octave ${state.computerKeyboardOctave}`);
  }

  function setComputerKeyboardChord(chordId, { announce = true } = {}) {
    const chord = COMPUTER_KEY_CHORDS.find((item) => item.id === chordId) || COMPUTER_KEY_CHORDS[0];
    state.computerKeyboardChordId = chord.id;
    updateTarget();
    if (announce) setStatus(`Computer keyboard chord ${chord.label}`);
  }

  function setMode(mode, { announce = true, rebuild = true } = {}) {
    const nextMode = mode === PIANO_ROLL_MODE
      ? PIANO_ROLL_MODE
      : mode === WAVE_MODE
        ? WAVE_MODE
        : GRID_MODE;
    state.trackEditorMode = nextMode;
    const pianoMode = nextMode === PIANO_ROLL_MODE;
    const waveMode = nextMode === WAVE_MODE;
    gridModeBtn?.classList.toggle("is-active", nextMode === GRID_MODE);
    pianoRollModeBtn?.classList.toggle("is-active", pianoMode);
    waveModeBtn?.classList.toggle("is-active", waveMode);
    gridModeBtn?.setAttribute("aria-pressed", String(nextMode === GRID_MODE));
    pianoRollModeBtn?.setAttribute("aria-pressed", String(pianoMode));
    waveModeBtn?.setAttribute("aria-pressed", String(waveMode));
    if (waveMode) document.querySelector("#sample-add-mode-loop")?.click?.();
    onTrackEditorModeChange();
    if (rebuild) {
      buildStepGrid?.();
      renderTrackExplorer?.();
      renderTrackInspector?.();
    }
    if (pianoMode) {
      renderSelectedPiano?.(0);
      if (announce) {
        const target = pianoRollTargetTrack();
        setStatus(target
          ? `Piano Roll mode · ${trackName(target)} · quantize ${quantizeLabel()}`
          : `Piano Roll mode · set an instrument count to 1`);
      }
    } else if (waveMode && announce) {
      setStatus("Wave view");
    } else if (announce) {
      setStatus("Grid mode");
    }
    renderTrackExplorer?.();
    updateTarget();
  }

  function clearActiveKeys() {
    activeComputerKeys.clear();
    activeMidiNotes.clear();
    keyboardMap?.querySelectorAll(".computer-keyboard-key.is-active").forEach((key) => {
      key.classList.remove("is-active");
    });
    selectedPiano?.querySelectorAll(".selected-piano-key.is-active").forEach((key) => {
      key.classList.remove("is-active");
    });
    document.querySelectorAll(".track-label.is-midi-triggered").forEach((row) => {
      row.classList.remove("is-midi-triggered");
    });
    clearLivePianoRollNotes();
  }

  function setKeyboardArmed(armed, { announce = true } = {}) {
    const next = Boolean(armed);
    const target = inputTarget();
    if (next && target.mode === "none") {
      updateTarget();
      if (announce) setStatus("Select or add a track first");
      return false;
    }
    state.midiKeyboardArmed = next;
    if (next) {
      if (target.mode === "grid" && state.trackEditorMode !== GRID_MODE) setMode(GRID_MODE, { announce: false });
      midiInput.setEnabled(true, { request: true, announce });
    } else {
      state.midiRecording = false;
      clearActiveKeys();
      midiInput.setEnabled(false, { announce: false });
    }
    updateTarget();
    if (announce) {
      const nextTarget = inputTarget();
      setStatus(next && nextTarget.mode !== "none" ? `Keyboard armed · ${inputTargetSummary(nextTarget)} · ${midiInput.summary()}` : "Keyboard off");
    }
    return true;
  }

  function setRecording(recording, { announce = true } = {}) {
    const next = Boolean(recording);
    if (next && !setKeyboardArmed(true, { announce: false })) {
      if (announce) setStatus("Select or add a track first");
      return false;
    }
    if (next) recordingTake.clear();
    state.midiRecording = next;
    updateTarget();
    if (announce) {
      const target = inputTarget();
      setStatus(next && target.mode !== "none"
        ? `Recording ${inputTargetSummary(target)} · quantize ${quantizeLabel()}`
        : "Recording off");
    }
    return true;
  }

  function clearRecordingTake({ announce = true } = {}) {
    const entries = Array.from(recordingTake.values());
    if (!entries.length) {
      if (announce) setStatus("No recording take to clear");
      updateTarget();
      return false;
    }
    state.midiRecording = false;
    clearActiveKeys();
    entries.forEach((entry) => {
      if (entry.previous) {
        setHitData(entry.track, entry.step, {
          velocity: entry.previous.velocity,
          options: entry.previous.options
        }, entry.barIndex);
      } else {
        setHitData(entry.track, entry.step, { velocity: 0 }, entry.barIndex);
      }
    });
    recordingTake.clear();
    schedulePianoRollRefresh();
    updateTarget();
    if (announce) {
      setStatus(`Cleared recording take · ${entries.length} item${entries.length === 1 ? "" : "s"}`);
    }
    return true;
  }

  async function previewNote(pitch, {
    velocity = velocityValue(),
    pressure = pressureValue(),
    track = selectedPerformanceTrack(),
    chordIntervals = computerKeyboardChordIntervals()
  } = {}) {
    if (runningFromFile) {
      setStatus("Open the localhost version for audio");
      return;
    }
    const targetTrack = track || selectedPerformanceTrack();
    if (!targetTrack) {
      setStatus("Select a track first");
      return;
    }
    const intervals = normalizeKeyboardChordIntervals(chordIntervals);
    const gain = (velocity * (0.18 + pressure * 0.1)) / Math.sqrt(Math.max(1, intervals.length));
    await Promise.all(intervals.map((interval) =>
      state.engine.auditionPitchedTrack(targetTrack, pitch + interval, { gain, pressure })
    ));
  }

  async function previewGridHit(hit, { velocity = velocityValue() } = {}) {
    if (runningFromFile) {
      setStatus("Open the localhost version for audio");
      return;
    }
    if (!hit) return;
    await state.engine.auditionTrack(hit, { gain: Math.max(0.08, velocity) });
  }

  function recordGridHit(hit, { velocity = velocityValue(), pressure = pressureValue() } = {}) {
    if (!hit) return;
    if (!state.gridTrackIds.includes(hit)) {
      addGridTrack?.(hit);
      renderTrackExplorer?.();
    }
    if (state.config) state.config.generatedRowsEditable = 1;
    const { barIndex, step } = recordPosition();
    const nextVelocity = Math.max(0.01, velocity);
    const options = pressure > 0 ? { pressure } : undefined;
    const bar = state.config?.patterns?.jazz?.bars?.[barIndex];
    const current = typeof readStoredHit === "function" ? readStoredHit(bar, hit, step) : null;
    rememberTakeEdit(hit, barIndex, step, current);
    setHitData(hit, step, { velocity: nextVelocity, options }, barIndex);
    selectStep(hit, step, "step", barIndex, state.intensity, undefined, {
      previewVelocity: nextVelocity,
      deferTrackPanels: true
    });
    renderStepGrid();
    setStatus(`Recorded ${trackName(hit)} · vel ${nextVelocity.toFixed(2)}`);
    updateTarget();
  }

  function normalizeKeyboardChordIntervals(intervals = [0]) {
    const out = [];
    (Array.isArray(intervals) && intervals.length ? intervals : [0]).forEach((entry) => {
      const interval = Math.round(Number(entry) || 0);
      if (!out.includes(interval)) out.push(interval);
    });
    if (!out.includes(0)) out.unshift(0);
    return out.slice(0, 8);
  }

  function recordNote(pitch, {
    velocity = velocityValue(),
    pressure = pressureValue(),
    track = selectedPerformanceTrack(),
    chordIntervals = computerKeyboardChordIntervals(),
    position = null
  } = {}) {
    const target = track ? ensureRecordedPianoRollTarget(track) : ensurePianoRollTrack();
    if (!target) return;
    const { barIndex, step } = position || recordPosition();
    const bar = state.config?.patterns?.jazz?.bars?.[barIndex];
    const current = typeof readStoredHit === "function" ? readStoredHit(bar, target, step) : null;
    let nextVelocity = velocity;
    const requestedIntervals = normalizeKeyboardChordIntervals(chordIntervals);
    let options = normalizeStepOptions({
      pitch,
      chordIntervals: requestedIntervals,
      pressure,
      attackMs: Math.round(8 + pressure * 14),
      reverbSend: 0.08,
      pianoRoll: 1
    });
    if (current?.velocity > 0.005) {
      const basePitch = Number(current.options?.pitch) || 0;
      const existingIntervals = Array.isArray(current.options?.chordIntervals)
        ? current.options.chordIntervals
        : [0];
      const pitches = new Set(existingIntervals.map((interval) => basePitch + Math.round(Number(interval) || 0)));
      requestedIntervals.forEach((interval) => pitches.add(Math.round(Number(pitch) || 0) + interval));
      const chordIntervals = Array.from(pitches)
        .map((notePitch) => notePitch - basePitch)
        .sort((a, b) => a - b);
      nextVelocity = Math.max(velocity, current.velocity);
      options = normalizeStepOptions({
        ...current.options,
        chordIntervals,
        pressure: Math.max(Number(current.options?.pressure) || 0, pressure),
        attackMs: Math.round(8 + Math.max(Number(current.options?.pressure) || 0, pressure) * 14),
        reverbSend: Math.max(Number(current.options?.reverbSend) || 0, 0.08),
        pianoRoll: 1
      });
    }
    rememberTakeEdit(target, barIndex, step, current);
    setHitData(target, step, { velocity: nextVelocity, options }, barIndex);
    selectStep(target, step, "step", barIndex, state.intensity, undefined, { previewVelocity: velocity });
    schedulePianoRollRefresh({ immediate: true });
    const chordSize = options.chordIntervals?.length || 1;
    setStatus(`${chordSize > 1 ? "Recorded chord" : `Recorded ${noteNameForPitch(pitch)} ${formatPitch(pitch)}`} · vel ${nextVelocity.toFixed(2)} to ${trackName(target)}`);
    updateTarget();
  }

  async function triggerNote(note, {
    record = isRecording(),
    velocity = velocityValue(),
    pressure = pressureValue(),
    track = selectedPerformanceTrack(),
    chordIntervals = computerKeyboardChordIntervals(),
    sourceId = "",
    hold = false
  } = {}) {
    if (!note) return;
    const targetTrack = track || selectedPerformanceTrack();
    const intervals = normalizeKeyboardChordIntervals(note.chordIntervals || chordIntervals);
    state.pianoRollLastVelocity = velocity;
    setChordActive(note.pitch, intervals, true);
    const live = addLivePianoRollNote({
      id: sourceId || "",
      track: targetTrack,
      pitch: note.pitch,
      velocity,
      pressure,
      chordIntervals: intervals
    });
    if (record) {
      recordNote(note.pitch, {
        velocity,
        pressure,
        track: targetTrack,
        chordIntervals: intervals,
        position: live ? { barIndex: live.barIndex, step: live.step } : null
      });
    }
    else {
      const chord = computerKeyboardChord();
      setStatus(targetTrack
        ? `Preview ${trackName(targetTrack)} · ${noteNameForPitch(note.pitch)} ${formatPitch(note.pitch)} · ${chord.label}`
        : `Preview ${noteNameForPitch(note.pitch)} ${formatPitch(note.pitch)} · ${chord.label}`);
    }
    if (!hold && live?.id) window.setTimeout(() => removeLivePianoRollNote(live.id), 180);
    window.setTimeout(() => setChordActive(note.pitch, intervals, false), 180);
    try {
      await previewNote(note.pitch, { velocity, pressure, track: targetTrack, chordIntervals: intervals });
    } catch (error) {
      console.warn("MIDI preview failed", error);
    }
  }

  async function triggerGridHit(hit, { record = isRecording(), velocity = velocityValue(), pressure = pressureValue() } = {}) {
    if (!hit) return;
    state.pianoRollLastVelocity = velocity;
    setGridActive(hit, true);
    if (record) recordGridHit(hit, { velocity, pressure });
    else setStatus(`Preview ${trackName(hit)}`);
    window.setTimeout(() => setGridActive(hit, false), 140);
    try {
      await previewGridHit(hit, { velocity, pressure });
    } catch (error) {
      console.warn("MIDI grid preview failed", error);
    }
  }

  function setActive(pitch, active) {
    selectedPiano?.querySelectorAll(`[data-pitch="${CSS.escape(String(pitch))}"]`).forEach((key) => {
      key.classList.toggle("is-active", active);
    });
    keyboardMap?.querySelectorAll(`[data-pitch="${CSS.escape(String(pitch))}"]`).forEach((key) => {
      key.classList.toggle("is-active", active);
    });
  }

  function setChordActive(rootPitch, intervals = [0], active) {
    normalizeKeyboardChordIntervals(intervals).forEach((interval) => setActive(rootPitch + interval, active));
  }

  function setGridActive(hit, active) {
    if (!hit) return;
    document.querySelectorAll(`.track-label[data-hit="${CSS.escape(String(hit))}"]`).forEach((row) => {
      row.classList.toggle("is-midi-triggered", active);
    });
  }

  function buildKeyboard() {
    if (!keyboardMap || keyboardMap.children.length) return;
    COMPUTER_KEY_NOTES.forEach((note) => {
      const key = document.createElement("span");
      key.className = "computer-keyboard-key";
      key.dataset.key = note.key;
      key.textContent = note.key.toUpperCase();
      keyboardMap.appendChild(key);
    });
    updateKeyboardMap();
  }

  function updateKeyboardMap() {
    const octave = computerKeyboardOctave();
    keyboardMap?.querySelectorAll(".computer-keyboard-key[data-key]").forEach((keyEl) => {
      const key = keyEl.dataset.key || "";
      const pitch = pitchForComputerKey(key, octave);
      if (pitch === null) return;
      keyEl.dataset.pitch = String(pitch);
      const midiNote = A1_MIDI_NOTE + pitch;
      const pitchClass = ((midiNote % 12) + 12) % 12;
      keyEl.classList.toggle("is-black", BLACK_NOTE_PITCH_CLASSES.has(pitchClass));
      keyEl.title = `${key.toUpperCase()} · octave ${octave} · ${noteNameForPitch(pitch)} ${formatPitch(pitch)}`;
    });
  }

  function closeKeyboardLayout() {
    document.querySelector(".keyboard-layout-popover")?.remove();
  }

  function layoutKey(label, subLabel, className = "") {
    const key = document.createElement("button");
    key.type = "button";
    key.className = `keyboard-layout-key ${className}`;
    const top = document.createElement("span");
    top.className = "keyboard-layout-key-main";
    top.textContent = label;
    const sub = document.createElement("small");
    sub.textContent = subLabel;
    key.append(top, sub);
    return key;
  }

  function appendLayoutRow(host, labelText, keys) {
    const row = document.createElement("div");
    row.className = "keyboard-layout-row";
    const label = document.createElement("span");
    label.className = "keyboard-layout-row-label";
    label.textContent = labelText;
    const keyWrap = document.createElement("div");
    keyWrap.className = "keyboard-layout-keys";
    keys.forEach((key) => keyWrap.appendChild(key));
    row.append(label, keyWrap);
    host.appendChild(row);
  }

  function showKeyboardLayout() {
    closeKeyboardLayout();
    const octave = computerKeyboardOctave();
    const chord = computerKeyboardChord();
    const popover = document.createElement("div");
    popover.className = "keyboard-layout-popover";
    const header = document.createElement("div");
    header.className = "keyboard-layout-header";
    const title = document.createElement("strong");
    title.textContent = "Keyboard Layout";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.title = "Close";
    close.addEventListener("click", closeKeyboardLayout);
    header.append(title, close);
    const body = document.createElement("div");
    body.className = "keyboard-layout-body";
    appendLayoutRow(body, "Octave", [...OCTAVE_KEY_TO_VALUE.entries()].map(([key, value]) =>
      layoutKey(key, String(value), value === octave ? "is-active" : "")
    ));
    appendLayoutRow(body, "Nudge", [
      layoutKey("←", "-Oct"),
      layoutKey("↓", "-Oct"),
      layoutKey("→", "+Oct"),
      layoutKey("↑", "+Oct")
    ]);
    appendLayoutRow(body, "Notes", COMPUTER_KEY_NOTES.map((note) => {
      const pitch = pitchForComputerKey(note.key, octave);
      return layoutKey(note.key.toUpperCase(), pitch === null ? "" : noteNameForPitch(pitch), "keyboard-layout-note-key");
    }));
    appendLayoutRow(body, "Chords", COMPUTER_KEY_CHORDS.map((item) =>
      layoutKey(item.key.toUpperCase(), item.label, item.id === chord.id ? "is-active" : "keyboard-layout-chord-key")
    ));
    popover.append(header, body);
    document.body.appendChild(popover);
    window.setTimeout(() => document.addEventListener("click", closeKeyboardLayout, { once: true }), 0);
  }

  function wireBottomPiano() {
    selectedPiano?.addEventListener("click", (event) => {
      if (!selectedPerformanceTrack() && !isPianoRollMode() && !isKeyboardArmed()) return;
      const key = event.target?.closest?.(".selected-piano-key[data-pitch]");
      if (!key) return;
      const pitch = Number(key.dataset.pitch);
      if (!Number.isFinite(pitch)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      void triggerNote({ pitch }, { record: isRecording(), velocity: velocityFromKeyEvent(event), pressure: pressureValue() });
    }, true);
  }

  function wireComputerKeyboard() {
    window.addEventListener("keydown", (event) => {
      if (!isKeyboardArmed()) return;
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (OCTAVE_KEY_TO_VALUE.has(key)) {
        event.preventDefault();
        setComputerKeyboardOctave(computerOctaveFromKey(key, computerKeyboardOctave()));
        return;
      }
      const octaveDelta = computerOctaveDeltaForKey(key);
      if (octaveDelta !== 0) {
        event.preventDefault();
        setComputerKeyboardOctave(computerKeyboardOctave() + octaveDelta);
        return;
      }
      const chord = chordForComputerKey(key);
      if (chord) {
        event.preventDefault();
        setComputerKeyboardChord(chord.id);
        return;
      }
      const note = computerNoteForKey(key);
      if (!note || activeComputerKeys.has(key)) return;
      event.preventDefault();
      const target = inputTarget();
      if (target.mode === "grid") {
        const hit = computerKeyToGridHit(key);
        if (!hit) {
          setStatus(`Key ${key.toUpperCase()} has no grid row`);
          return;
        }
        activeComputerKeys.set(key, { mode: "grid", hit });
        void triggerGridHit(hit, { record: isRecording() });
      } else {
        const intervals = computerKeyboardChordIntervals();
        const liveId = `computer:${key}`;
        activeComputerKeys.set(key, { mode: "piano", pitch: note.pitch, chordIntervals: intervals, liveId });
        void triggerNote(note, {
          record: isRecording(),
          track: target.track,
          chordIntervals: intervals,
          sourceId: liveId,
          hold: true
        });
      }
    });
    window.addEventListener("keyup", (event) => {
      const key = event.key.toLowerCase();
      const active = activeComputerKeys.get(key);
      if (!active) return;
      activeComputerKeys.delete(key);
      if (active.mode === "piano") {
        setChordActive(active.pitch, active.chordIntervals || [0], false);
        removeLivePianoRollNote(active.liveId);
      }
      if (active.mode === "grid") setGridActive(active.hit, false);
    });
  }

  function wire() {
    buildKeyboard();
    updateOutputs();
    gridModeBtn?.addEventListener("click", () => setMode(GRID_MODE));
    pianoRollModeBtn?.addEventListener("click", () => setMode(PIANO_ROLL_MODE));
    waveModeBtn?.addEventListener("click", () => setMode(WAVE_MODE));
    keyboardToggle?.addEventListener("click", () => {
      setKeyboardArmed(!isKeyboardArmed());
    });
    keyboardToggle?.addEventListener("contextmenu", (event) => {
      if (typeof showContextMenu === "function") {
        showContextMenu(event, [{ label: "Show layout", action: showKeyboardLayout }]);
      } else {
        event.preventDefault();
        showKeyboardLayout();
      }
    });
    recordToggle?.addEventListener("click", () => {
      setRecording(!isRecording());
    });
    clearTakeButton?.addEventListener("click", () => {
      clearRecordingTake();
    });
    document.querySelector("#quantize-enabled")?.addEventListener("change", updateTarget);
    document.querySelector("#quantize-value")?.addEventListener("change", updateTarget);
    setMode(state.trackEditorMode || GRID_MODE, { announce: false, rebuild: false });
    midiInput.sync();
    wireBottomPiano();
    wireComputerKeyboard();
  }

  return {
    wire,
    sync: updateTarget,
    setMode,
    setKeyboardArmed,
    setRecording,
    clearRecordingTake,
    setComputerKeyboardOctave,
    setComputerKeyboardChord,
    triggerNote,
    recordNote
  };
}
