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
const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));

export function cameraAnchorForBar(phraseBar, segments = 1, totalBars = 1, loopStart = null, loopLength = 0) {
  const start = cameraViewStartForPosition(phraseBar, segments, totalBars, loopStart, loopLength);
  return start === null ? null : Math.floor(start);
}

export function cameraViewStartForPosition(positionBars, segments = 1, totalBars = 1, loopStart = null, loopLength = 0) {
  const windowBars = Math.max(1, Math.round(finiteNumber(segments, 1)));
  const songBars = Math.max(1, Math.round(finiteNumber(totalBars, 1)));
  const songMaxAnchor = Math.max(0, songBars - windowBars);
  const position = clampNumber(finiteNumber(positionBars, 0), 0, songBars);
  const centerOffset = windowBars / 2;
  let minAnchor = 0;
  let maxAnchor = songMaxAnchor;

  if (loopStart !== null && finiteNumber(loopLength, 0) > 0) {
    const loopBegin = clampNumber(Math.floor(finiteNumber(loopStart, 0)), 0, songBars - 1);
    const loopEnd = clampNumber(loopBegin + Math.max(1, Math.round(finiteNumber(loopLength, 1))), loopBegin + 1, songBars);
    if (position < loopBegin || position >= loopEnd) return null;
    minAnchor = Math.min(loopBegin, songMaxAnchor);
    maxAnchor = Math.min(Math.max(loopBegin, loopEnd - windowBars), songMaxAnchor);
    if (maxAnchor < minAnchor) maxAnchor = minAnchor;
  }

  return clampNumber(position - centerOffset, minAnchor, maxAnchor);
}

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
  let beatUnsubscribe = null;
  let cameraRaf = null;
  let playheadRaf = null;
  let cameraBeatQueue = [];
  let lastPlayheadKey = "";
  let activePlayheadButtons = [];
  let activePlayheadBarButton = null;
  let cameraBarWidthCache = 0;
  let cameraBarWidthKey = "";
  let lastCameraPanTarget = -1;
  let lastCameraPanAt = 0;

  const visibleSegments = () => Math.max(1, Math.round(Number(state.segmentsCount) || 1));
  const renderedSegments = () => Math.max(visibleSegments(), Math.round(Number(state.renderedSegmentsCount) || visibleSegments()));
  const totalSongBars = () => Math.max(1, state.config.patterns.jazz.bars.length);

  function attachBeatTracker() {
    if (beatUnsubscribe) beatUnsubscribe();
    cameraBeatQueue = [];
    beatUnsubscribe = state.engine.on("beat", (payload) => {
      const scheduledTime = finiteNumber(payload?.scheduledTime ?? payload?.time, 0);
      const stepDuration = Math.max(0.001, finiteNumber(
        payload?.stepDuration,
        finiteNumber(payload?.bpm, 120) > 0 ? 60 / finiteNumber(payload.bpm, 120) / 4 : 0.125
      ));
      cameraBeatQueue.push({
        phraseBar: Math.floor(finiteNumber(payload?.phraseBar, 0)),
        step: Math.floor(finiteNumber(payload?.step, 0)),
        scheduledTime,
        stepDuration
      });
      cameraBeatQueue.sort((a, b) => a.scheduledTime - b.scheduledTime);
      if (cameraBeatQueue.length > 96) cameraBeatQueue.splice(0, cameraBeatQueue.length - 96);
    });
  }

  function detachBeatTracker() {
    if (beatUnsubscribe) {
      beatUnsubscribe();
      beatUnsubscribe = null;
    }
    cameraBeatQueue = [];
  }

  function resetCameraTransform() {
    stepGrid.classList.remove("is-camera-active");
    stepGrid.style.setProperty("--camera-x", "0px");
  }

  function resetCameraScroll({ preservePosition = false } = {}) {
    if (cameraRaf) {
      window.cancelAnimationFrame(cameraRaf);
      cameraRaf = null;
    }
    const nextScrollLeft = preservePosition ? stepGrid.scrollLeft : 0;
    resetCameraTransform();
    if (stepGrid.scrollLeft !== nextScrollLeft) stepGrid.scrollLeft = nextScrollLeft;
    hideCameraPlayheadLine();
    lastCameraPanTarget = -1;
    lastCameraPanAt = 0;
  }

  function invalidateCameraMetrics() {
    cameraBarWidthCache = 0;
    cameraBarWidthKey = "";
  }

  function resetPlayheadCache() {
    lastPlayheadKey = "";
  }

  function currentBeatPosition() {
    const engine = state.engine;
    const now = finiteNumber(engine?.context?.currentTime, 0);
    if (cameraBeatQueue.length) {
      while (cameraBeatQueue.length > 1 && cameraBeatQueue[1].scheduledTime <= now + 0.002) {
        cameraBeatQueue.shift();
      }
      const beat = cameraBeatQueue[0];
      const elapsedSteps = clampNumber((now - beat.scheduledTime) / beat.stepDuration, 0, 1.25);
      return beat.phraseBar + (beat.step + elapsedSteps) / 16;
    }

    const playback = engine.getPlaybackState();
    const stepDuration = Math.max(0.001, finiteNumber(playback.stepDuration, 0.125));
    const scheduledStep = playback.step === 0 ? 15 : playback.step - 1;
    const scheduledBar = playback.step === 0
      ? ((playback.phraseBar - 1) + totalSongBars()) % totalSongBars()
      : playback.phraseBar;
    const elapsedSteps = clampNumber((finiteNumber(playback.contextTime, 0) - finiteNumber(playback.nextStepTime, 0)) / stepDuration, 0, 1);
    return scheduledBar + (scheduledStep + elapsedSteps) / 16;
  }

  function currentDisplayedBeat() {
    const engine = state.engine;
    const totalBars = totalSongBars();
    const now = finiteNumber(engine?.context?.currentTime, 0);
    if (cameraBeatQueue.length) {
      while (cameraBeatQueue.length > 1 && cameraBeatQueue[1].scheduledTime <= now + 0.002) {
        cameraBeatQueue.shift();
      }
      const beat = cameraBeatQueue[0];
      const elapsedSteps = clampNumber((now - beat.scheduledTime) / beat.stepDuration, 0, 0.999);
      const stepOffset = Math.floor(beat.step + elapsedSteps);
      const barOffset = Math.floor(stepOffset / 16);
      return {
        bar: ((beat.phraseBar + barOffset) % totalBars + totalBars) % totalBars,
        step: ((stepOffset % 16) + 16) % 16
      };
    }

    const playback = engine.getPlaybackState();
    const step = playback.step === 0 ? 15 : playback.step - 1;
    const bar = playback.step === 0
      ? ((playback.phraseBar - 1) + totalBars) % totalBars
      : playback.phraseBar;
    return { bar, step };
  }

  function updatePositionDisplay(bar = state.activeBar, step = state.playheadStep || 0) {
    const position = $("#transport-position");
    if (!position) return;
    position.textContent = `${barLabel(bar)} · ${String(step + 1).padStart(2, "0")}`;
  }

  function cameraBarWidth() {
    if (cameraBarWidthCache > 0) return cameraBarWidthCache;
    const widthKey = `${stepGrid.clientWidth}:${visibleSegments()}:${renderedSegments()}`;
    const first = stepGrid.querySelector('.step-button[data-seg="0"][data-step="0"], .step-header--step[data-bar-seg="0"]');
    const second = stepGrid.querySelector('.step-button[data-seg="1"][data-step="0"], .step-header--step[data-bar-seg="1"]');
    if (first && second) {
      const width = second.getBoundingClientRect().left - first.getBoundingClientRect().left;
      if (width > 0) {
        cameraBarWidthCache = width;
        cameraBarWidthKey = widthKey;
        return cameraBarWidthCache;
      }
    }
    const labelWidth = 92;
    cameraBarWidthCache = Math.max(1, (stepGrid.clientWidth - labelWidth) / visibleSegments());
    cameraBarWidthKey = widthKey;
    return cameraBarWidthCache;
  }

  function cameraPlayheadLine() {
    return stepGrid.querySelector(".camera-grid-playhead-line");
  }

  function hideCameraPlayheadLine() {
    const line = cameraPlayheadLine();
    if (line) line.hidden = true;
  }

  function updateCameraPlayheadLine(positionBars) {
    state.cameraPlayheadPosition = positionBars;
    const line = cameraPlayheadLine();
    if (!line) return;
    line.hidden = false;
    line.style.transform = `translateX(${positionBars * cameraBarWidth()}px)`;
  }

  function keepCameraPlayheadInView(positionBars) {
    const barWidth = cameraBarWidth();
    const contentX = positionBars * barWidth;
    const viewportX = 92 + contentX - stepGrid.scrollLeft;
    const leftEdge = Math.max(130, stepGrid.clientWidth * 0.22);
    const rightEdge = Math.max(leftEdge + 120, stepGrid.clientWidth * 0.72);
    if (viewportX >= leftEdge && viewportX <= rightEdge) return;

    const targetX = stepGrid.clientWidth * 0.42;
    const maxScrollLeft = Math.max(0, stepGrid.scrollWidth - stepGrid.clientWidth);
    const nextTarget = Math.max(0, Math.min(maxScrollLeft, 92 + contentX - targetX));
    const now = performance.now();
    if (Math.abs(nextTarget - lastCameraPanTarget) < barWidth * 0.5 && now - lastCameraPanAt < 420) return;
    lastCameraPanTarget = nextTarget;
    lastCameraPanAt = now;
    stepGrid.scrollTo({ left: nextTarget, behavior: "smooth" });
  }

  function updateCameraScroll() {
    if (!state.playing || !state.cameraMode) {
      resetCameraScroll({ preservePosition: state.cameraMode });
      return;
    }

    const positionBars = currentBeatPosition();
    updateCameraPlayheadLine(positionBars);
    const viewStart = cameraViewStartForPosition(
      positionBars,
      visibleSegments(),
      totalSongBars(),
      state.loopBar ? state.loopBarIndex : null,
      state.loopBar ? state.loopBarLength : 0
    );
    if (viewStart !== null) {
      keepCameraPlayheadInView(positionBars);
    }
    cameraRaf = window.requestAnimationFrame(updateCameraScroll);
  }

  function startCameraScroll() {
    if (cameraRaf || !state.cameraMode || !state.playing) return;
    cameraRaf = window.requestAnimationFrame(updateCameraScroll);
  }

  function playheadFrame() {
    if (!state.playing) {
      playheadRaf = null;
      return;
    }
    updatePlayhead();
    playheadRaf = window.requestAnimationFrame(playheadFrame);
  }

  function startPlayheadLoop() {
    if (playheadRaf || !state.playing) return;
    playheadRaf = window.requestAnimationFrame(playheadFrame);
  }

  function stopPlayheadLoop() {
    if (!playheadRaf) return;
    window.cancelAnimationFrame(playheadRaf);
    playheadRaf = null;
  }

  async function startPlayback() {
    if (runningFromFile) {
      setStatus("Open the localhost version for audio");
      return;
    }
    try {
      state.playheadStep = 0;
      state.engine.setConfig(previewConfig());
      attachBeatTracker();
      await state.engine.start({
        style: "jazz",
        volume: 0.62,
        phraseBar: state.activeBar,
        step: 0
      });
      state.playing = true;
      $("#play-toggle").textContent = "Pause";
      setStatus(`Playing from ${barLabel(state.activeBar)}`);
      updatePositionDisplay(state.activeBar, 0);
      resetPlayheadCache();
      startUiTimer();
      startPlayheadLoop();
      startCameraScroll();
    } catch (error) {
      console.error("Rhythm sequencer audio failed to start", error);
      detachBeatTracker();
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
    stopPlayheadLoop();
    clearPlayhead();
    updatePositionDisplay(state.activeBar, state.playheadStep);
    detachBeatTracker();
    resetCameraScroll({ preservePosition: state.cameraMode });
  }

  function setLoopPlayback(start, length) {
    const preserveBeat = state.playing ? currentDisplayedBeat() : null;
    const wasLooping = state.loopBar && state.loopBarLength > 0;
    state.loopBeatRange = null;
    length = Math.max(0, Math.round(Number(length) || 0));
    state.loopBarLength = length;
    state.loopBar = length > 0;
    if (state.loopBar) {
      state.loopBarIndex = start ?? clampLoopStart(state.activeBar, length);
    }
    state.engine.setConfig(previewConfig());
    if (wasLooping && !state.loopBar && preserveBeat && state.engine.getPlaybackState().playing) {
      state.engine.seekToPhraseBar(preserveBeat.bar, preserveBeat.step);
      state.playheadStep = preserveBeat.step;
      updatePositionDisplay(preserveBeat.bar, preserveBeat.step);
    }
    refreshLoopBarButton();
  }

  function normalizedBeatRange(range) {
    const totalSteps = Math.max(1, totalSongBars() * 16);
    const startStepAbs = clampNumber(Math.round(finiteNumber(range?.startStepAbs, 0)), 0, totalSteps - 1);
    const lengthSteps = clampNumber(Math.round(finiteNumber(range?.lengthSteps, 1)), 1, totalSteps - startStepAbs);
    const endStepAbs = startStepAbs + lengthSteps;
    return {
      startBar: Math.floor(startStepAbs / 16),
      startStep: startStepAbs % 16,
      startStepAbs,
      endStepAbs,
      lengthSteps
    };
  }

  function beatRangeLabel(range) {
    const start = Math.max(0, Math.round(finiteNumber(range?.startStepAbs, 0)));
    const endInclusive = Math.max(start, Math.round(finiteNumber(range?.endStepAbs, start + finiteNumber(range?.lengthSteps, 1))) - 1);
    const labelStep = (stepAbs) => {
      const bar = Math.floor(stepAbs / 16);
      const step = stepAbs % 16;
      return `${bar + 1}.${String(step + 1).padStart(2, "0")}`;
    };
    return `${labelStep(start)}-${labelStep(endInclusive)}`;
  }

  function seekToBeatRangeStart(range) {
    state.activeBar = range.startBar;
    state.playheadStep = range.startStep;
    state.engine.seekToPhraseBar(range.startBar, range.startStep);
    updatePositionDisplay(range.startBar, range.startStep);
  }

  async function loopBeatSelection(range) {
    const nextRange = normalizedBeatRange(range);
    state.loopBeatRange = nextRange;
    state.loopBar = false;
    state.loopBarLength = 0;
    state.loopBarIndex = nextRange.startBar;
    state.engine.setConfig(previewConfig());
    seekToBeatRangeStart(nextRange);
    refreshLoopBarButton();
    await ensurePreviewPlayback();
    seekToBeatRangeStart(nextRange);
    setStatus(`Looping beats ${beatRangeLabel(nextRange)}`);
  }

  async function playBeatSelection(range) {
    const nextRange = normalizedBeatRange(range);
    state.loopBeatRange = null;
    state.loopBar = false;
    state.loopBarLength = 0;
    state.engine.setConfig(previewConfig());
    refreshLoopBarButton();
    await ensurePreviewPlayback();
    seekToBeatRangeStart(nextRange);
    setStatus(`Playing from beat ${nextRange.startBar + 1}.${String(nextRange.startStep + 1).padStart(2, "0")}`);
  }

  function toggleSelectedLoop() {
    // If a loop is already active, turn it off
    if (activeLoopLength() > 0 || state.loopBeatRange?.lengthSteps > 0) {
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
      startCameraScroll();
    }, 70);
  }

  function clearPlayheadMarks() {
    activePlayheadButtons.forEach((button) => {
      button.classList.remove("is-playhead", "is-playhead-empty");
    });
    activePlayheadButtons = [];
    activePlayheadBarButton?.classList.remove("is-playhead-bar");
    activePlayheadBarButton = null;
  }

  function clearPlayhead() {
    clearPlayheadMarks();
    resetPlayheadCache();
  }

  function selectedBarIsVisible() {
    if (!state.selected) return false;
    const bar = Math.max(0, Math.round(Number(state.selected.bar ?? state.activeBar) || 0));
    const start = Math.max(0, Math.round(Number(state.activeBar) || 0));
    return bar >= start && bar < start + visibleSegments();
  }

  function setPlaybackViewAnchor(newAnchor) {
    if (newAnchor === state.activeBar) return;
    const previousLoop = state.activeLoopIndex;
    state.activeBar = newAnchor;
    syncActiveLoopToBar();
    if (state.activeLoopIndex !== previousLoop) {
      buildLoopTabs();
      buildBarTabs();
    }
    renderStepGrid();
    resetPlayheadCache();
    invalidateCameraMetrics();
    if (state.selected?.mode === "row") {
      selectStep(state.selected.hit, state.selected.step, "row", state.activeBar);
    } else if (selectedBarIsVisible()) {
      selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step", state.selected.bar ?? state.activeBar);
    }
  }

  function revealBarButton(barIndex) {
    const button = barTabs.querySelector(`button[data-bar="${barIndex}"]`);
    if (!button) return null;
    const tabsRect = barTabs.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const margin = 12;
    if (buttonRect.left < tabsRect.left + margin) {
      barTabs.scrollLeft -= (tabsRect.left + margin) - buttonRect.left;
    } else if (buttonRect.right > tabsRect.right - margin) {
      barTabs.scrollLeft += buttonRect.right - (tabsRect.right - margin);
    }
    return button;
  }

  function followPlaybackBar(phraseBar) {
    const segments = Math.max(1, Math.round(Number(state.segmentsCount) || 1));
    const totalBars = state.config.patterns.jazz.bars.length;
    // When a loop is active, any bar outside the loop range is a transient
    // engine state (the tick just before the loop wraps back). Discard it so
    // the view never snaps away from the loop window.
    if (state.loopBar && state.loopBarLength > 0) {
      const loopEnd = state.loopBarIndex + state.loopBarLength;
      if (phraseBar < state.loopBarIndex || phraseBar >= loopEnd) return;
    }
    if (state.cameraMode) {
      return;
    }
    // Snap the view anchor to segment boundaries — only shift when phraseBar
    // leaves the current window [activeBar, activeBar + segments).
    const inWindow = phraseBar >= state.activeBar && phraseBar < state.activeBar + segments;
    if (inWindow) return;
    // Advance to the next segment window that contains phraseBar.
    const newAnchor = Math.floor(phraseBar / segments) * segments;
    setPlaybackViewAnchor(newAnchor);
  }

  function updatePlayhead() {
    if (!state.playing) return;
    const playback = state.engine.getPlaybackState();
    if (!playback.playing) return;
    const { bar: displayBar, step: displayStep } = currentDisplayedBeat();
    state.playheadStep = displayStep;
    updatePositionDisplay(displayBar, displayStep);
    // When looping, clamp displayBar to the loop range to avoid out-of-range
    // transient states from briefly flickering the view.
    if (state.loopBar && state.loopBarLength > 0) {
      const loopEnd = state.loopBarIndex + state.loopBarLength;
      if (displayBar < state.loopBarIndex || displayBar >= loopEnd) {
        clearPlayhead();
        return;
      }
    }
    followPlaybackBar(displayBar);
    const playheadKey = `${state.activeBar}:${displayBar}:${displayStep}:${state.selected?.mode || ""}:${state.selected?.hit || ""}`;
    if (playheadKey === lastPlayheadKey) return;
    lastPlayheadKey = playheadKey;
    clearPlayheadMarks();
    // Which segment column is the playhead in?
    const seg = state.cameraMode ? displayBar : displayBar - state.activeBar;
    if (!state.cameraMode && seg >= 0 && seg < renderedSegments()) {
      stepGrid.querySelectorAll(`.step-button[data-base-step="${displayStep}"][data-seg="${seg}"]`).forEach((button) => {
        const step = Number(button.dataset.step ?? displayStep);
        const hitData = getHitData(button.dataset.hit, step, displayBar);
        button.classList.add(hitData.velocity > 0.005 ? "is-playhead" : "is-playhead-empty");
        activePlayheadButtons.push(button);
      });
    }
    const barButton = revealBarButton(displayBar);
    if (barButton) {
      barButton.classList.add("is-playhead-bar");
      activePlayheadBarButton = barButton;
    }
    if (!state.cameraMode && state.selected?.mode === "row") {
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
    loopBeatSelection,
    playBeatSelection,
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
