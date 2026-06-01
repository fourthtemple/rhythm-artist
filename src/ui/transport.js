// Transport / playback controller.
//
// Owns play/stop, the loop-playback modes (bar / two-bar / full song),
// restart, the sound-preview triggers, and the playhead UI loop (the periodic
// engine-update timer plus the step/bar playhead highlighting).
//
// It reaches the rest of the editor through the shared `state` object and a set
// of injected primitives. The editor keeps thin hoisted wrappers so existing
// call sites (transport buttons, preview buttons) are unchanged.

/**
 * @param {object} deps
 * @param {(sel: string) => any} deps.$ DOM query helper.
 * @param {object} deps.state Shared editor state (mutated in place).
 * @param {(msg: string) => void} deps.setStatus Status-line setter.
 * @param {boolean} deps.runningFromFile
 * @param {Element} deps.stepGrid
 * @param {Element} deps.barTabs
 * @param {new (opts: any) => any} deps.RhythmEngine Engine constructor (for restart).
 * @param {number} deps.LOOP_BAR_COUNT
 * @param {(barIndex: number) => string} deps.barLabel
 * @param {(start?: number, length?: number) => string} deps.loopRangeLabel
 * @param {() => number} deps.activeLoopLength
 * @param {(start?: number, length?: number) => number} deps.clampLoopStart
 * @param {() => any} deps.previewConfig
 * @param {() => void} deps.refreshLoopBarButton
 * @param {() => (void|Promise<any>)} deps.reapplyTrackSamples
 * @param {() => void} deps.syncActiveLoopToBar
 * @param {() => void} deps.buildLoopTabs
 * @param {() => void} deps.buildBarTabs
 * @param {() => void} deps.renderStepGrid
 * @param {(hit: string, step: number, mode?: string, barIndex?: number, pressure?: number) => void} deps.selectStep
 * @param {(hit: string, playheadStep: number, barIndex?: number) => number} deps.soundingStepForRow
 * @param {(hit: string, step: number, barIndex?: number) => any} deps.getHitData
 * @param {(barIndex?: number) => void} deps.syncSelectedPitchDisplay
 */
export function createTransport(deps) {
  const {
    $,
    state,
    setStatus,
    runningFromFile,
    stepGrid,
    barTabs,
    RhythmEngine,
    barLabel,
    loopRangeLabel,
    activeLoopLength,
    clampLoopStart,
    previewConfig,
    refreshLoopBarButton,
    reapplyTrackSamples,
    syncActiveLoopToBar,
    buildLoopTabs,
    buildBarTabs,
    renderStepGrid,
    selectStep,
    soundingStepForRow,
    getHitData,
    syncSelectedPitchDisplay
  } = deps;

  async function startPlayback() {
    if (runningFromFile) {
      setStatus("Open the localhost version for audio");
      return;
    }
    try {
      state.playheadStep = 0;
      await state.engine.start({
        style: "jazz",
        volume: 0.62,
        phraseBar: state.activeBar,
        step: 0
      });
      state.playing = true;
      $("#play-toggle").textContent = "Pause";
      setStatus(`Playing from ${barLabel(state.activeBar)}`);
      startUiTimer();
    } catch (error) {
      console.error("Rhythm sequencer audio failed to start", error);
      setStatus("Audio failed to start");
    }
  }

  function stopPlayback() {
    state.engine.stop();
    state.playing = false;
    if (state.uiTimer) {
      window.clearInterval(state.uiTimer);
      state.uiTimer = null;
    }
    $("#play-toggle").textContent = "Play";
    setStatus("Paused");
    clearPlayhead();
  }

  function setLoopPlayback(start, length) {
    length = Math.max(0, Math.round(Number(length) || 0));
    state.loopBarLength = length;
    state.loopBar = length > 0;
    if (state.loopBar) {
      state.loopBarIndex = start ?? clampLoopStart(state.activeBar, length);
    }
    state.engine.setConfig(previewConfig());
    refreshLoopBarButton();
  }

  function toggleSelectedLoop() {
    // If a loop is already active, turn it off
    if (activeLoopLength() > 0) {
      setLoopPlayback(null, 0);
      setStatus("Loop off");
      return;
    }
    // Use selectedBars if any are highlighted, otherwise just the active bar
    const bars = state.selectedBars?.length
      ? [...state.selectedBars].sort((a, b) => a - b)
      : [state.activeBar];
    const start = bars[0];
    const length = bars[bars.length - 1] - start + 1;
    setLoopPlayback(start, length);
    // Seek the engine to the loop start so playback immediately jumps there
    state.engine.seekToPhraseBar(start, 0);
    state.playheadStep = 0;
    setStatus(length === 1
      ? `Looping bar ${start + 1}`
      : `Looping bars ${start + 1}–${start + length}`);
  }

  // Keep these for any call sites that still reference them
  function toggleBarLoop() { toggleSelectedLoop(); }
  function toggleTwoBarLoop() { toggleSelectedLoop(); }

  function playFullSong() {
    setLoopPlayback(0);
    setStatus(`Playing full ${state.config.patterns.jazz.bars.length}-bar track`);
  }

  function restartPlayback() {
    state.engine.stop();
    state.engine = new RhythmEngine({ config: previewConfig(), style: "jazz", volume: 0.58 });
    // Re-subscribe loop track scheduler to the new engine instance
    state.engine.on("play", () => deps.onEngineRestart?.());
    void reapplyTrackSamples();
    if (state.playing) void startPlayback();
    else setStatus("Restarted");
  }

  async function ensurePreviewPlayback() {
    if (!state.playing) {
      await startPlayback();
    }
    return state.playing;
  }

  async function previewDuckSound() {
    if (!await ensurePreviewPlayback()) return;
    state.engine.previewDuckHold();
    setStatus("Preview: duck hold sound");
  }

  async function previewHitSound() {
    if (!await ensurePreviewPlayback()) return;
    state.engine.accentImpact();
    setStatus("Preview: hit sound");
  }

  async function previewGameSound(kind) {
    if (!await ensurePreviewPlayback()) return;
    const previews = {
      boss: ["boss landed sound", () => state.engine.accentBossLanded()],
      wobble: ["funk wobble", () => state.engine.previewWobble()],
      echo: ["echo ping", () => state.engine.previewEchoPing()],
      "whale-down": ["duck wobble bend", () => state.engine.previewWhaleBend(-0.65)],
      "whale-up": ["rising wobble bend", () => state.engine.previewWhaleBend(0.72)],
      "space-drop": ["space drop", () => state.engine.previewSpaceDrop()],
      "space-pickup": ["space pickup", () => state.engine.previewSpacePickup()]
    };
    const preview = previews[kind];
    if (!preview) return;
    preview[1]();
    setStatus(`Preview: ${preview[0]}`);
  }

  function startUiTimer() {
    if (state.uiTimer) window.clearInterval(state.uiTimer);
    state.uiTimer = window.setInterval(() => {
      state.engine.update({
        enabled: state.playing,
        style: "jazz",
        moving: true,
        danger: state.intensity,
        progress: state.intensity
      });
      updatePlayhead();
    }, 70);
  }

  function clearPlayhead() {
    stepGrid.querySelectorAll(".step-button").forEach((button) => {
      button.classList.remove("is-playhead", "is-playhead-empty");
    });
    barTabs.querySelectorAll("button").forEach((button) => button.classList.remove("is-playhead-bar"));
  }

  function followPlaybackBar(phraseBar) {
    const segments = state.segmentsCount ?? 1;
    // When a loop is active, any bar outside the loop range is a transient
    // engine state (the tick just before the loop wraps back). Discard it so
    // the view never snaps away from the loop window.
    if (state.loopBar && state.loopBarLength > 0) {
      const loopEnd = state.loopBarIndex + state.loopBarLength;
      if (phraseBar < state.loopBarIndex || phraseBar >= loopEnd) return;
    }
    // Snap the view anchor to segment boundaries — only shift when phraseBar
    // leaves the current window [activeBar, activeBar + segments).
    const inWindow = phraseBar >= state.activeBar && phraseBar < state.activeBar + segments;
    if (inWindow) return;
    // Advance to the next segment window that contains phraseBar.
    const newAnchor = Math.floor(phraseBar / segments) * segments;
    if (newAnchor === state.activeBar) return;
    const previousLoop = state.activeLoopIndex;
    state.activeBar = newAnchor;
    syncActiveLoopToBar();
    if (state.activeLoopIndex !== previousLoop) {
      buildLoopTabs();
      buildBarTabs();
    }
    renderStepGrid();
    if (state.selected) {
      selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step");
    }
  }

  function updatePlayhead() {
    if (!state.playing) return;
    clearPlayhead();
    const playback = state.engine.getPlaybackState();
    if (!playback.playing) return;
    const totalBars = state.config.patterns.jazz.bars.length;
    const rawBar = playback.phraseBar % totalBars;
    // The engine fires one step ahead: step 0 of bar N actually sounds step 15 of bar N-1.
    // Adjust both the display step and its real bar together.
    let displayStep, displayBar;
    if (playback.step === 0) {
      displayStep = 15;
      displayBar = ((rawBar - 1) + totalBars) % totalBars;
    } else {
      displayStep = playback.step - 1;
      displayBar = rawBar;
    }
    state.playheadStep = displayStep;
    // When looping, clamp displayBar to the loop range to avoid out-of-range
    // transient states from briefly flickering the view.
    if (state.loopBar && state.loopBarLength > 0) {
      const loopEnd = state.loopBarIndex + state.loopBarLength;
      if (displayBar < state.loopBarIndex || displayBar >= loopEnd) return;
    }
    followPlaybackBar(displayBar);
    // Which segment column is the playhead in?
    const seg = displayBar - state.activeBar;
    if (seg >= 0 && seg < (state.segmentsCount ?? 1)) {
      stepGrid.querySelectorAll(`.step-button[data-step="${displayStep}"][data-seg="${seg}"]`).forEach((button) => {
        const hitData = getHitData(button.dataset.hit, displayStep, displayBar);
        button.classList.add(hitData.velocity > 0.005 ? "is-playhead" : "is-playhead-empty");
      });
    }
    const barButton = barTabs.querySelector(`button[data-bar="${displayBar}"]`);
    if (barButton) barButton.classList.add("is-playhead-bar");
    if (state.selected?.mode === "row") {
      const selectedStep = soundingStepForRow(state.selected.hit, displayStep, displayBar);
      selectStep(state.selected.hit, selectedStep, "row", displayBar, playback.activeBarIntensity);
      renderStepGrid();
    }
    if (state.selected?.hit === "bass") {
      syncSelectedPitchDisplay(displayBar);
    }
  }

  return {
    startPlayback,
    stopPlayback,
    setLoopPlayback,
    toggleSelectedLoop,
    toggleBarLoop,
    toggleTwoBarLoop,
    playFullSong,
    restartPlayback,
    previewDuckSound,
    previewHitSound,
    previewGameSound,
    clearPlayhead,
    updatePlayhead
  };
}
