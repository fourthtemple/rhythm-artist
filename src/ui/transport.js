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
 * @param {(barIndex?: number, stepIndex?: number) => void} [deps.renderCameraPlayheadHits]
 * @param {() => void} [deps.clearCameraPlayheadHits]
 * @param {(barIndex?: number) => void} [deps.updatePlaybackTabHighlights]
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

export function cameraPageFollowStartForPosition(positionBars, visibleStartBars = 0, visibleEndBars = 1, totalBars = 1) {
  const songBars = Math.max(1, Math.round(finiteNumber(totalBars, 1)));
  const position = clampNumber(finiteNumber(positionBars, 0), 0, songBars);
  const currentBar = clampNumber(Math.floor(position), 0, songBars - 1);
  const visibleStart = clampNumber(finiteNumber(visibleStartBars, 0), 0, songBars);
  const visibleEnd = clampNumber(finiteNumber(visibleEndBars, visibleStart + 1), visibleStart, songBars);
  const triggerBar = Math.max(Math.floor(visibleStart), Math.ceil(visibleEnd - 0.02) - 1);
  const playheadBeforeView = position < visibleStart - 0.001;
  if (!playheadBeforeView && currentBar < triggerBar) return null;
  return currentBar;
}

export function cameraFollowScrollLeftForStart(followStartBars, barWidthPx = 1, maxScrollLeftPx = 0, startInsetPx = 0) {
  const barWidth = Math.max(1, finiteNumber(barWidthPx, 1));
  const maxScrollLeft = Math.max(0, finiteNumber(maxScrollLeftPx, 0));
  const startInset = Math.max(0, finiteNumber(startInsetPx, 0));
  const followStart = Math.max(0, finiteNumber(followStartBars, 0));
  const finalReachableStart = maxScrollLeft / barWidth;
  if (followStart >= finalReachableStart - 0.001) return Math.round(maxScrollLeft);
  return Math.round(clampNumber(followStart * barWidth - startInset, 0, maxScrollLeft));
}

export function clearRestartBarSelectionState(state) {
  if (!state || typeof state !== "object") return false;
  let changed = false;
  if (Array.isArray(state.selectedBars) && state.selectedBars.length) {
    state.selectedBars = [];
    changed = true;
  }
  if (state.barAnchor !== null && state.barAnchor !== undefined) {
    state.barAnchor = null;
    changed = true;
  }
  if (state.cameraBeatSelection?.lengthSteps) {
    state.cameraBeatSelection = null;
    changed = true;
  }
  return changed;
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
    renderCameraPlayheadHits,
    clearCameraPlayheadHits,
    updatePlaybackTabHighlights,
    selectStep,
    soundingStepForRow,
    getHitData,
    syncSelectedPitchDisplay
  } = deps;
  let beatUnsubscribe = null;
  let playheadTimers = new Set();
  let cameraBeatQueue = [];
  let lastPlayheadKey = "";
  let activePlayheadButtons = [];
  let lastCameraBeat = null;
  let lastCameraPanTarget = -1;
  let lastCameraPanAt = 0;
  let lastCameraFollowGeometryKey = "";

  const visibleSegments = () => Math.max(1, Math.round(Number(state.segmentsCount) || 1));
  const renderedSegments = () => Math.max(visibleSegments(), Math.round(Number(state.renderedSegmentsCount) || visibleSegments()));
  const totalSongBars = () => Math.max(1, state.config.patterns.jazz.bars.length);

  function clearScheduledPlayheadUpdates() {
    if (typeof window !== "undefined") {
      playheadTimers.forEach((timer) => window.clearTimeout(timer));
    }
    playheadTimers.clear();
  }

  function schedulePlayheadUpdate(scheduledTime) {
    if (typeof window === "undefined") return;
    const contextTime = finiteNumber(state.engine?.context?.currentTime, 0);
    const delayMs = Math.max(0, Math.round((finiteNumber(scheduledTime, contextTime) - contextTime) * 1000));
    const timer = window.setTimeout(() => {
      playheadTimers.delete(timer);
      updatePlayhead();
    }, delayMs);
    playheadTimers.add(timer);
    if (playheadTimers.size > 128) {
      const [oldest] = playheadTimers;
      window.clearTimeout(oldest);
      playheadTimers.delete(oldest);
    }
  }

  function attachBeatTracker() {
    if (beatUnsubscribe) beatUnsubscribe();
    clearScheduledPlayheadUpdates();
    cameraBeatQueue = [];
    lastCameraBeat = null;
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
      schedulePlayheadUpdate(scheduledTime);
    });
  }

  function detachBeatTracker() {
    if (beatUnsubscribe) {
      beatUnsubscribe();
      beatUnsubscribe = null;
    }
    clearScheduledPlayheadUpdates();
    cameraBeatQueue = [];
    lastCameraBeat = null;
  }

  function resetCameraScroll({ preservePosition = false } = {}) {
    const nextScrollLeft = preservePosition ? stepGrid.scrollLeft : 0;
    if (stepGrid.scrollLeft !== nextScrollLeft) stepGrid.scrollLeft = nextScrollLeft;
    lastCameraPanTarget = -1;
    lastCameraPanAt = 0;
    lastCameraFollowGeometryKey = "";
  }

  function resetPlayheadCache() {
    lastPlayheadKey = "";
  }

  function cameraLabelWidth() {
    const corner = stepGrid.querySelector(".step-header--corner");
    const width = corner?.getBoundingClientRect?.().width;
    return width > 0 ? width : 92;
  }

  function cameraPlaybackBarWidth(labelWidth = cameraLabelWidth()) {
    const totalBars = renderedSegments();
    const canvas = stepGrid.querySelector(".camera-grid-canvas");
    const canvasWidth = canvas?.getBoundingClientRect?.().width;
    if (canvasWidth > 0) return canvasWidth / totalBars;
    const contentWidth = Math.max(1, stepGrid.scrollWidth - labelWidth);
    return contentWidth / totalBars;
  }

  function cameraVisibleBarWindow(barWidth, labelWidth) {
    const canvas = stepGrid.querySelector(".camera-grid-canvas");
    const canvasRect = canvas?.getBoundingClientRect?.();
    const gridRect = stepGrid.getBoundingClientRect?.();
    if (canvasRect?.width > 0 && gridRect?.width > 0) {
      const visibleLeft = Math.max(canvasRect.left, gridRect.left + labelWidth);
      const visibleRight = Math.min(canvasRect.right, gridRect.right);
      if (visibleRight > visibleLeft) {
        return {
          start: Math.max(0, (visibleLeft - canvasRect.left) / Math.max(1, barWidth)),
          end: Math.max(0, (visibleRight - canvasRect.left) / Math.max(1, barWidth))
        };
      }
    }
    const contentViewportWidth = Math.max(1, stepGrid.clientWidth - labelWidth);
    const start = Math.max(0, stepGrid.scrollLeft / Math.max(1, barWidth));
    return { start, end: start + (contentViewportWidth / Math.max(1, barWidth)) };
  }

  function followCameraPlayback(positionBars) {
    if (!state.cameraMode || !state.cameraFollow) return;
    const labelWidth = cameraLabelWidth();
    const barWidth = cameraPlaybackBarWidth(labelWidth);
    const position = Math.max(0, finiteNumber(positionBars, 0));
    const startInset = Math.max(10, Math.min(48, barWidth * 0.35));
    const geometryKey = `${stepGrid.clientWidth}:${renderedSegments()}:${visibleSegments()}:${Math.round(barWidth * 100)}`;
    if (geometryKey !== lastCameraFollowGeometryKey) {
      lastCameraFollowGeometryKey = geometryKey;
      lastCameraPanTarget = -1;
      lastCameraPanAt = 0;
    }
    const visibleBars = cameraVisibleBarWindow(barWidth, labelWidth);
    const visibleStartBar = Math.max(0, visibleBars.start);
    const visibleEndBar = Math.max(visibleStartBar, visibleBars.end);
    const followStartBar = cameraPageFollowStartForPosition(position, visibleStartBar, visibleEndBar, renderedSegments());
    if (followStartBar === null) return;
    const maxScrollLeft = Math.max(0, stepGrid.scrollWidth - stepGrid.clientWidth);
    const nextLeft = cameraFollowScrollLeftForStart(followStartBar, barWidth, maxScrollLeft, startInset);
    if (Math.abs(nextLeft - stepGrid.scrollLeft) < 1) return;

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const minRetargetDistance = Math.max(16, barWidth * 0.25);
    const retargetDistance = lastCameraPanTarget < 0 ? Infinity : Math.abs(nextLeft - lastCameraPanTarget);
    if (retargetDistance < minRetargetDistance && now - lastCameraPanAt < 360) return;

    lastCameraPanTarget = nextLeft;
    lastCameraPanAt = now;
    if (typeof stepGrid.scrollTo === "function") {
      stepGrid.scrollTo({ left: nextLeft, behavior: "smooth" });
    } else {
      stepGrid.scrollLeft = nextLeft;
    }
  }

  function queuedBeatAtTime(now) {
    if (!cameraBeatQueue.length) return null;
    const tolerance = 0.002;
    while (cameraBeatQueue.length > 1 && cameraBeatQueue[1].scheduledTime <= now + tolerance) {
      cameraBeatQueue.shift();
    }
    if (cameraBeatQueue[0].scheduledTime > now + tolerance) return lastCameraBeat;
    lastCameraBeat = cameraBeatQueue[0];
    return lastCameraBeat;
  }

  function currentDisplayedBeat() {
    const engine = state.engine;
    const totalBars = totalSongBars();
    const now = finiteNumber(engine?.context?.currentTime, 0);
    const queuedBeat = queuedBeatAtTime(now);
    if (queuedBeat) {
      const beat = queuedBeat;
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

  function startPlayheadLoop() {
    if (!state.playing) return;
    updatePlayhead();
  }

  function stopPlayheadLoop() {
    clearScheduledPlayheadUpdates();
  }

  async function startPlayback() {
    if (runningFromFile) {
      setStatus("Open the localhost version for audio");
      return;
    }
    setStatus("Starting audio");
    try {
      const resumeBeat = state.pausedPlayback
        ? {
          bar: Math.max(0, Math.round(Number(state.pausedPlayback.bar) || 0)),
          step: Math.max(0, Math.min(15, Math.round(Number(state.pausedPlayback.step) || 0)))
        }
        : null;
      const startBar = resumeBeat?.bar ?? state.activeBar;
      const startStep = resumeBeat?.step ?? 0;
      state.playheadStep = startStep;
      state.cameraPlayheadBar = startBar;
      state.cameraPlayheadStep = startStep;
      state.engine.setConfig(previewConfig());
      attachBeatTracker();
      await state.engine.start({
        style: "jazz",
        volume: 0.62,
        phraseBar: startBar,
        step: startStep
      });
      state.playing = true;
      state.pausedPlayback = null;
      const playButton = $("#play-toggle");
      if (playButton) {
        playButton.textContent = "Play";
        playButton.classList.add("is-active");
        playButton.setAttribute("aria-pressed", "true");
      }
      setStatus(`Playing from ${barLabel(startBar)}`);
      updatePositionDisplay(startBar, startStep);
      updatePlaybackTabHighlights?.(startBar);
      resetPlayheadCache();
      startUiTimer();
      startPlayheadLoop();
    } catch (error) {
      console.error("Rhythm sequencer audio failed to start", error);
      detachBeatTracker();
      state.playing = false;
      setStatus("Audio failed to start");
    }
  }

  function stopPlayback() {
    const pauseBeat = state.playing ? currentDisplayedBeat() : {
      bar: Math.max(0, Math.round(Number(state.cameraPlayheadBar ?? state.activeBar) || 0)),
      step: Math.max(0, Math.min(15, Math.round(Number(state.cameraPlayheadStep ?? state.playheadStep) || 0)))
    };
    state.engine.stop();
    state.playing = false;
    if (state.uiTimer) {
      window.clearInterval(state.uiTimer);
      state.uiTimer = null;
    }
    state.pausedPlayback = pauseBeat;
    state.playheadStep = pauseBeat.step;
    state.cameraPlayheadBar = pauseBeat.bar;
    state.cameraPlayheadStep = pauseBeat.step;
    const playButton = $("#play-toggle");
    if (playButton) {
      playButton.textContent = "Play";
      playButton.classList.remove("is-active");
      playButton.setAttribute("aria-pressed", "false");
    }
    setStatus(`Paused at ${barLabel(pauseBeat.bar)}`);
    stopPlayheadLoop();
    updatePositionDisplay(pauseBeat.bar, pauseBeat.step);
    updatePlaybackTabHighlights?.(pauseBeat.bar);
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
    state.pausedPlayback = null;
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

  function clearBeatLoop() {
    if (!state.loopBeatRange?.lengthSteps) return false;
    const preserveBeat = state.playing ? currentDisplayedBeat() : null;
    state.loopBeatRange = null;
    state.engine.setConfig(previewConfig());
    if (preserveBeat && state.engine.getPlaybackState().playing) {
      state.engine.seekToPhraseBar(preserveBeat.bar, preserveBeat.step);
      state.playheadStep = preserveBeat.step;
      state.cameraPlayheadBar = preserveBeat.bar;
      state.cameraPlayheadStep = preserveBeat.step;
      updatePositionDisplay(preserveBeat.bar, preserveBeat.step);
    }
    refreshLoopBarButton();
    return true;
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

  async function playFromBar(barIndex = state.activeBar) {
    const targetBar = clampNumber(Math.round(finiteNumber(barIndex, state.activeBar)), 0, totalSongBars() - 1);
    state.loopBeatRange = null;
    state.loopBar = false;
    state.loopBarLength = 0;
    state.loopBarIndex = targetBar;
    state.pausedPlayback = null;
    state.engine.setConfig(previewConfig());
    refreshLoopBarButton();
    if (!state.playing) await startPlayback();
    state.engine.seekToPhraseBar(targetBar, 0);
    state.playheadStep = 0;
    state.cameraPlayheadBar = targetBar;
    state.cameraPlayheadStep = 0;
    updatePositionDisplay(targetBar, 0);
    clearPlayhead();
    updatePlayhead();
    setStatus(`Playing from ${barLabel(targetBar)}`);
  }

  async function loopFromBar(barIndex = state.activeBar, length = 1) {
    const targetBar = clampNumber(Math.round(finiteNumber(barIndex, state.activeBar)), 0, totalSongBars() - 1);
    const loopLength = clampNumber(Math.round(finiteNumber(length, 1)), 1, totalSongBars() - targetBar);
    setLoopPlayback(targetBar, loopLength);
    state.pausedPlayback = null;
    state.engine.seekToPhraseBar(targetBar, 0);
    state.playheadStep = 0;
    state.cameraPlayheadBar = targetBar;
    state.cameraPlayheadStep = 0;
    updatePositionDisplay(targetBar, 0);
    if (!state.playing) await startPlayback();
    clearPlayhead();
    updatePlayhead();
    setStatus(loopLength === 1
      ? `Looping ${barLabel(targetBar)}`
      : `Looping ${barLabel(targetBar)}-${barLabel(targetBar + loopLength - 1)}`);
  }

  function clearRestartBarSelections() {
    if (!clearRestartBarSelectionState(state)) return false;
    buildBarTabs();
    renderStepGrid();
    return true;
  }

  function restartPlayback() {
    state.pausedPlayback = null;
    clearRestartBarSelections();
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
    }, 70);
  }

  function clearPlayheadMarks() {
    activePlayheadButtons.forEach((button) => {
      button.classList.remove("is-playhead", "is-playhead-empty");
    });
    activePlayheadButtons = [];
  }

  function clearPlayhead() {
    clearPlayheadMarks();
    clearCameraPlayheadHits?.();
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
    const playbackBar = ((Math.round(Number(phraseBar) || 0) % totalBars) + totalBars) % totalBars;
    // When a loop is active, any bar outside the loop range is a transient
    // engine state (the tick just before the loop wraps back). Discard it so
    // the view never snaps away from the loop window.
    if (state.loopBar && state.loopBarLength > 0) {
      const loopEnd = state.loopBarIndex + state.loopBarLength;
      if (playbackBar < state.loopBarIndex || playbackBar >= loopEnd) return;
    }
    if (state.cameraMode) {
      return;
    }
    // Snap the view anchor to segment boundaries — only shift when phraseBar
    // leaves the current window [activeBar, activeBar + segments).
    const inWindow = playbackBar >= state.activeBar && playbackBar < state.activeBar + segments;
    if (inWindow) return;
    // Advance to the next segment window that contains phraseBar.
    const newAnchor = Math.floor(playbackBar / segments) * segments;
    setPlaybackViewAnchor(newAnchor);
  }

  function updatePlayhead() {
    if (!state.playing) return;
    const playback = state.engine.getPlaybackState();
    if (!playback.playing) return;
    const { bar: displayBar, step: displayStep } = currentDisplayedBeat();
    state.playheadStep = displayStep;
    state.cameraPlayheadBar = displayBar;
    state.cameraPlayheadStep = displayStep;
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
    updatePositionDisplay(displayBar, displayStep);
    clearPlayheadMarks();
    updatePlaybackTabHighlights?.(displayBar);
    revealBarButton(displayBar);
    if (state.cameraMode) {
      renderCameraPlayheadHits?.(displayBar, displayStep);
      followCameraPlayback(displayBar + (displayStep / 16));
      return;
    }
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
    clearBeatLoop,
    toggleSelectedLoop,
    toggleBarLoop,
    toggleTwoBarLoop,
    playFullSong,
    playFromBar,
    loopFromBar,
    restartPlayback,
    previewDuckSound,
    previewHitSound,
    previewGameSound,
    clearPlayhead,
    updatePlayhead
  };
}
