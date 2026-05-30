/**
 * Row / step selection controller.
 *
 * Manages the active step + track selection state, the per-note inspector
 * panel DOM sync, and solo tracks. Everything here is purely UI side-effects
 * triggered by user interactions in the step grid and track explorer.
 *
 * @param {object} deps - injected dependencies (see factory call in the main file)
 */
export function createRowSelection(deps) {
  const {
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
  } = deps;

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Order a set of track ids by their position in the grid. */
  function orderBySelectedGrid(ids) {
    const order = state.gridTrackIds;
    return [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }

  // ── Step / row selection ──────────────────────────────────────────────────

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
    // A plain selection drives a single-track inspector panel. Shift-click paths
    // manage `state.selectedTracks` themselves before re-rendering.
    if (hit) {
      state.selectedTracks = [hit];
      state.trackAnchor = hit;
    }
    updateTrackClipboardButtons();
    renderTrackInspector();
    renderTrackExplorer();
  }

  function selectRow(hit, { keepTracks = false } = {}) {
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
    const tracksBefore = keepTracks ? state.selectedTracks.slice() : null;
    const anchorBefore = keepTracks ? state.trackAnchor : null;
    selectStep(hit, step, "row", barIndex, playback.activeBarIntensity ?? state.intensity);
    if (keepTracks && tracksBefore) {
      state.selectedTracks = tracksBefore.includes(hit) ? tracksBefore : [...tracksBefore, hit];
      state.trackAnchor = anchorBefore;
    }
  }

  /** Toggle a row selection: re-clicking the selected row deselects it. */
  function selectRowToggle(hit) {
    if (state.selected?.hit === hit && state.selected?.mode === "row") {
      resetSelectedPanel();
      return;
    }
    selectRow(hit);
  }

  /**
   * Shift-aware row selection. Plain click selects one track; shift-click
   * extends the inspector selection from the anchor row to the clicked row (in
   * grid order); ctrl/cmd-click toggles a single row in/out of the selection.
   */
  function selectRowWithModifiers(hit, event = {}) {
    const shift = Boolean(event.shiftKey);
    const meta = Boolean(event.metaKey || event.ctrlKey);
    if (shift && state.trackAnchor && state.gridTrackIds.includes(state.trackAnchor)) {
      const order = state.gridTrackIds;
      const a = order.indexOf(state.trackAnchor);
      const b = order.indexOf(hit);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const range = order.slice(lo, hi + 1);
        state.selectedTracks = orderBySelectedGrid(new Set(range));
        selectRow(hit, { keepTracks: true });
        renderTrackInspector();
        renderTrackExplorer();
        status.textContent = `Selected ${state.selectedTracks.length} tracks`;
        return;
      }
    }
    if (meta) {
      const set = new Set(state.selectedTracks);
      if (set.has(hit) && set.size > 1) {
        set.delete(hit);
        state.selectedTracks = orderBySelectedGrid(set);
        state.trackAnchor = state.selectedTracks[state.selectedTracks.length - 1] || null;
        // Keep the primary selection valid.
        if (state.selected?.hit === hit) selectRow(state.selectedTracks[0], { keepTracks: true });
        renderTrackInspector();
        renderTrackExplorer();
        return;
      }
      set.add(hit);
      state.selectedTracks = orderBySelectedGrid(set);
      state.trackAnchor = hit;
      selectRow(hit, { keepTracks: true });
      renderTrackInspector();
      renderTrackExplorer();
      return;
    }
    selectRowToggle(hit);
  }

  function resetSelectedPanel() {
    state.selected = null;
    state.selectedTracks = [];
    state.trackAnchor = null;
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
    updateTrackClipboardButtons();
    renderTrackInspector();
    renderTrackExplorer();
  }

  function clearSelection() {
    if (!state.selected) return;
    setHitVelocity(state.selected.hit, state.selected.step, 0);
    resetSelectedPanel();
    renderStepGrid();
  }

  // ── Solo tracks ────────────────────────────────────────────────────────────

  function renderSoloButtons() {
    document.querySelectorAll("[data-solo-track]").forEach((button) => {
      button.classList.toggle("is-active", state.soloTracks.has(button.dataset.soloTrack));
    });
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

  return {
    selectStep,
    selectRow,
    selectRowToggle,
    selectRowWithModifiers,
    orderBySelectedGrid,
    resetSelectedPanel,
    clearSelection,
    toggleSolo,
    clearSolo,
    renderSoloButtons
  };
}
