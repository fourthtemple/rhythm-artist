// Per-note (step) inspector controller.
//
// Owns everything in the note-step inspector panel: the on-screen piano
// renderer + pitch preview/choose, the velocity / pitch / effect-option
// controls (offset, attack, delay, wobble, delay-send, reverb-send), and the
// dub-echo control (which can fan a value across a whole row).
//
// It reaches the rest of the editor through the shared `state` object, the
// inspector DOM elements, and a set of injected primitives. The editor keeps
// thin hoisted wrappers so existing call sites (event wiring, render loop,
// transport playhead) are unchanged.

const PITCH_SCALE_MODES = [
  { id: "major", label: "Major", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", label: "Natural Minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "harmonicMinor", label: "Harmonic Minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: "melodicMinor", label: "Melodic Minor", intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: "dorian", label: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "phrygian", label: "Phrygian", intervals: [0, 1, 3, 5, 7, 8, 10] },
  { id: "lydian", label: "Lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: "mixolydian", label: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "locrian", label: "Locrian", intervals: [0, 1, 3, 5, 6, 8, 10] },
  { id: "majorPentatonic", label: "Major Pent", intervals: [0, 2, 4, 7, 9] },
  { id: "minorPentatonic", label: "Minor Pent", intervals: [0, 3, 5, 7, 10] },
  { id: "blues", label: "Blues", intervals: [0, 3, 5, 6, 7, 10] },
  { id: "bebopMajor", label: "Bebop Major", intervals: [0, 2, 4, 5, 7, 8, 9, 11] },
  { id: "bebopDominant", label: "Bebop Dom", intervals: [0, 2, 4, 5, 7, 9, 10, 11] },
  { id: "altered", label: "Altered", intervals: [0, 1, 3, 4, 6, 8, 10] },
  { id: "wholeTone", label: "Whole Tone", intervals: [0, 2, 4, 6, 8, 10] },
  { id: "diminished", label: "Diminished", intervals: [0, 2, 3, 5, 6, 8, 9, 11] },
  { id: "halfWhole", label: "Half-Whole", intervals: [0, 1, 3, 4, 6, 7, 9, 10] },
  { id: "augmented", label: "Augmented", intervals: [0, 3, 4, 7, 8, 11] },
  { id: "doubleHarmonic", label: "Double Harm", intervals: [0, 1, 4, 5, 7, 8, 11] },
  { id: "hungarianMinor", label: "Hungarian Min", intervals: [0, 2, 3, 6, 7, 8, 11] },
  { id: "spanishGypsy", label: "Spanish", intervals: [0, 1, 4, 5, 7, 8, 10] },
  { id: "persian", label: "Persian", intervals: [0, 1, 4, 5, 6, 8, 11] },
  { id: "arabic", label: "Arabic", intervals: [0, 2, 4, 5, 6, 8, 10] },
  { id: "neapolitanMinor", label: "Neapolitan Min", intervals: [0, 1, 3, 5, 7, 8, 11] },
  { id: "hirajoshi", label: "Hirajoshi", intervals: [0, 2, 3, 7, 8] },
  { id: "inSen", label: "In Sen", intervals: [0, 1, 5, 7, 10] },
  { id: "iwato", label: "Iwato", intervals: [0, 1, 5, 6, 10] },
  { id: "yo", label: "Yo", intervals: [0, 2, 5, 7, 9] },
  { id: "prometheus", label: "Prometheus", intervals: [0, 2, 4, 6, 9, 10] },
  { id: "chromatic", label: "Chromatic", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }
];

const PITCH_CHORD_RECIPES = [
  { id: "single", label: "1", degrees: [0] },
  { id: "triad", label: "1-3-5", degrees: [0, 2, 4] },
  { id: "seventh", label: "7", degrees: [0, 2, 4, 6] },
  { id: "ninth", label: "9", degrees: [0, 2, 4, 6, 8] },
  { id: "sus2", label: "sus2", degrees: [0, 1, 4] },
  { id: "sus4", label: "sus4", degrees: [0, 3, 4] },
  { id: "power", label: "5", intervals: [0, 7, 12] }
];

const SELECTED_PIANO_RANGE_OPTIONS = [
  { keys: 13, label: "1 oct" },
  { keys: 25, label: "2 oct" },
  { keys: 37, label: "3 oct" },
  { keys: 49, label: "4 oct" },
  { keys: 73, label: "All" }
];

/**
 * @param {object} deps
 * @param {object} deps.state Shared editor state (mutated in place).
 * @param {(msg: string) => void} deps.setStatus Status-line setter.
 * @param {boolean} deps.runningFromFile
 * @param {Element} deps.stepGrid
 * @param {Element} deps.selectedPiano
 * @param {HTMLInputElement} deps.selectedPitch
 * @param {HTMLInputElement} deps.selectedPitchNumber
 * @param {Element} deps.selectedPitchValue
 * @param {HTMLInputElement} deps.selectedVelocity
 * @param {HTMLInputElement} deps.selectedVelocityNumber
 * @param {Element} deps.selectedVelocityValue
 * @param {HTMLInputElement} deps.selectedDubEcho
 * @param {HTMLInputElement} deps.selectedDubEchoNumber
 * @param {Element} deps.selectedDubEchoValue
 * @param {Record<string, any>} deps.selectedOptionControls
 * @param {number} deps.PITCH_SLIDER_MIN
 * @param {number} deps.PITCH_SLIDER_MAX
 * @param {readonly number[]} deps.SYNTH_SCALE
 * @param {number} deps.A1_MIDI_NOTE
 * @param {Set<number>} deps.BLACK_NOTE_PITCH_CLASSES
 * @param {Record<string, number>} deps.STEP_OPTION_DEFAULTS
 * @param {(value: any, min: number, max: number, fallback?: number) => number} deps.clamp
 * @param {(options?: any) => any} deps.normalizeStepOptions
 * @param {(entry: any) => any} deps.normalizeHitEntry
 * @param {(args: any) => number} deps.sequencedBassPitchForStep
 * @param {(scaleIndex: number, scale: readonly number[]) => number} deps.scaleSemitoneForIndex
 * @param {(pitch: number) => string} deps.formatPitch
 * @param {(pitch: number) => string} deps.noteNameForPitch
 * @param {(trim: any, base: number|null) => number} deps.displayedPitchValueFor
 * @param {(displayed: any, base: number|null) => number} deps.storedPitchValueFor
 * @param {(range: any, number: any, output: any, value: number, format: (v: number) => string) => void} deps.setPairedControl
 * @param {(hit: string, step: number, barIndex?: number) => any} deps.getHitData
 * @param {(hit: string, step: number, patch: any, barIndex?: number) => void} deps.setHitData
 * @param {(hit: string, step: number, velocity: number, barIndex?: number) => void} deps.setHitVelocity
 * @param {(hit: string, step: number, mode?: string, barIndex?: number, pressure?: number) => void} deps.selectStep
 * @param {() => void} deps.renderStepGrid
 * @param {() => number} deps.activeLoopLength
 * @param {(start?: number, length?: number) => number} deps.clampLoopStart
 * @param {() => {instrument:string, velocity:number, options:any}} deps.defaultNoteState
 * @param {(velocity:number) => void} deps.setDefaultNoteVelocity
 * @param {(field:string, value:any) => any} deps.setDefaultNoteOption
 * @param {(hit: string) => string} deps.trackName
 */
export function createNoteInspector(deps) {
  const {
    state,
    setStatus,
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
    defaultNoteState = () => ({ instrument: "eightOhEightKick", velocity: 0.32, options: normalizeStepOptions() }),
    setDefaultNoteVelocity = () => {},
    setDefaultNoteOption = () => {},
    trackName,
    onPitchFocus = () => {}
  } = deps;
  let deferredStepGridTimer = 0;
  let selectedPitchScaleId = "major";
  let selectedPitchScaleRoot = 0;
  let selectedPitchChordId = "single";
  let previewChordIntervals = [0];

  function hitIndexForStep(hit, step, barIndex = state.activeBar) {
    const hits = state.config.patterns.jazz.bars[barIndex]?.[hit] || [];
    return hits
      .map(normalizeHitEntry)
      .sort((a, b) => a.step - b.step)
      .findIndex((entry) => entry.step === step);
  }

  function scaleSemitoneForIndex(scaleIndex) {
    return scaleSemitoneForIndexBase(scaleIndex, SYNTH_SCALE);
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
    const base = hit === "bass" ? bassBasePitch(step, barIndex) : null;
    return displayedPitchValueFor(options?.pitch, base);
  }

  function storedPitchForDisplay(hit, step, displayedPitch, barIndex = state.activeBar) {
    const base = hit === "bass" ? bassBasePitch(step, barIndex) : null;
    return storedPitchValueFor(displayedPitch, base);
  }

  function selectedBarIndex() {
    return Math.max(0, Math.round(Number(state.selected?.bar ?? state.activeBar) || 0));
  }

  function selectedScaleMode() {
    return PITCH_SCALE_MODES.find((scale) => scale.id === selectedPitchScaleId) || PITCH_SCALE_MODES[0];
  }

  function selectedChordRecipe() {
    return PITCH_CHORD_RECIPES.find((recipe) => recipe.id === selectedPitchChordId) || PITCH_CHORD_RECIPES[0];
  }

  function scaleIntervalAt(scale, degree) {
    const intervals = scale?.intervals?.length ? scale.intervals : PITCH_SCALE_MODES[0].intervals;
    const safeDegree = Math.max(0, Math.round(Number(degree) || 0));
    const octave = Math.floor(safeDegree / intervals.length);
    return intervals[safeDegree % intervals.length] + octave * 12;
  }

  function scaleDegreeForPitch(scale, pitch, tonicPitch) {
    const pc = ((Math.round(pitch - tonicPitch) % 12) + 12) % 12;
    const index = scale.intervals.findIndex((interval) => ((interval % 12) + 12) % 12 === pc);
    return index >= 0 ? index : 0;
  }

  function normalizeChordIntervalsForUi(intervals) {
    return normalizeStepOptions({ chordIntervals: intervals }).chordIntervals;
  }

  function chordIntervalsForRecipe(recipe, scale = selectedScaleMode(), rootPitch = selectedPitchScaleRoot, tonicPitch = selectedPitchScaleRoot) {
    if (Array.isArray(recipe?.intervals)) return normalizeChordIntervalsForUi(recipe.intervals);
    const degrees = Array.isArray(recipe?.degrees) ? recipe.degrees : [0];
    const rootDegree = scaleDegreeForPitch(scale, rootPitch, tonicPitch);
    const root = scaleIntervalAt(scale, rootDegree);
    return normalizeChordIntervalsForUi(degrees.map((degree) => scaleIntervalAt(scale, rootDegree + degree) - root));
  }

  function selectedChordIntervals(options = selectedPreviewOptions()) {
    return normalizeChordIntervalsForUi(options?.chordIntervals);
  }

  function octaveForPitch(pitch) {
    const midiNote = A1_MIDI_NOTE + Math.round(Number(pitch) || 0);
    return Math.floor(midiNote / 12) - 1;
  }

  function pitchForOctave(octave) {
    return ((Math.round(Number(octave) || 0) + 1) * 12) - A1_MIDI_NOTE;
  }

  function selectedPianoRangeKeys() {
    const total = PITCH_SLIDER_MAX - PITCH_SLIDER_MIN + 1;
    const requested = Math.round(Number(state.selectedPianoRangeKeys) || 25);
    const option = SELECTED_PIANO_RANGE_OPTIONS.find((item) => item.keys === requested)
      || SELECTED_PIANO_RANGE_OPTIONS[1]
      || SELECTED_PIANO_RANGE_OPTIONS[0];
    const keys = Math.min(total, option.keys);
    state.selectedPianoRangeKeys = keys;
    return keys;
  }

  function visiblePianoRange(octave, keyCount = selectedPianoRangeKeys()) {
    const visible = Math.min(keyCount, PITCH_SLIDER_MAX - PITCH_SLIDER_MIN + 1);
    const maxStart = Math.max(PITCH_SLIDER_MIN, PITCH_SLIDER_MAX - visible + 1);
    const start = Math.round(clamp(pitchForOctave(octave), PITCH_SLIDER_MIN, maxStart, PITCH_SLIDER_MIN));
    return {
      start,
      end: Math.min(PITCH_SLIDER_MAX, start + visible - 1)
    };
  }

  function octaveStartRange(keyCount = selectedPianoRangeKeys()) {
    const visible = Math.min(keyCount, PITCH_SLIDER_MAX - PITCH_SLIDER_MIN + 1);
    const maxStart = Math.max(PITCH_SLIDER_MIN, PITCH_SLIDER_MAX - visible + 1);
    return {
      min: octaveForPitch(PITCH_SLIDER_MIN),
      max: octaveForPitch(maxStart)
    };
  }

  function octaveRangeLabel(octave, keyCount = selectedPianoRangeKeys()) {
    const { start, end } = visiblePianoRange(octave, keyCount);
    const startOctave = octaveForPitch(start);
    const endOctave = octaveForPitch(end);
    return startOctave === endOctave ? `O${startOctave}` : `O${startOctave}-${endOctave}`;
  }

  function octaveRangeTooltip(octave, keyCount, selectedPitch) {
    const { start, end } = visiblePianoRange(octave, keyCount);
    return [
      `Selected note: ${noteNameForPitch(selectedPitch)} ${formatPitch(selectedPitch)}`,
      `Visible octave range: ${octaveRangeLabel(octave, keyCount)}`,
      `Keys shown: ${noteNameForPitch(start)} to ${noteNameForPitch(end)}`,
      "Mouse wheel shifts the selected note/chord root by octave."
    ].join("\n");
  }

  function keyboardSizeTooltip(keyCount) {
    const option = SELECTED_PIANO_RANGE_OPTIONS.find((range) => range.keys === keyCount);
    return [
      `Keyboard size: ${option?.label || `${keyCount} keys`}`,
      `${keyCount} keys visible.`,
      "Mouse wheel changes the keyboard size."
    ].join("\n");
  }

  function paintSelectedPitchControl(displayedPitch) {
    const min = Number(selectedPitch.min);
    const max = Number(selectedPitch.max);
    const pitch = Math.round(clamp(
      displayedPitch,
      Number.isFinite(min) ? min : PITCH_SLIDER_MIN,
      Number.isFinite(max) ? max : PITCH_SLIDER_MAX,
      0
    ));
    setPairedControl(selectedPitch, selectedPitchNumber, selectedPitchValue, pitch, formatPitch);
    return pitch;
  }

  function isScaleTone(rootPitch, notePitch, scale = selectedScaleMode()) {
    const pc = ((Math.round(notePitch - rootPitch) % 12) + 12) % 12;
    return scale.intervals.some((interval) => ((interval % 12) + 12) % 12 === pc);
  }

  function renderSelectedPiano(displayedPitch = null, basePitch = null) {
    if (!selectedPiano) return;
    selectedPiano.innerHTML = "";
    const pitch = Number(displayedPitch);
    if (!Number.isFinite(pitch)) {
      selectedPiano.classList.add("is-empty");
      selectedPiano.classList.remove("is-scale-mode");
      selectedPiano.textContent = "No sounding note";
      return;
    }
    selectedPiano.classList.remove("is-empty");
    const roundedPitch = Math.round(pitch);
    const roundedBase = Number.isFinite(Number(basePitch)) ? Math.round(Number(basePitch)) : null;
    const previewOptions = selectedPreviewOptions();
    const chordIntervals = selectedChordIntervals(previewOptions);
    const activeScale = selectedScaleMode();
    const scaleRootPitch = roundedPitch;
    selectedPitchScaleRoot = scaleRootPitch;
    selectedPiano.classList.add("is-scale-mode");
    const noteWrap = document.createElement("div");
    noteWrap.className = "selected-piano-info";
    const label = document.createElement("span");
    label.className = "selected-piano-note";
    label.textContent = `${noteNameForPitch(roundedPitch)} ${formatPitch(roundedPitch)}`;
    label.title = roundedBase === null
      ? "Selected pitch"
      : `Base ${noteNameForPitch(roundedBase)} ${formatPitch(roundedBase)} plus saved trim ${formatPitch(roundedPitch - roundedBase)}`;
    const pitchOctave = octaveForPitch(roundedPitch);
    const visibleKeyCount = selectedPianoRangeKeys();
    const { min: minOctave, max: maxOctave } = octaveStartRange(visibleKeyCount);
    if (!Number.isFinite(Number(state.selectedPianoOctave)) || state.selectedPianoFollowPitch !== false) {
      state.selectedPianoOctave = pitchOctave;
    }
    const visibleOctave = Math.round(clamp(state.selectedPianoOctave, minOctave, maxOctave, pitchOctave));
    state.selectedPianoOctave = visibleOctave;
    if (typeof CustomEvent === "function") {
      selectedPiano.dispatchEvent(new CustomEvent("selectedpianooctavechange", {
        bubbles: true,
        detail: {
          octave: visibleOctave,
          rangeKeys: visibleKeyCount
        }
      }));
    }
    const octaveTooltip = octaveRangeTooltip(visibleOctave, visibleKeyCount, roundedPitch);
    const sizeTooltip = keyboardSizeTooltip(visibleKeyCount);
    const pianoControlTooltip = `${octaveTooltip}\n${sizeTooltip}`;
    noteWrap.title = pianoControlTooltip;
    label.title = roundedBase === null
      ? octaveTooltip
      : `${octaveTooltip}\nBase: ${noteNameForPitch(roundedBase)} ${formatPitch(roundedBase)}, trim ${formatPitch(roundedPitch - roundedBase)}`;
    const octaveSelect = document.createElement("select");
    octaveSelect.className = "selected-piano-octave-wheel";
    octaveSelect.title = pianoControlTooltip;
    octaveSelect.setAttribute("aria-label", "Visible keyboard octave");
    for (let octave = minOctave; octave <= maxOctave; octave += 1) {
      const option = document.createElement("option");
      option.value = String(octave);
      option.textContent = octaveRangeLabel(octave, visibleKeyCount);
      option.selected = octave === visibleOctave;
      octaveSelect.appendChild(option);
    }
    const setVisibleOctave = (octave) => {
      const nextOctave = Math.round(clamp(octave, minOctave, maxOctave, visibleOctave));
      const octaveDelta = nextOctave - visibleOctave;
      state.selectedPianoOctave = nextOctave;
      if (octaveDelta !== 0) {
        const nextPitch = Math.round(clamp(
          roundedPitch + octaveDelta * 12,
          PITCH_SLIDER_MIN,
          PITCH_SLIDER_MAX,
          roundedPitch
        ));
        void choosePianoPitch(nextPitch);
        return;
      }
      state.selectedPianoFollowPitch = false;
      renderSelectedPiano(roundedPitch, roundedBase);
    };
    octaveSelect.addEventListener("change", () => setVisibleOctave(Number(octaveSelect.value)));
    octaveSelect.addEventListener("wheel", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      if (now - (state.selectedPianoOctaveWheelAt || 0) < 140) return;
      state.selectedPianoOctaveWheelAt = now;
      setVisibleOctave(visibleOctave + (event.deltaY < 0 ? 1 : -1));
    }, { passive: false });
    const rangeSelect = document.createElement("select");
    rangeSelect.className = "selected-piano-range-wheel";
    rangeSelect.title = pianoControlTooltip;
    rangeSelect.setAttribute("aria-label", "Visible keyboard size");
    SELECTED_PIANO_RANGE_OPTIONS.forEach((range) => {
      const option = document.createElement("option");
      option.value = String(range.keys);
      option.textContent = range.label;
      option.selected = range.keys === visibleKeyCount;
      rangeSelect.appendChild(option);
    });
    const setVisibleRangeKeys = (keyCount) => {
      state.selectedPianoRangeKeys = Math.round(Number(keyCount) || visibleKeyCount);
      state.selectedPianoFollowPitch = false;
      const nextBounds = octaveStartRange(state.selectedPianoRangeKeys);
      state.selectedPianoOctave = Math.round(clamp(visibleOctave, nextBounds.min, nextBounds.max, nextBounds.min));
      renderSelectedPiano(roundedPitch, roundedBase);
    };
    rangeSelect.addEventListener("change", () => {
      setVisibleRangeKeys(rangeSelect.value);
    });
    rangeSelect.addEventListener("wheel", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      if (now - (state.selectedPianoRangeWheelAt || 0) < 140) return;
      state.selectedPianoRangeWheelAt = now;
      const currentIndex = SELECTED_PIANO_RANGE_OPTIONS.findIndex((range) => range.keys === visibleKeyCount);
      const safeIndex = currentIndex >= 0 ? currentIndex : 1;
      const nextIndex = Math.max(0, Math.min(
        SELECTED_PIANO_RANGE_OPTIONS.length - 1,
        safeIndex + (event.deltaY < 0 ? 1 : -1)
      ));
      setVisibleRangeKeys(SELECTED_PIANO_RANGE_OPTIONS[nextIndex].keys);
    }, { passive: false });
    noteWrap.addEventListener("wheel", (event) => {
      if (!event.target?.closest?.(".selected-piano-octave-wheel, .selected-piano-range-wheel")) return;
      event.preventDefault();
      event.stopPropagation();
    });
    noteWrap.append(label, octaveSelect, rangeSelect);
    const keyboardWrap = document.createElement("div");
    keyboardWrap.className = "selected-piano-keyboard";
    const keys = document.createElement("div");
    keys.className = "selected-piano-keys";
    const { start, end } = visiblePianoRange(visibleOctave, visibleKeyCount);
    keys.style.setProperty("--selected-piano-key-count", String(end - start + 1));
    for (let note = start; note <= end; note += 1) {
      const key = document.createElement("span");
      const midiNote = A1_MIDI_NOTE + note;
      key.className = "selected-piano-key";
      key.dataset.pitch = String(note);
      key.role = "button";
      key.tabIndex = 0;
      const pitchClass = ((midiNote % 12) + 12) % 12;
      key.classList.toggle("is-black", BLACK_NOTE_PITCH_CLASSES.has(pitchClass));
      key.classList.toggle("is-octave-root", pitchClass === 0);
      key.classList.toggle("is-active", note === roundedPitch);
      key.classList.toggle("is-base", roundedBase !== null && note === roundedBase && note !== roundedPitch);
      key.classList.toggle("is-scale-tone", isScaleTone(scaleRootPitch, note, activeScale));
      key.classList.toggle("is-chord-tone", chordIntervals.some((interval) => note === roundedPitch + interval));
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
    keyboardWrap.append(keys);
    selectedPiano.append(noteWrap, keyboardWrap);
    const scalePanel = document.createElement("div");
    scalePanel.className = "selected-piano-scale-panel";
    const scaleSelect = document.createElement("select");
    scaleSelect.className = "selected-piano-scale-select";
    scaleSelect.title = "Scale";
    PITCH_SCALE_MODES.forEach((scale) => {
      const option = document.createElement("option");
      option.value = scale.id;
      option.textContent = scale.label;
      option.selected = scale.id === activeScale.id;
      scaleSelect.appendChild(option);
    });
    scaleSelect.addEventListener("change", () => {
      selectedPitchScaleId = scaleSelect.value;
      renderSelectedPiano(roundedPitch, roundedBase);
    });
    const chordButtons = document.createElement("div");
    chordButtons.className = "selected-piano-chords";
    PITCH_CHORD_RECIPES.forEach((recipe) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = recipe.label;
      button.title = `${activeScale.label} ${recipe.label}`;
      button.className = "selected-piano-chord";
      button.dataset.midiParam = `selected.chord.${recipe.id}`;
      button.dataset.midiLabel = `Chord ${recipe.label}`;
      button.dataset.midiAction = "click";
      button.classList.toggle("is-active", recipe.id === selectedPitchChordId);
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void choosePianoChord(recipe.id);
      });
      chordButtons.appendChild(button);
    });
    scalePanel.append(scaleSelect, chordButtons);
    selectedPiano.append(scalePanel);
  }

  function selectedPreviewOptions() {
    if (!state.selected) {
      return normalizeStepOptions({
        ...(defaultNoteState()?.options || {}),
        chordIntervals: previewChordIntervals
      });
    }
    return normalizeStepOptions(getHitData(state.selected.hit, state.selected.step, selectedBarIndex()).options);
  }

  function selectedPreviewTrack() {
    if (state.selected?.hit) return state.selected.hit;
    if (Array.isArray(state.selectedTracks) && state.selectedTracks[0]) return state.selectedTracks[0];
    return defaultNoteState()?.instrument || "eightOhEightKick";
  }

  function selectedPreviewVelocity() {
    if (state.selected?.hit && Number.isFinite(Number(state.selected.step))) {
      const hitData = getHitData(state.selected.hit, state.selected.step, selectedBarIndex());
      if (hitData?.velocity > 0.005) return hitData.velocity;
    }
    return clamp(defaultNoteState()?.velocity, 0.02, 0.9, 0.32);
  }

  async function previewPianoPitch(displayedPitch, effectOptions = selectedPreviewOptions()) {
    if (runningFromFile) {
      setStatus("Open the localhost version for audio");
      return;
    }
    const pitch = Number(displayedPitch);
    if (!Number.isFinite(pitch)) return;
    const options = normalizeStepOptions(effectOptions);
    await state.engine.auditionPitchedTrack(selectedPreviewTrack(), pitch, {
      gain: selectedPreviewVelocity(),
      pressure: options.pressure,
      chordIntervals: selectedChordIntervals(options),
      step: Number.isFinite(Number(state.selected?.step)) ? Number(state.selected.step) : (state.playheadStep ?? 0),
      phraseBar: selectedBarIndex(),
      durationSteps: options.durationSteps,
      optionsRaw: options
    });
  }

  async function choosePianoChord(recipeId) {
    const recipe = PITCH_CHORD_RECIPES.find((item) => item.id === recipeId) || PITCH_CHORD_RECIPES[1];
    const rootPitch = Math.round(clamp(selectedPitch.value, PITCH_SLIDER_MIN, PITCH_SLIDER_MAX, 0));
    selectedPitchScaleRoot = rootPitch;
    const intervals = chordIntervalsForRecipe(recipe, selectedScaleMode(), rootPitch, rootPitch);
    selectedPitchChordId = recipe.id;
    previewChordIntervals = intervals;
    const previewOptions = normalizeStepOptions({
      ...selectedPreviewOptions(),
      chordIntervals: intervals
    });
    if (ensureSelectedFromDom() && !selectedPitch.disabled) {
      updateSelectedOption("chordIntervals", intervals, { renderGrid: true });
      renderSelectedPiano(
        rootPitch,
        state.selected?.hit === "bass" ? bassBasePitch(state.selected.step, selectedBarIndex()) : null
      );
    } else {
      setDefaultNoteOption("chordIntervals", intervals);
      renderSelectedPiano(rootPitch, null);
    }
    const noteList = intervals.map((interval) => noteNameForPitch(rootPitch + interval)).join(" ");
    setStatus(`${selectedScaleMode().label} ${recipe.label}: ${noteList}`);
    await previewPianoPitch(rootPitch, previewOptions);
  }

  async function choosePianoPitch(displayedPitch) {
    const pitch = paintSelectedPitchControl(displayedPitch);
    state.selectedPianoFollowPitch = true;
    state.selectedPianoOctave = octaveForPitch(pitch);
    selectedPitchScaleRoot = pitch;
    const chordIntervals = chordIntervalsForRecipe(selectedChordRecipe(), selectedScaleMode(), pitch, pitch);
    const noteList = chordIntervals.map((interval) => noteNameForPitch(pitch + interval)).join(" ");
    const statusText = selectedChordRecipe().id === "single"
      ? `Preview pitch ${noteNameForPitch(pitch)} ${formatPitch(pitch)}`
      : `${selectedScaleMode().label} ${selectedChordRecipe().label}: ${noteList}`;
    if (!ensureSelectedFromDom()) {
      previewChordIntervals = chordIntervals;
      setDefaultNoteOption("pitch", pitch);
      setDefaultNoteOption("chordIntervals", chordIntervals);
      renderSelectedPiano(pitch, null);
      setStatus(statusText);
      await previewPianoPitch(pitch, normalizeStepOptions({
        ...selectedPreviewOptions(),
        pitch,
        chordIntervals
      }));
      return;
    }
    if (!selectedPitch.disabled) {
      setSelectedOptionFromControl("pitch", pitch);
      updateSelectedOption("chordIntervals", chordIntervals, { renderGrid: true });
      previewChordIntervals = chordIntervals;
      renderSelectedPiano(
        pitch,
        state.selected?.hit === "bass" ? bassBasePitch(state.selected.step, selectedBarIndex()) : null
      );
    } else {
      previewChordIntervals = chordIntervals;
      renderSelectedPiano(pitch, null);
    }
    await previewPianoPitch(pitch, normalizeStepOptions({
      ...selectedPreviewOptions(),
      chordIntervals
    }));
    setStatus(statusText);
  }

  function syncSelectedPitchDisplay(barIndex = selectedBarIndex()) {
    if (!state.selected) return;
    const { hit, step } = state.selected;
    const hitData = getHitData(hit, step, barIndex);
    if (hitData.velocity <= 0.005) {
      const showDefaultPitch = state.trackEditorMode === "pianoRoll";
      selectedPitch.min = String(PITCH_SLIDER_MIN);
      selectedPitch.max = String(PITCH_SLIDER_MAX);
      selectedPitchNumber.min = selectedPitch.min;
      selectedPitchNumber.max = selectedPitch.max;
      selectedPitch.value = "0";
      selectedPitchNumber.value = "0";
      selectedPitchValue.textContent = showDefaultPitch ? formatPitch(0) : "-";
      selectedPitch.title = showDefaultPitch ? "Default pitch" : "No note on this step.";
      renderSelectedPiano(showDefaultPitch ? 0 : null);
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

  function ensureSelectedFromDom() {
    if (state.selected) return true;
    const selectedButton = stepGrid.querySelector(".step-button.is-selected");
    if (!selectedButton) return false;
    state.selected = {
      hit: selectedButton.dataset.hit,
      step: Number(selectedButton.dataset.step),
      mode: "step",
      generated: selectedButton.dataset.type === "generated",
      bar: state.activeBar + Number(selectedButton.dataset.seg ?? 0)
    };
    return true;
  }

  function maybeRenderStepGrid(options = {}) {
    if (options.renderGrid === "defer") {
      if (typeof window === "undefined") {
        renderStepGrid();
        return;
      }
      window.clearTimeout(deferredStepGridTimer);
      deferredStepGridTimer = window.setTimeout(() => {
        deferredStepGridTimer = 0;
        renderStepGrid();
      }, 90);
      return;
    }
    if (options.renderGrid) renderStepGrid();
  }

  function paintSelectedVelocity(value, { syncKnob = true } = {}) {
    const velocity = clamp(value, 0, 0.9, 0);
    const rounded = Number(velocity.toFixed(2));
    selectedVelocity.value = String(rounded);
    selectedVelocityNumber.value = String(rounded);
    selectedVelocityValue.textContent = rounded.toFixed(2);
    if (syncKnob) selectedVelocity.__syncRotaryControl?.();
    return velocity;
  }

  function updateSelectedOption(field, value, options = {}) {
    if (!ensureSelectedFromDom()) return;
    const barIndex = selectedBarIndex();
    setHitData(state.selected.hit, state.selected.step, {
      options: { [field]: value }
    }, barIndex);
    maybeRenderStepGrid(options);
  }

  function soundingStepForRow(hit, playheadStep, barIndex = state.activeBar) {
    const step = Math.round(clamp(playheadStep, 0, 15, 0));
    for (let offset = 0; offset < 16; offset += 1) {
      const candidate = (step - offset + 16) % 16;
      if (getHitData(hit, candidate, barIndex).velocity > 0.005) return candidate;
    }
    return step;
  }

  function setSelectedVelocityFromControl(value = selectedVelocity.value, options = {}) {
    if (!ensureSelectedFromDom()) {
      const velocity = paintSelectedVelocity(value, { syncKnob: !options.live });
      if (!options.live) setDefaultNoteVelocity(velocity);
      return;
    }
    const barIndex = selectedBarIndex();
    const velocity = paintSelectedVelocity(value, { syncKnob: !options.live });
    if (options.live) {
      return;
    }
    setHitVelocity(state.selected.hit, state.selected.step, velocity, barIndex);
    maybeRenderStepGrid(options);
  }

  function setSelectedOptionFromControl(field, value, options = {}) {
    let number = Number(value);
    const barIndex = selectedBarIndex();
    if (field === "pitch" && state.selected) {
      const displayedPitch = paintSelectedPitchControl(number);
      onPitchFocus(displayedPitch, { track: state.selected.hit });
      number = storedPitchForDisplay(state.selected.hit, state.selected.step, displayedPitch, barIndex);
      renderSelectedPiano(
        displayedPitch,
        state.selected.hit === "bass" ? bassBasePitch(state.selected.step, barIndex) : null
      );
    } else if (selectedOptionControls[field]) {
      const control = selectedOptionControls[field];
      number = control.step >= 1
        ? Math.round(clamp(number, control.min, control.max, STEP_OPTION_DEFAULTS[field] ?? 0))
        : clamp(number, control.min, control.max, STEP_OPTION_DEFAULTS[field] ?? 0);
      setPairedControl(control.range, control.number, control.output, number, control.format);
    }
    if (!state.selected && !ensureSelectedFromDom()) {
      if (field === "pitch") {
        number = paintSelectedPitchControl(number);
        onPitchFocus(number);
        renderSelectedPiano(number, null);
      }
      setDefaultNoteOption(field, number);
      return;
    }
    updateSelectedOption(field, number, options);
  }

  function selectedDubEchoAmount(options = {}) {
    return Number(clamp(options.dubEcho, 0, 1, 0).toFixed(2));
  }

  function syncSelectedDubEchoDisplay(options = null) {
    const nextOptions = options || (state.selected ? getHitData(state.selected.hit, state.selected.step, selectedBarIndex()).options : {});
    const amount = selectedDubEchoAmount(nextOptions);
    setPairedControl(selectedDubEcho, selectedDubEchoNumber, selectedDubEchoValue, amount, (next) => next.toFixed(2));
  }

  function setSelectedDubEchoFromControl(value = selectedDubEcho.value, options = {}) {
    if (!ensureSelectedFromDom()) {
      const amount = clamp(value, 0, 1, 0);
      setPairedControl(selectedDubEcho, selectedDubEchoNumber, selectedDubEchoValue, Number(amount.toFixed(2)), (next) => next.toFixed(2));
      if (!options.live) setDefaultNoteOption("dubEcho", Number(amount.toFixed(2)));
      return;
    }
    const hit = state.selected.hit;
    const selectedBar = selectedBarIndex();
    const amount = clamp(value, 0, 1, 0);
    setPairedControl(selectedDubEcho, selectedDubEchoNumber, selectedDubEchoValue, Number(amount.toFixed(2)), (next) => next.toFixed(2));
    const patch = { dubEcho: Number(amount.toFixed(2)) };
    if (state.selected.mode === "row") {
      const length = activeLoopLength() || 1;
      const start = activeLoopLength()
        ? clampLoopStart(state.loopBarIndex, length)
        : selectedBar;
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
        setStatus(`${trackName(hit)} row has no notes`);
        return;
      }
      setPairedControl(selectedDubEcho, selectedDubEchoNumber, selectedDubEchoValue, Number(amount.toFixed(2)), (next) => next.toFixed(2));
      maybeRenderStepGrid(options);
      if (!options.live) setStatus(`Dub echo ${amount.toFixed(2)} on ${applied} ${trackName(hit)} notes`);
      return;
    }
    const current = getHitData(hit, state.selected.step, selectedBar);
    if (current.velocity <= 0.005) {
      setStatus("Select a note with volume first");
      return;
    }
    setHitData(hit, state.selected.step, { options: patch }, selectedBar);
    setPairedControl(selectedDubEcho, selectedDubEchoNumber, selectedDubEchoValue, Number(amount.toFixed(2)), (next) => next.toFixed(2));
    maybeRenderStepGrid(options);
    if (!options.live) setStatus(`Dub echo ${amount.toFixed(2)} on ${trackName(hit)} ${state.selected.step + 1}`);
  }

  return {
    bassBasePitch,
    displayedPitchForHit,
    storedPitchForDisplay,
    renderSelectedPiano,
    selectedPreviewOptions,
    previewPianoPitch,
    choosePianoPitch,
    syncSelectedPitchDisplay,
    ensureSelectedFromDom,
    updateSelectedOption,
    soundingStepForRow,
    setSelectedVelocityFromControl,
    setSelectedOptionFromControl,
    selectedDubEchoAmount,
    syncSelectedDubEchoDisplay,
    setSelectedDubEchoFromControl
  };
}
