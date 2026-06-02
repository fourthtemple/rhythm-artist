/**
 * Event-wiring controller.
 *
 * Binds all DOM event listeners for the main editor toolbar, mix panel,
 * arrangement controls, note inspector, file actions, track panels,
 * and loop-track lane.  All business logic is delegated to the injected
 * callbacks; this module contains only `addEventListener` calls and the
 * thin glue between them.
 *
 * @param {object} deps - injected dependencies (see factory call in main file)
 */
export function createEventWiring(deps) {
  const {
    $,
    state,
    clamp,
    status,
    loopCountInput,
    setPathValue,
    applyZoom,
    wireNumberControl,
    // transport
    startPlayback, stopPlayback, restartPlayback,
    playFullSong, toggleBarLoop, toggleTwoBarLoop,
    // arrangement
    duplicateCurrentLoop, deleteCurrentLoop,
    copyTwoBars, pasteTwoBars, fillRestWithTwoBars,
    copyTrackTwoBars, pasteTrackTwoBars, fillRestWithTrackTwoBars,
    setLoopCount,
    // segments / time-sig
    applySegments, applyTimeSig,
    // previews
    previewDuckSound, previewHitSound, previewGameSound,
    // mix
    toggleSolo, clearSolo,
    // selection
    setSelectedVelocityFromControl, setSelectedOptionFromControl,
    setSelectedDubEchoFromControl,
    clearSelection,
    // file
    downloadConfig, loadConfigFile,
    applyConfig, buildLoopTabs, buildBarTabs, buildStepGrid,
    renderTrackExplorer, renderTrackInspector,
    updateTwoBarClipboardButtons, updateTrackClipboardButtons,
    resetSelectedPanel,
    normalizeEditorConfig, clone, DEFAULT_RHYTHM_CONFIG,
    // track panels
    renderAddTrackDialog,
    openGlobalMixView, closeGlobalMixView, resetMasterEq,
    projectManager,
    sampleBrowser,
    closeContextMenu,
    // loop panel
    loopPanel,
    // note inspector DOM refs
    selectedVelocity, selectedVelocityNumber,
    selectedPitch, selectedPitchNumber,
    selectedOffset, selectedOffsetNumber,
    selectedAttack, selectedAttackNumber,
    selectedDelay, selectedDelayNumber,
    selectedWobble, selectedWobbleNumber,
    selectedDubEcho, selectedDubEchoNumber,
    selectedNoteDelaySend, selectedNoteDelaySendNumber,
    selectedNoteReverbSend, selectedNoteReverbSendNumber
  } = deps;

  // ── Transport ─────────────────────────────────────────────────────────────
  function wireTransportEvents() {
    $("#play-toggle").addEventListener("click", () => {
      if (state.playing) stopPlayback();
      else void startPlayback();
    });
    $("#restart").addEventListener("click", restartPlayback);
    $("#play-song").addEventListener("click", playFullSong);
    $("#loop-bar").addEventListener("click", toggleBarLoop);
    $("#intensity").addEventListener("input", (event) => {
      state.intensity = Number(event.target.value);
      $("#intensity-value").textContent = state.intensity.toFixed(2);
    });
    // Transport BPM widget
    const transportBpm = $("#transport-bpm");
    const transportBpmNumber = $("#transport-bpm-number");
    const transportBpmValue = $("#transport-bpm-value");
    function applyTransportBpm(value) {
      const bpm = Math.round(clamp(value, 40, 220, 118));
      setPathValue("patterns.jazz.bpm", bpm);
      if (transportBpm) transportBpm.value = String(bpm);
      if (transportBpmNumber) transportBpmNumber.value = String(bpm);
      if (transportBpmValue) transportBpmValue.textContent = String(bpm);
      const mixBpmSlider = document.querySelector('[data-config="patterns.jazz.bpm"]');
      if (mixBpmSlider) {
        mixBpmSlider.value = String(bpm);
        if (mixBpmSlider.nextElementSibling) mixBpmSlider.nextElementSibling.textContent = String(bpm);
      }
    }
    if (transportBpm) transportBpm.addEventListener("input", () => applyTransportBpm(transportBpm.value));
    if (transportBpmNumber) wireNumberControl(transportBpmNumber, applyTransportBpm);
  }

  // ── Arrangement ───────────────────────────────────────────────────────────
  function wireArrangementEvents() {
    loopCountInput.addEventListener("input", () => setLoopCount(loopCountInput.value));
    loopCountInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      setLoopCount(loopCountInput.value);
      loopCountInput.blur();
    });
    const segmentsInput = $("#segments-count");
    if (segmentsInput) {
      segmentsInput.addEventListener("input", () => applySegments(Number(segmentsInput.value)));
    }
    const timeSigSelect = $("#time-sig-select");
    if (timeSigSelect) {
      timeSigSelect.addEventListener("change", () => applyTimeSig(timeSigSelect.value));
    }
  }

  // ── Sound previews ────────────────────────────────────────────────────────
  function wirePreviewEvents() {
    document.querySelectorAll("[data-preview-sound]").forEach((button) => {
      button.addEventListener("click", () => void previewGameSound(button.dataset.previewSound));
    });
  }

  // ── Mix panel ─────────────────────────────────────────────────────────────
  function wireMixEvents() {
    document.querySelectorAll("[data-config]").forEach((input) => {
      input.addEventListener("input", () => setPathValue(input.dataset.config, input.value));
    });
    document.querySelectorAll(".control-panel [data-solo-track]").forEach((button) => {
      button.addEventListener("click", () => toggleSolo(button.dataset.soloTrack));
    });
    document.querySelectorAll("[data-solo-clear]").forEach((button) => {
      button.addEventListener("click", clearSolo);
    });
  }

  // ── Per-note inspector ────────────────────────────────────────────────────
  function wireSelectedNoteEvents() {
    selectedVelocity.addEventListener("input", () => setSelectedVelocityFromControl());
    wireNumberControl(selectedVelocityNumber, setSelectedVelocityFromControl);
    selectedPitch.addEventListener("input", () => setSelectedOptionFromControl("pitch", selectedPitch.value));
    wireNumberControl(selectedPitchNumber, (value) => setSelectedOptionFromControl("pitch", value));
    selectedOffset.addEventListener("input", () => setSelectedOptionFromControl("offsetMs", selectedOffset.value));
    wireNumberControl(selectedOffsetNumber, (value) => setSelectedOptionFromControl("offsetMs", value));
    selectedAttack.addEventListener("input", () => setSelectedOptionFromControl("attackMs", selectedAttack.value));
    wireNumberControl(selectedAttackNumber, (value) => setSelectedOptionFromControl("attackMs", value));
    selectedDelay.addEventListener("input", () => setSelectedOptionFromControl("delayMs", selectedDelay.value));
    wireNumberControl(selectedDelayNumber, (value) => setSelectedOptionFromControl("delayMs", value));
    selectedWobble.addEventListener("input", () => setSelectedOptionFromControl("wobble", selectedWobble.value));
    wireNumberControl(selectedWobbleNumber, (value) => setSelectedOptionFromControl("wobble", value));
    selectedDubEcho.addEventListener("input", () => setSelectedDubEchoFromControl());
    wireNumberControl(selectedDubEchoNumber, setSelectedDubEchoFromControl);
    selectedNoteDelaySend.addEventListener("input", () => setSelectedOptionFromControl("delaySend", selectedNoteDelaySend.value));
    wireNumberControl(selectedNoteDelaySendNumber, (value) => setSelectedOptionFromControl("delaySend", value));
    selectedNoteReverbSend.addEventListener("input", () => setSelectedOptionFromControl("reverbSend", selectedNoteReverbSend.value));
    wireNumberControl(selectedNoteReverbSendNumber, (value) => setSelectedOptionFromControl("reverbSend", value));
    $("#clear-selected").addEventListener("click", clearSelection);
  }

  // ── File / project actions ────────────────────────────────────────────────
  // Legacy Save File / Load File / Copy JSON / Reset buttons have been removed
  // from the HTML. Project save/load is now handled by the project manager overlay.
  function wireFileEvents() {
    // nothing to wire here anymore
  }

  // ── Right-side track panels ───────────────────────────────────────────────
  function wireTrackPanelEvents() {
    $("#add-track-btn")?.addEventListener("click", () => {
      renderAddTrackDialog();
      /** @type {HTMLDialogElement} */ ($("#add-track-dialog"))?.showModal();
    });
    $("#add-track-cancel")?.addEventListener("click", () => {
      /** @type {HTMLDialogElement} */ ($("#add-track-dialog"))?.close();
    });
    $("#add-track-btn-panel")?.addEventListener("click", () => {
      renderAddTrackDialog();
      /** @type {HTMLDialogElement} */ ($("#add-track-dialog"))?.showModal();
    });
    $("#manage-groups-btn")?.addEventListener("click", () => {
      renderAddTrackDialog();
      /** @type {HTMLDialogElement} */ ($("#add-track-dialog"))?.showModal();
    });
    $("#open-global-mix")?.addEventListener("click", openGlobalMixView);
    $("#open-project-manager")?.addEventListener("click", () => projectManager.open());
    $("#close-global-mix")?.addEventListener("click", closeGlobalMixView);
    $("#master-eq-reset")?.addEventListener("click", resetMasterEq);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        const overlay = $("#global-mix-view");
        if (overlay && !overlay.hidden) closeGlobalMixView();
        closeContextMenu();
      }
    });
    // sample browser wires its own open-folder button inside createSampleBrowser
  }

  // ── Loop-track lane ───────────────────────────────────────────────────────
  // ── BPM detector (autocorrelation on onset envelope) ─────────────────────
  async function detectBpm(arrayBuffer) {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    let buffer;
    try {
      buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch { return null; }

    const sr = buffer.sampleRate;
    const mono = buffer.getChannelData(0);

    // Downsample to ~200 Hz onset envelope using 10 ms RMS frames
    const frameSize = Math.round(sr * 0.01);
    const envelope = [];
    for (let i = 0; i < mono.length - frameSize; i += frameSize) {
      let sum = 0;
      for (let j = 0; j < frameSize; j++) sum += mono[i + j] ** 2;
      envelope.push(Math.sqrt(sum / frameSize));
    }

    // Half-wave rectified first difference (onset strength)
    const onset = envelope.map((v, i) => i === 0 ? 0 : Math.max(0, v - envelope[i - 1]));

    // Autocorrelation over lag range corresponding to 60-200 BPM
    const fps = sr / frameSize; // frames per second (~100)
    const lagMin = Math.round(fps * 60 / 200);
    const lagMax = Math.round(fps * 60 / 60);
    let bestLag = lagMin, bestScore = -Infinity;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let score = 0;
      for (let i = 0; i < onset.length - lag; i++) score += onset[i] * onset[i + lag];
      if (score > bestScore) { bestScore = score; bestLag = lag; }
    }
    const bpm = Math.round((fps / bestLag) * 60);
    return { bpm, duration: buffer.duration };
  }

  function wireLoopTrackEvents() {
    let _analysisCtx = null;

    // Auto-analyse when a file is picked
    const fileInput = /** @type {HTMLInputElement} */ ($("#loop-track-file"));
    if (fileInput) {
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        const analysisEl = $("#loop-track-analysis");
        const analyzingEl = $("#loop-track-analyzing");
        const nameInput = /** @type {HTMLInputElement} */ ($("#loop-track-name"));
        const barsInput = /** @type {HTMLInputElement} */ ($("#loop-track-bars"));
        const bpmEl = $("#loop-detected-bpm");
        const durEl = $("#loop-detected-dur");
        const barsEl = $("#loop-detected-bars");
        const noteEl = $("#loop-detected-note");

        if (!file) return;

        // Pre-fill name from filename (strip extension)
        if (nameInput && !nameInput.value) {
          nameInput.value = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        }

        if (analysisEl) analysisEl.hidden = true;
        if (analyzingEl) analyzingEl.hidden = false;

        let result = null;
        try {
          const arrayBuffer = await file.arrayBuffer();
          result = await detectBpm(arrayBuffer);
        } catch (err) {
          console.warn("[loop] BPM analysis failed:", err);
        } finally {
          if (analyzingEl) analyzingEl.hidden = true;
        }
        if (!result) return;

        const { bpm, duration } = result;
        // Get project BPM from the BPM slider/input
        const projectBpm = Number(state?.config?.patterns?.jazz?.bpm || 120);
        // Bars = duration / (60 / bpm * beatsPerBar)
        const secPerBeat = 60 / bpm;
        const secPerBar = secPerBeat * 4;
        const rawBars = duration / secPerBar;
        const roundedBars = Math.max(1, Math.round(rawBars));

        // How many bars would this be at the project BPM?
        const projectSecPerBar = (60 / projectBpm) * 4;
        const barsAtProject = Math.max(1, Math.round(duration / projectSecPerBar));

        if (bpmEl) bpmEl.textContent = `${bpm} BPM`;
        if (durEl) durEl.textContent = `${duration.toFixed(2)}s`;
        if (barsEl) barsEl.textContent = String(barsAtProject);
        if (noteEl) {
          const diff = Math.abs(bpm - projectBpm);
          noteEl.textContent = diff < 2
            ? "✓ matches project tempo"
            : `(file is ${bpm} BPM, project is ${projectBpm} BPM)`;
        }
        if (barsInput) barsInput.value = String(barsAtProject);
        if (analysisEl) analysisEl.hidden = false;
      });
    }

    $("#add-loop-track-btn")?.addEventListener("click", () => {
      const dialog = /** @type {HTMLDialogElement} */ ($("#add-loop-dialog"));
      if (dialog) dialog.showModal();
    });
    $("#add-loop-cancel")?.addEventListener("click", () => {
      /** @type {HTMLDialogElement} */ ($("#add-loop-dialog"))?.close();
    });
    $("#add-loop-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const nameInput = /** @type {HTMLInputElement} */ ($("#loop-track-name"));
      const fileInput2 = /** @type {HTMLInputElement} */ ($("#loop-track-file"));
      const barsInput = /** @type {HTMLInputElement} */ ($("#loop-track-bars"));
      const beatmatchInput = /** @type {HTMLInputElement} */ ($("#loop-track-beatmatch"));
      const name = nameInput?.value.trim();
      const file = fileInput2?.files?.[0];
      const barsInFile = Math.max(1, Math.round(Number(barsInput?.value) || 4));
      const beatmatch = beatmatchInput?.checked ?? false;
      if (!name || !file) return;
      void loopPanel.addTrack(name, file, barsInFile, beatmatch);
      /** @type {HTMLDialogElement} */ ($("#add-loop-dialog"))?.close();
      // Reset for next use
      if (nameInput) nameInput.value = "";
      if (fileInput2) fileInput2.value = "";
      if (barsInput) barsInput.value = "4";
      if (beatmatchInput) beatmatchInput.checked = false;
      const analysisEl = $("#loop-track-analysis");
      const analyzingEl = $("#loop-track-analyzing");
      if (analysisEl) analysisEl.hidden = true;
      if (analyzingEl) analyzingEl.hidden = true;
    });
    $("#loop-region-start")?.addEventListener("change", () => loopPanel.updateSelectedRegion());
    $("#loop-region-len")?.addEventListener("change", () => loopPanel.updateSelectedRegion());
    $("#loop-region-chops")?.addEventListener("change", () => loopPanel.updateSelectedRegion());
    $("#loop-region-gain")?.addEventListener("input", () => {
      const val = Number(/** @type {HTMLInputElement} */ ($("#loop-region-gain"))?.value ?? 1);
      const out = /** @type {HTMLElement} */ ($("#loop-region-gain-value"));
      if (out) out.textContent = val.toFixed(2);
      loopPanel.updateSelectedRegion();
    });
    $("#loop-region-slice-sensitivity")?.addEventListener("input", () => {
      const val = Number(/** @type {HTMLInputElement} */ ($("#loop-region-slice-sensitivity"))?.value ?? 0.12);
      const out = /** @type {HTMLElement} */ ($("#loop-region-slice-sensitivity-value"));
      if (out) out.textContent = val.toFixed(2);
      loopPanel.updateSelectedRegion();
    });
    $("#loop-region-delete")?.addEventListener("click", () => loopPanel.deleteSelectedRegion());
  }

  // ── Public: call once after DOM is ready ─────────────────────────────────
  function wireAll() {
    wireTransportEvents();
    wireArrangementEvents();
    wirePreviewEvents();
    wireMixEvents();
    wireSelectedNoteEvents();
    wireFileEvents();
    wireTrackPanelEvents();
    wireLoopTrackEvents();
  }

  return { wireAll };
}
