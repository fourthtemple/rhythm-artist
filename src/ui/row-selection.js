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
    DEFAULT_VELOCITY = {},
    setPairedControl, formatPitch,
    getHitData, setHitVelocity,
    syncSelectedPitchDisplay, syncSelectedDubEchoDisplay, renderSelectedPiano,
    soundingStepForRow,
    updateTrackClipboardButtons,
    renderTrackInspector, renderTrackExplorer,
    renderStepGrid,
    previewConfig
  } = deps;
  let deferredTrackPanelRaf = 0;
  let deferredTrackPanelTimer = 0;

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Order a set of track ids by their position in the grid. */
  function orderBySelectedGrid(ids) {
    const order = state.gridTrackIds;
    return [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }

  function formatStepLabel(step) {
    const value = Number(step) + 1;
    return Number.isInteger(value) ? String(value).padStart(2, "0") : value.toFixed(2).replace(/\.?0+$/, "");
  }

  function defaultVelocityFor(hit, fallback = 0.5) {
    const baseHit = String(hit || "").split("~")[0];
    const value = DEFAULT_VELOCITY[hit] ?? DEFAULT_VELOCITY[baseHit] ?? fallback;
    const number = Number(value);
    return Math.max(0, Math.min(1, Number.isFinite(number) ? number : fallback));
  }

  function paintSelectedVelocity(value) {
    const velocity = Math.max(0, Math.min(1, Number(value) || 0));
    const rounded = Number(velocity.toFixed(2));
    const text = rounded.toFixed(2);
    selectedVelocity.disabled = false;
    selectedVelocityNumber.disabled = false;
    selectedVelocity.value = String(rounded);
    selectedVelocityNumber.value = String(rounded);
    selectedVelocityValue.textContent = text;
    selectedVelocity.__syncRotaryControl?.();
  }

  function renderTrackPanels() {
    renderTrackInspector();
    renderTrackExplorer();
  }

  function renderTrackPanelsDeferred() {
    if (typeof window === "undefined") {
      renderTrackPanels();
      return;
    }
    if (deferredTrackPanelRaf) {
      window.cancelAnimationFrame(deferredTrackPanelRaf);
      deferredTrackPanelRaf = 0;
    }
    if (deferredTrackPanelTimer) {
      window.clearTimeout(deferredTrackPanelTimer);
      deferredTrackPanelTimer = 0;
    }
    deferredTrackPanelRaf = window.requestAnimationFrame(() => {
      deferredTrackPanelRaf = 0;
      deferredTrackPanelTimer = window.setTimeout(() => {
        deferredTrackPanelTimer = 0;
        renderTrackPanels();
      }, 0);
    });
  }

  function renderTrackPanelsMaybe(options = {}) {
    if (options.deferTrackPanels) renderTrackPanelsDeferred();
    else renderTrackPanels();
  }

  // ── Step / row selection ──────────────────────────────────────────────────

  function selectStep(hit, step, mode = "step", barIndex = state.activeBar, pressure = state.intensity, generated = !PATTERN_ROW_IDS.has(hit), selectOptions = {}) {
    const selectedBar = Math.max(0, Math.round(Number(barIndex) || 0));
    state.selected = { hit, step, mode, generated, bar: selectedBar };
    const hitData = getHitData(hit, step, selectedBar);
    const { velocity, options } = hitData;
    selectedLabel.textContent = mode === "row"
      ? `${hit} row · ${formatStepLabel(step)}${hitData.generated ? ` · ${hitData.label || "generated"}` : ""}`
      : `${hit} ${formatStepLabel(step)}${hitData.generated && hitData.label ? ` · ${hitData.label}` : ""}`;
    selectedControls.forEach((control) => {
      control.disabled = hitData.generated && state.config.generatedRowsEditable < 0.5;
    });
    const displayVelocity = mode === "row" && velocity <= 0.005 ? defaultVelocityFor(hit) : velocity;
    setPairedControl(selectedVelocity, selectedVelocityNumber, selectedVelocityValue, displayVelocity, (next) => next.toFixed(2));
    syncSelectedPitchDisplay(selectedBar);
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
    renderTrackPanelsMaybe(selectOptions);
  }

  function selectRow(hit, { keepTracks = false, deferTrackPanels = false } = {}) {
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
    selectStep(hit, step, "row", barIndex, playback.activeBarIntensity ?? state.intensity, undefined, { deferTrackPanels });
    if (keepTracks && tracksBefore) {
      state.selectedTracks = tracksBefore.includes(hit) ? tracksBefore : [...tracksBefore, hit];
      state.trackAnchor = anchorBefore;
    }
  }

  function previewRowSelectionControls(hit) {
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
    const hitData = getHitData(hit, step, barIndex);
    selectedLabel.textContent = `${hit} row · ${formatStepLabel(step)}${hitData.generated ? ` · ${hitData.label || "generated"}` : ""}`;
    selectedControls.forEach((control) => {
      control.disabled = hitData.generated && state.config.generatedRowsEditable < 0.5;
    });
    const previewVelocity = hitData.velocity > 0.005 ? hitData.velocity : defaultVelocityFor(hit);
    paintSelectedVelocity(previewVelocity);
  }

  function previewStepSelectionControls(hit, step, barIndex = state.activeBar, fallbackVelocity = 0) {
    const selectedBar = Math.max(0, Math.round(Number(barIndex) || 0));
    const hitData = getHitData(hit, step, selectedBar);
    const previewVelocity = hitData.velocity > 0.005
      ? hitData.velocity
      : defaultVelocityFor(hit, fallbackVelocity);
    selectedLabel.textContent = `${hit} ${formatStepLabel(step)}${hitData.generated && hitData.label ? ` · ${hitData.label}` : ""}`;
    paintSelectedVelocity(previewVelocity);
  }

  /** Toggle a row selection: re-clicking the selected row deselects it. */
  function selectRowToggle(hit, options = {}) {
    if (state.selected?.hit === hit && state.selected?.mode === "row") {
      resetSelectedPanel();
      return;
    }
    selectRow(hit, options);
  }

  /**
   * Shift-aware row selection. Plain click selects one track; shift-click
   * extends the inspector selection from the anchor row to the clicked row (in
   * grid order); ctrl/cmd-click toggles a single row in/out of the selection.
   */
  function selectRowWithModifiers(hit, event = {}, options = {}) {
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
        selectRow(hit, { keepTracks: true, deferTrackPanels: options.deferTrackPanels });
        renderTrackPanelsMaybe(options);
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
        if (state.selected?.hit === hit) selectRow(state.selectedTracks[0], { keepTracks: true, deferTrackPanels: options.deferTrackPanels });
        renderTrackPanelsMaybe(options);
        return;
      }
      set.add(hit);
      state.selectedTracks = orderBySelectedGrid(set);
      state.trackAnchor = hit;
      selectRow(hit, { keepTracks: true, deferTrackPanels: options.deferTrackPanels });
      renderTrackPanelsMaybe(options);
      return;
    }
    selectRowToggle(hit, options);
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
    setHitVelocity(state.selected.hit, state.selected.step, 0, state.selected.bar ?? state.activeBar);
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
    paintSelectedVelocityPreview: paintSelectedVelocity,
    previewRowSelectionControls,
    previewStepSelectionControls,
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
