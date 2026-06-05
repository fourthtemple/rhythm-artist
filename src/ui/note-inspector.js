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
 * @param {number} deps.SYNTH_ROOT_HZ
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
  } = deps;

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
    return normalizeStepOptions(getHitData(state.selected.hit, state.selected.step, selectedBarIndex()).options);
  }

  async function previewPianoPitch(displayedPitch, effectOptions = selectedPreviewOptions()) {
    if (runningFromFile) {
      setStatus("Open the localhost version for audio");
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
    setStatus(`Preview pitch ${noteNameForPitch(displayedPitch)} ${formatPitch(displayedPitch)}`);
  }

  function syncSelectedPitchDisplay(barIndex = selectedBarIndex()) {
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

  function updateSelectedOption(field, value) {
    if (!ensureSelectedFromDom()) return;
    const barIndex = selectedBarIndex();
    setHitData(state.selected.hit, state.selected.step, {
      options: { [field]: value }
    }, barIndex);
    selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step", barIndex);
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
    const barIndex = selectedBarIndex();
    const velocity = clamp(value, 0, 0.9, 0);
    setPairedControl(selectedVelocity, selectedVelocityNumber, selectedVelocityValue, Number(velocity.toFixed(2)), (next) => next.toFixed(2));
    setHitVelocity(state.selected.hit, state.selected.step, velocity, barIndex);
    selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step", barIndex);
    renderStepGrid();
  }

  function setSelectedOptionFromControl(field, value) {
    let number = Number(value);
    const barIndex = selectedBarIndex();
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
      number = storedPitchForDisplay(state.selected.hit, state.selected.step, displayedPitch, barIndex);
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
    const nextOptions = options || (state.selected ? getHitData(state.selected.hit, state.selected.step, selectedBarIndex()).options : {});
    const amount = selectedDubEchoAmount(nextOptions);
    setPairedControl(selectedDubEcho, selectedDubEchoNumber, selectedDubEchoValue, amount, (next) => next.toFixed(2));
  }

  function setSelectedDubEchoFromControl(value = selectedDubEcho.value) {
    if (!ensureSelectedFromDom()) {
      setStatus("Select a note or row first");
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
      selectStep(hit, state.selected.step, "row", selectedBar);
      setPairedControl(selectedDubEcho, selectedDubEchoNumber, selectedDubEchoValue, Number(amount.toFixed(2)), (next) => next.toFixed(2));
      renderStepGrid();
      setStatus(`Dub echo ${amount.toFixed(2)} on ${applied} ${trackName(hit)} notes`);
      return;
    }
    const current = getHitData(hit, state.selected.step, selectedBar);
    if (current.velocity <= 0.005) {
      setStatus("Select a note with volume first");
      return;
    }
    setHitData(hit, state.selected.step, { options: patch }, selectedBar);
    selectStep(hit, state.selected.step, state.selected.mode || "step", selectedBar);
    setPairedControl(selectedDubEcho, selectedDubEchoNumber, selectedDubEchoValue, Number(amount.toFixed(2)), (next) => next.toFixed(2));
    renderStepGrid();
    setStatus(`Dub echo ${amount.toFixed(2)} on ${trackName(hit)} ${state.selected.step + 1}`);
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
