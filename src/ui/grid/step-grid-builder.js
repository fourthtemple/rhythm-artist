// Step-grid and tab-strip builder controller.
//
// Owns the three DOM-build functions (buildStepGrid, buildLoopTabs,
// buildBarTabs) and the render-pass that syncs class state back onto existing
// elements (renderStepGrid). All event listeners attached to step-buttons and
// tab buttons are wired here too.
//
// It reaches the rest of the editor through the shared `state` object and a
// set of injected primitives. The editor keeps thin hoisted wrappers so
// existing call sites are unchanged.

import { visualBeatKindForStep } from "../../audio/rhythm-config.js";
import { syncStepGridLaneRows } from "./lane-grid-layout.js";
import { appendPianoRollLanes } from "../piano-roll/piano-roll-lanes.js";

/**
 * @param {object} deps
 * @param {object}   deps.state
 * @param {Element}  deps.stepGrid
 * @param {Element}  deps.barTabs
 * @param {Element}  deps.loopTabs
 * @param {Element|null} deps.loopCountInput
 * @param {Element}  deps.status
 * @param {() => number} deps.loopBarCount
 * @param {() => number} deps.maxLoopCount
 * @param {() => number} deps.sectionBarCount
 * @param {Record<string,number>} deps.DEFAULT_VELOCITY
 * @param {() => Array<{id:string,label:string,type:string,accent?:string}>} deps.gridRows
 * @param {() => Array<{id:string,label:string,type:string,accent?:string}>} [deps.pianoRollRows]
 * @param {(hit:string) => number} deps.trackStepCount
 * @param {() => number} deps.loopCount
 * @param {(barIndex?:number) => number} deps.localBarIndex
 * @param {(barIndex?:number) => number} deps.loopIndexForBar
 * @param {(loopIndex?:number) => number} deps.loopStartBar
 * @param {() => number} deps.activeLoopLength
 * @param {(start?:number, length?:number) => number} deps.clampLoopStart
 * @param {() => void} deps.syncActiveLoopToBar
 * @param {() => void} deps.clampActiveBar
 * @param {() => any}  deps.previewConfig
 * @param {() => void} deps.refreshLoopBarButton
 * @param {() => void} deps.clearPlayhead
 * @param {() => void} deps.renderSoloButtons
 * @param {(hit:string) => void} deps.toggleSolo
 * @param {(hit:string) => void} deps.toggleMute
 * @param {(value:number) => void} deps.paintSelectedVelocityPreview
 * @param {(hit:string) => void} deps.previewRowSelectionControls
 * @param {(hit:string, step:number, barIndex?:number, fallbackVelocity?:number) => void} deps.previewStepSelectionControls
 * @param {(hit:string, event?:object, options?:object) => void} deps.selectRowWithModifiers
 * @param {(hit:string, options?:object) => void} deps.selectRowToggle
 * @param {(hit:string, step:number, mode?:string, barIndex?:number, pressure?:number, generated?:boolean, options?:object) => void} deps.selectStep
 * @param {(hit:string, step:number, barIndex?:number) => any} deps.getHitData
 * @param {(hit:string, step:number, patch:any, barIndex?:number) => void} deps.setHitData
 * @param {(hit:string, step:number, velocity:number, barIndex?:number) => void} deps.setHitVelocity
 * @param {(edits:Array<{hit:string, step:number, velocity:number, barIndex:number}>) => void} [deps.setHitVelocities]
 * @param {(hit:string, step:number, options:any) => number} deps.displayedPitchForHit
 * @param {(pitch:number) => string} deps.formatPitch
 * @param {(pitch:number) => string} deps.noteNameForPitch
 * @param {(index:number, event:MouseEvent) => void} deps.toggleLoopMultiSelect
 * @param {(index:number, event:MouseEvent) => void} deps.toggleBarMultiSelect
 * @param {(event:MouseEvent, index:number) => void} deps.openLoopContextMenu
 * @param {(event:MouseEvent, index:number) => void} deps.openBarContextMenu
 * @param {(event:MouseEvent, hit:string) => void} deps.openTrackContextMenu
 * @param {(event:MouseEvent, items:any[]) => void} [deps.showContextMenu]
 * @param {(range:any) => void|Promise<void>} [deps.loopBeatSelection]
 * @param {(range:any) => void|Promise<void>} [deps.playBeatSelection]
 * @param {() => boolean|void} [deps.clearBeatLoop]
 * @param {(kind:string, id:string, fallbackIndex:number, gridTrackRows:number) => number} [deps.editorLaneGridRow]
 * @param {() => number} [deps.editorLaneCount]
 * @param {() => void} deps.resetSelectedPanel
 * @param {() => void} [deps.onAfterBuild] Called after buildStepGrid rebuilds the DOM (e.g. to re-append loop lanes).
 * @param {() => void} [deps.onAfterRender] Called after renderStepGrid syncs the visible bar window.
 */
export function createStepGridBuilder(deps) {
  const {
    state,
    stepGrid,
    barTabs,
    loopTabs,
    loopCountInput,
    status,
    loopBarCount = () => 32,
    maxLoopCount = () => 8,
    sectionBarCount = () => 8,
    DEFAULT_VELOCITY,
    gridRows,
    pianoRollRows = gridRows,
    trackStepCount,
    loopCount,
    localBarIndex,
    loopIndexForBar,
    loopStartBar,
    activeLoopLength,
    clampLoopStart,
    syncActiveLoopToBar,
    clampActiveBar,
    previewConfig,
    refreshLoopBarButton,
    clearPlayhead,
    renderSoloButtons,
    toggleSolo,
    toggleMute,
    paintSelectedVelocityPreview,
    previewRowSelectionControls,
    previewStepSelectionControls,
    selectRowWithModifiers,
    selectRowToggle,
    selectStep,
    getHitData,
    setHitData,
    setHitVelocity,
    setHitVelocities,
    displayedPitchForHit,
    formatPitch,
    noteNameForPitch,
    toggleLoopMultiSelect,
    toggleBarMultiSelect,
    openLoopContextMenu,
    openBarContextMenu,
    openTrackContextMenu,
    showContextMenu,
    loopBeatSelection,
    playBeatSelection,
    clearBeatLoop,
    editorLaneGridRow = null,
    editorLaneCount = null,
    resetSelectedPanel
  } = deps;
  const onAfterBuild = deps.onAfterBuild ?? (() => {});
  const onAfterRender = deps.onAfterRender ?? (() => {});
  const BASE_STEPS_PER_BAR = 16;
  const GRID_COLUMNS_PER_BAR = 96;
  const ZOOM_REFERENCE_GRID_WIDTH = 920;
  const CAMERA_RULER_HEIGHT = 20;
  let cameraCanvas = null;
  let cameraCanvasWrap = null;
  let cameraPlaybackLayer = null;
  let cameraPlaybackBeat = null;
  let cameraPlaybackHitsLayer = null;
  let cameraRulerCanvas = null;
  let cameraRulerWrap = null;
  let cameraCanvasMetrics = null;
  let cameraCanvasColors = { accent: "#8bd8bd", accent2: "#f5d76e" };
  let cameraSelectionOverlay = null;
  let cameraHoverOverlay = null;
  let cameraHover = null;
  let cameraPlayingTargets = [];
  let cameraPlayingKey = "";
  let cameraPointerClient = null;
  let cameraPointerInsideWrap = false;
  let cameraHoverScrollRaf = 0;
  let cameraScrollHoverBound = false;
  let cameraDrag = null;
  let cameraPaintDrag = null;
  let cameraSuppressClick = false;
  let cameraPointerHandledClick = false;
  let cameraRenderRaf = 0;
  let cameraSelectionCommitRaf = 0;
  let cameraSelectionCommitTimer = 0;
  let pendingCameraSelectionCommit = null;
  let deferredDrawRenderTimer = 0;
  let queuedVelocityFlushTimer = 0;
  let lastCameraPaintAt = 0;
  let lastCameraInteractionAt = 0;
  let playbackTabsBar = null;
  let renderedBarTabsLoop = null;
  let skipNextBarClickIndex = null;
  const queuedVelocityEdits = new Map();
  const normalizeStepPosition = (value) => {
    const step = Number(value);
    if (!Number.isFinite(step) || step <= 0) return 0;
    if (step >= BASE_STEPS_PER_BAR) return BASE_STEPS_PER_BAR - 1;
    return Number(step.toFixed(4));
  };
  const rowStepCount = (hit) => {
    const count = Math.round(Number(trackStepCount?.(hit)) || BASE_STEPS_PER_BAR);
    return Math.max(1, Math.min(128, count));
  };
  const visualStepToPatternStep = (visualStep, stepsPerBar) =>
    normalizeStepPosition((visualStep * BASE_STEPS_PER_BAR) / stepsPerBar);
  const currentTimeSignature = () => state.config?.timeSignature || state.timeSig || "4/4";
  const defaultVelocityForHit = (hit, fallback = 0.5) => {
    const baseHit = String(hit || "").split("~")[0];
    const value = state.config?.trackDefaultVelocities?.[hit]
      ?? state.config?.trackDefaultVelocities?.[baseHit]
      ?? DEFAULT_VELOCITY[hit]
      ?? DEFAULT_VELOCITY[baseHit]
      ?? fallback;
    const number = Number(value);
    return Math.max(0, Math.min(0.9, Number.isFinite(number) ? number : fallback));
  };
  const velocityEditKey = (hit, step, barIndex) => `${barIndex}::${hit}::${step}`;
  const cameraTargetKey = (target) => target ? velocityEditKey(target.hit, target.step, target.bar) : "";
  const queuedVelocityFor = (hit, step, barIndex) =>
    queuedVelocityEdits.get(velocityEditKey(hit, step, barIndex))?.velocity ?? null;
  const hasVelocityValue = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
  const visualVelocityFor = (hit, step, barIndex) => {
    const queued = queuedVelocityFor(hit, step, barIndex);
    if (hasVelocityValue(queued)) return Number(queued);
    return getHitData(hit, step, barIndex).velocity;
  };
  const nowMs = () => (typeof window !== "undefined" ? window.performance?.now?.() ?? Date.now() : Date.now());
  const markCameraInteraction = () => {
    lastCameraInteractionAt = nowMs();
  };
  const lastCameraBusyAt = () => Math.max(lastCameraPaintAt, lastCameraInteractionAt);
  function scheduleDeferredDrawRender(scrollLeft = stepGrid.scrollLeft, scrollTop = stepGrid.scrollTop) {
    if (typeof window === "undefined") {
      renderStepGrid();
      return;
    }
    window.clearTimeout(deferredDrawRenderTimer);
    const now = nowMs();
    const quietDelay = Math.max(140, 320 - Math.max(0, now - lastCameraBusyAt()));
    deferredDrawRenderTimer = window.setTimeout(() => {
      const current = nowMs();
      if (current - lastCameraBusyAt() < 220) {
        scheduleDeferredDrawRender(scrollLeft, scrollTop);
        return;
      }
      deferredDrawRenderTimer = 0;
      renderStepGrid();
      stepGrid.scrollLeft = scrollLeft;
      stepGrid.scrollTop = scrollTop;
    }, quietDelay);
  }
  function flushQueuedVelocityEdits({ render = true } = {}) {
    if (typeof window !== "undefined") {
      window.clearTimeout(queuedVelocityFlushTimer);
      queuedVelocityFlushTimer = 0;
      const now = nowMs();
      if (now - lastCameraBusyAt() < 320) {
        queuedVelocityFlushTimer = window.setTimeout(() => flushQueuedVelocityEdits({ render }), 320);
        return;
      }
    }
    const edits = [...queuedVelocityEdits.values()];
    queuedVelocityEdits.clear();
    if (!edits.length) return;
    if (typeof setHitVelocities === "function") setHitVelocities(edits);
    else edits.forEach((edit) => setHitVelocity(edit.hit, edit.step, edit.velocity, edit.barIndex));
    if (render) scheduleDeferredDrawRender();
  }
  function queueHitVelocity(hit, step, velocity, barIndex, delay = 160) {
    queuedVelocityEdits.set(velocityEditKey(hit, step, barIndex), { hit, step, velocity, barIndex });
    if (typeof window === "undefined") {
      flushQueuedVelocityEdits({ render: false });
      return;
    }
    window.clearTimeout(queuedVelocityFlushTimer);
    queuedVelocityFlushTimer = window.setTimeout(() => flushQueuedVelocityEdits(), delay);
  }
  function afterInputPaint(callback) {
    if (typeof window === "undefined") {
      callback();
      return;
    }
    window.requestAnimationFrame(() => window.setTimeout(callback, 0));
  }
  function previewStepControls(hit, step, barIndex, velocity, defer = false) {
    const run = () => {
      if (previewStepSelectionControls) previewStepSelectionControls(hit, step, barIndex, velocity);
      else paintSelectedVelocityPreview?.(velocity);
    };
    if (defer) afterInputPaint(run);
    else run();
  }
  function commitCameraSelection({ target, previousSelection, visualVelocity, storedVelocity, scrollLeft, scrollTop }) {
    if (!target || !state.config.patterns.jazz.bars[target.bar]) return;
    if (previousSelection && !sameCameraTarget(previousSelection, target)) {
      paintCameraCellNow(previousSelection, { selected: false });
    }
    selectStep(target.hit, target.step, "step", target.bar, state.intensity, target.type === "generated", {
      deferTrackPanels: true,
      ...(storedVelocity <= 0.005 ? { previewVelocity: visualVelocity } : {})
    });
    updateCameraTrackSelectionNow();
    setCameraHover(target);
    paintCameraCellNow(target, { selected: true, velocity: visualVelocity });
    scheduleDeferredDrawRender(scrollLeft, scrollTop);
  }
  function scheduleCameraSelectionCommit(commit) {
    pendingCameraSelectionCommit = commit;
    if (typeof window === "undefined") {
      const pending = pendingCameraSelectionCommit;
      pendingCameraSelectionCommit = null;
      commitCameraSelection(pending);
      return;
    }
    if (cameraSelectionCommitRaf) window.cancelAnimationFrame(cameraSelectionCommitRaf);
    if (cameraSelectionCommitTimer) {
      window.clearTimeout(cameraSelectionCommitTimer);
      cameraSelectionCommitTimer = 0;
    }
    cameraSelectionCommitTimer = window.setTimeout(() => {
      if (nowMs() - lastCameraBusyAt() < 120) {
        scheduleCameraSelectionCommit(pendingCameraSelectionCommit);
        return;
      }
      cameraSelectionCommitTimer = 0;
      const pending = pendingCameraSelectionCommit;
      pendingCameraSelectionCommit = null;
      if (pending) commitCameraSelection(pending);
    }, 90);
  }
  function cancelCameraSelectionCommit() {
    pendingCameraSelectionCommit = null;
    if (typeof window === "undefined") return;
    if (cameraSelectionCommitRaf) window.cancelAnimationFrame(cameraSelectionCommitRaf);
    if (cameraSelectionCommitTimer) window.clearTimeout(cameraSelectionCommitTimer);
    cameraSelectionCommitRaf = 0;
    cameraSelectionCommitTimer = 0;
  }

  const visibleSegmentCount = () => Math.max(1, Math.round(Number(state.segmentsCount) || 2));
  const totalSegmentCount = () => Math.max(1, state.config?.patterns?.jazz?.bars?.length || loopBarCount());
  const gridStartBar = () => state.cameraMode ? 0 : Math.max(0, Math.round(Number(state.activeBar) || 0));
  const barIndexForSegment = (seg) => gridStartBar() + seg;
  const renderedSegmentCount = () => {
    const visible = visibleSegmentCount();
    const total = totalSegmentCount();
    if (state.cameraMode) return total;
    const available = Math.max(visible, total - Math.max(0, Math.round(Number(state.activeBar) || 0)));
    return Math.max(visible, Math.min(available, visible));
  };
  const selectedBarIsVisible = () => {
    if (!state.selected) return false;
    if (state.cameraMode) return true;
    const bar = Math.max(0, Math.round(Number(state.selected.bar ?? state.activeBar) || 0));
    const start = Math.max(0, Math.round(Number(state.activeBar) || 0));
    return bar >= start && bar < start + visibleSegmentCount();
  };
  const installRulerDragScroll = (container) => {
    if (!container || container.dataset.rulerDragScroll === "1") return;
    container.dataset.rulerDragScroll = "1";
    let drag = null;
    container.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        scrollLeft: container.scrollLeft,
        moved: false
      };
      container.setPointerCapture?.(event.pointerId);
      container.classList.add("is-drag-armed");
    });
    container.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const delta = event.clientX - drag.startX;
      if (Math.abs(delta) >= 4) drag.moved = true;
      if (!drag.moved) return;
      container.scrollLeft = drag.scrollLeft - delta;
      container.classList.add("is-dragging");
      event.preventDefault();
    });
    const finish = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const moved = drag.moved;
      drag = null;
      container.releasePointerCapture?.(event.pointerId);
      container.classList.remove("is-drag-armed");
      container.classList.remove("is-dragging");
      if (moved) {
        container.dataset.suppressNextClick = "1";
        window.setTimeout(() => {
          delete container.dataset.suppressNextClick;
        }, 0);
        event.preventDefault();
      }
    };
    container.addEventListener("pointerup", finish);
    container.addEventListener("pointercancel", finish);
    container.addEventListener("click", (event) => {
      if (container.dataset.suppressNextClick !== "1") return;
      delete container.dataset.suppressNextClick;
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
    }, true);
  };
  const syncSelectionAfterNavigation = () => {
    if (!state.selected) return;
    if (state.selected.mode === "row") {
      selectStep(state.selected.hit, state.selected.step, "row", state.activeBar);
      return;
    }
    if (selectedBarIsVisible()) {
      selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step", state.selected.bar ?? state.activeBar);
      return;
    }
    resetSelectedPanel();
  };

  function makeTrackLabel(hit, label, type, accent = "#7dd3fc") {
    const rowLabel = document.createElement("div");
    rowLabel.className = `track-label ${type === "generated" ? "is-generated" : ""}`;
    rowLabel.dataset.hit = hit;
    rowLabel.dataset.laneKey = `grid:${hit}`;
    rowLabel.dataset.type = type;
    rowLabel.style.setProperty("--track-accent", accent);
    rowLabel.style.setProperty("--group-accent", accent);
    rowLabel.tabIndex = 0;
    rowLabel.title = `Select ${label} row · Shift-click for a range · ⌘/Ctrl-click to toggle`;
    const rowText = document.createElement("span");
    rowText.textContent = label;
    rowText.title = label;
    const trackStateButtons = document.createElement("div");
    trackStateButtons.className = "track-state-buttons";
    const soloButton = document.createElement("button");
    soloButton.type = "button";
    soloButton.className = "solo-button track-row-control";
    soloButton.dataset.soloTrack = hit;
    soloButton.textContent = "S";
    soloButton.title = `Solo ${label}`;
    soloButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSolo(hit);
    });
    const muteButton = document.createElement("button");
    muteButton.type = "button";
    muteButton.className = "mute-button track-row-control";
    muteButton.dataset.muteTrack = hit;
    muteButton.textContent = "M";
    muteButton.title = `Mute ${label}`;
    muteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleMute(hit);
    });
    trackStateButtons.append(soloButton, muteButton);
    const selectRowLabelNow = (event) => {
      const selectionEvent = {
        shiftKey: Boolean(event.shiftKey),
        metaKey: Boolean(event.metaKey),
        ctrlKey: Boolean(event.ctrlKey)
      };
      previewTrackSelectionNow(hit, selectionEvent);
      afterNextPaint(() => {
        selectRowWithModifiers(hit, selectionEvent, { deferTrackPanels: true, bottomTab: "note" });
        updateCameraTrackSelectionNow();
        renderStepGrid();
      });
    };
    rowLabel.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target?.closest?.(".track-row-control")) return;
      event.preventDefault();
      selectRowLabelNow(event);
    });
    rowLabel.addEventListener("contextmenu", (event) => {
      if (!state.selectedTracks.includes(hit)) {
        selectRowWithModifiers(hit, {}, { deferTrackPanels: true });
        updateCameraTrackSelectionNow();
        afterNextPaint(renderStepGrid);
      }
      openTrackContextMenu(event, hit, rowLabel.dataset.laneKey);
    });
    rowLabel.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectRowLabelNow(event);
    });
    rowLabel.append(rowText, trackStateButtons);
    return rowLabel;
  }

  function previewTrackSelectionNow(hit, event = {}) {
    const shift = Boolean(event.shiftKey);
    const meta = Boolean(event.metaKey || event.ctrlKey);
    const trackOnlySelected = !state.selected && state.selectedTracks.length === 1 && state.selectedTracks[0] === hit;
    let selected = [hit];
    if (!shift && !meta && trackOnlySelected) {
      selected = [];
    } else if (shift && state.trackAnchor && state.gridTrackIds.includes(state.trackAnchor)) {
      const a = state.gridTrackIds.indexOf(state.trackAnchor);
      const b = state.gridTrackIds.indexOf(hit);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        selected = state.gridTrackIds.slice(lo, hi + 1);
      }
    } else if (meta) {
      const set = new Set(state.selectedTracks);
      if (set.has(hit) && set.size > 1) set.delete(hit);
      else set.add(hit);
      selected = [...set];
    }
    const selectedSet = new Set(selected);
    stepGrid.querySelectorAll(".track-label").forEach((item) => {
      item.classList.toggle("is-selected-row", selectedSet.has(item.dataset.hit));
    });
    document.querySelectorAll(".track-explorer-row[data-track-id]").forEach((row) => {
      row.classList.toggle("is-selected", selectedSet.has(row.dataset.trackId));
    });
  }

  function canvasCssColor(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function fillRoundedRect(ctx, x, y, width, height, radius, fillStyle) {
    roundedRect(ctx, x, y, width, height, radius);
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  function strokeRoundedRect(ctx, x, y, width, height, radius, strokeStyle, lineWidth = 1) {
    roundedRect(ctx, x, y, width, height, radius);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  function colorToRgb(color, fallback = "#7dd3fc") {
    const value = String(color || fallback).trim();
    const hex = value.startsWith("#") ? value.slice(1) : value;
    const expanded = hex.length === 3
      ? hex.split("").map((char) => `${char}${char}`).join("")
      : hex;
    if (!/^[0-9a-f]{6}$/i.test(expanded)) return colorToRgb(fallback, "#7dd3fc");
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16)
    };
  }

  function colorAlpha(color, alpha, fallback = "#7dd3fc") {
    const { r, g, b } = colorToRgb(color, fallback);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function drawCameraStepPad(ctx, {
    x,
    y,
    width,
    height,
    velocity,
    generated,
    selected,
    hovered,
    playing,
    trackColor,
    accent,
    accent2
  }) {
    const radius = Math.min(5, height / 2);
    const level = Math.max(0, Math.min(1, velocity / 0.95));
    const isOn = velocity > 0.005;
    const activeColor = trackColor || (generated ? "#86efac" : "#7dd3fc");
    const visualLevel = isOn ? Math.max(0.24, level) : level;

    fillRoundedRect(ctx, x, y, width, height, radius, "rgba(3,8,13,0.28)");

    if (width >= 4 && height >= 7) {
      ctx.strokeStyle = "rgba(0,0,0,0.24)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + radius, y + 0.5);
      ctx.lineTo(x + width - radius, y + 0.5);
      ctx.stroke();

      ctx.strokeStyle = "rgba(255,255,255,0.012)";
      ctx.beginPath();
      ctx.moveTo(x + radius, y + height - 0.5);
      ctx.lineTo(x + width - radius, y + height - 0.5);
      ctx.stroke();
    }

    strokeRoundedRect(
      ctx,
      x + 0.5,
      y + 0.5,
      Math.max(1, width - 1),
      Math.max(1, height - 1),
      radius,
      "rgba(255,255,255,0.008)",
      1
    );

    if (!isOn && !hovered && !selected) return;

    if (width >= 3 && height >= 6) {
      const inset = Math.min(3, Math.max(1.2, width * 0.14));
      const innerX = x + inset;
      const innerY = y + 3;
      const innerW = Math.max(1, width - inset * 2);
      const innerH = Math.max(2, height - 6);
      const innerRadius = Math.max(1, Math.min(radius - 1, innerH / 2));

      if (isOn) {
        fillRoundedRect(
          ctx,
          innerX,
          innerY,
          innerW,
          innerH,
          innerRadius,
          colorAlpha(activeColor, 0.2)
        );
        strokeRoundedRect(
          ctx,
          innerX + 0.5,
          innerY + 0.5,
          Math.max(1, innerW - 1),
          Math.max(1, innerH - 1),
          innerRadius,
          colorAlpha(activeColor, 0.42),
          1
        );
        const meterH = Math.max(5, innerH * visualLevel);
        const meterY = innerY + innerH - meterH;
        if (meterY + meterH + 1 < y + height) {
          fillRoundedRect(
            ctx,
            innerX + 0.5,
            meterY + 1.5,
            Math.max(1, innerW - 1),
            meterH,
            Math.min(innerRadius, meterH / 2),
            "rgba(0,0,0,0.32)"
          );
        }
        const hitGradient = ctx.createLinearGradient(innerX, meterY, innerX, innerY + innerH);
        hitGradient.addColorStop(0, colorAlpha(activeColor, 0.96));
        hitGradient.addColorStop(0.68, colorAlpha(activeColor, 0.82));
        hitGradient.addColorStop(1, colorAlpha(activeColor, 0.68));
        fillRoundedRect(ctx, innerX, meterY, innerW, meterH, Math.min(innerRadius, meterH / 2), hitGradient);

        strokeRoundedRect(
          ctx,
          innerX + 0.5,
          meterY + 0.5,
          Math.max(1, innerW - 1),
          Math.max(1, meterH - 1),
          Math.min(innerRadius, meterH / 2),
          "rgba(255,255,255,0.26)",
          1
        );

        if (meterH >= 5) {
          const shineY = meterY + Math.max(1.2, meterH * 0.16);
          ctx.strokeStyle = "rgba(255,255,255,0.22)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(innerX + Math.min(2, innerW * 0.2), shineY);
          ctx.lineTo(innerX + innerW - Math.min(2, innerW * 0.2), shineY);
          ctx.stroke();

          ctx.strokeStyle = "rgba(0,0,0,0.26)";
          ctx.beginPath();
          ctx.moveTo(innerX + Math.min(2, innerW * 0.2), meterY + meterH - 1.2);
          ctx.lineTo(innerX + innerW - Math.min(2, innerW * 0.2), meterY + meterH - 1.2);
          ctx.stroke();
        }
      }
    }

    if (playing && isOn) {
      const playInset = Math.min(2.2, Math.max(1, width * 0.12));
      const playX = x + playInset;
      const playY = y + playInset;
      const playW = Math.max(1, width - playInset * 2);
      const playH = Math.max(1, height - playInset * 2);
      const playRadius = Math.max(1, Math.min(radius - 0.5, playH / 2));
      fillRoundedRect(ctx, playX, playY, playW, playH, playRadius, colorAlpha(activeColor, 0.16));
      strokeRoundedRect(ctx, playX + 0.5, playY + 0.5, Math.max(1, playW - 1), Math.max(1, playH - 1), playRadius, colorAlpha(activeColor, 0.96), 1.5);
      strokeRoundedRect(ctx, x + 1, y + 1, Math.max(1, width - 2), Math.max(1, height - 2), Math.max(1, radius - 1), colorAlpha(activeColor, 0.34), 1);
    }

    if (hovered && !selected) {
      strokeRoundedRect(ctx, x - 1, y - 1, width + 2, height + 2, radius + 1, colorAlpha(activeColor, 0.92), 1.25);
    }

    if (selected) {
      strokeRoundedRect(ctx, x - 1, y - 1, width + 2, height + 2, radius + 1, colorAlpha(activeColor, 0.98), 2);
    } else if (isOn && width >= 4) {
      strokeRoundedRect(
        ctx,
        x + 0.5,
        y + 0.5,
        Math.max(1, width - 1),
        Math.max(1, height - 1),
        radius,
        colorAlpha(activeColor, 0.22),
        1
      );
    }
  }

  function cameraRowMetrics() {
    if (!cameraCanvasWrap) return [];
    const wrapRect = cameraCanvasWrap.getBoundingClientRect();
    return gridRows().map(({ id, label, type, accent }, index) => {
      const labelEl = stepGrid.querySelector(`.track-label[data-hit="${CSS.escape(id)}"]`);
      const rect = labelEl?.getBoundingClientRect();
      const fallbackTop = index * 38;
      return {
        hit: id,
        label,
        type,
        accent: accent || "#7dd3fc",
        top: rect ? rect.top - wrapRect.top : fallbackTop,
        height: rect ? rect.height : 32,
        steps: rowStepCount(id)
      };
    });
  }

  function renderCameraRuler(cssWidth, barWidth, dpr) {
    if (!cameraRulerCanvas || !cameraRulerWrap) return;
    const cssHeight = Math.max(1, cameraRulerWrap.clientHeight || CAMERA_RULER_HEIGHT);
    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);
    if (cameraRulerCanvas.width !== pixelWidth) cameraRulerCanvas.width = pixelWidth;
    if (cameraRulerCanvas.height !== pixelHeight) cameraRulerCanvas.height = pixelHeight;
    cameraRulerCanvas.style.width = `${cssWidth}px`;
    cameraRulerCanvas.style.height = `${cssHeight}px`;

    const ctx = cameraRulerCanvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const muted = canvasCssColor("--muted", "#8f9bae");
    const accent2 = cameraCanvasColors.accent2 || canvasCssColor("--accent-2", "#f5d76e");
    const line = canvasCssColor("--line", "#27313d");
    ctx.fillStyle = "#151c28";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const selectedBars = new Set(Array.isArray(state.selectedBars) ? state.selectedBars : []);
    if (selectedBars.size) {
      for (let bar = 0; bar < renderedSegmentCount(); bar += 1) {
        const absoluteBar = barIndexForSegment(bar);
        if (!selectedBars.has(absoluteBar)) continue;
        const x = Math.round(bar * barWidth);
        const width = Math.max(2, Math.round(barWidth));
        ctx.fillStyle = "rgba(245, 215, 110, 0.16)";
        ctx.fillRect(x, 0, width, cssHeight);
        ctx.strokeStyle = "rgba(245, 215, 110, 0.72)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, 0.5, Math.max(1, width - 1), Math.max(1, cssHeight - 1));
      }
    }

    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let bar = 0; bar <= renderedSegmentCount(); bar += 1) {
      const x = Math.round(bar * barWidth) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssHeight);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    for (let bar = 0; bar < renderedSegmentCount(); bar += 1) {
      for (let beat = 1; beat < 4; beat += 1) {
        const x = Math.round(bar * barWidth + (beat * barWidth) / 4) + 0.5;
        ctx.moveTo(x, cssHeight * 0.52);
        ctx.lineTo(x, cssHeight);
      }
    }
    ctx.stroke();

    ctx.font = "700 9px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillStyle = accent2;
    for (let bar = 0; bar < renderedSegmentCount(); bar += 1) {
      const x = bar * barWidth + 5;
      ctx.fillText(`Bar ${bar + 1}`, x, 2);
    }
    ctx.font = "9px system-ui, sans-serif";
    ctx.fillStyle = muted;
    for (let bar = 0; bar < renderedSegmentCount(); bar += 1) {
      if (barWidth < 96 && bar % 2 !== 0) continue;
      for (let step = 0; step < BASE_STEPS_PER_BAR; step += 4) {
        const x = bar * barWidth + (step * barWidth) / BASE_STEPS_PER_BAR + 5;
        ctx.fillText(String(step + 1).padStart(2, "0"), x, 11);
      }
    }
  }

  function renderCameraCanvas() {
    if (!state.cameraMode || !cameraCanvas || !cameraCanvasWrap) return;
    const cssWidth = Math.max(1, cameraCanvasWrap.clientWidth || cameraCanvasWrap.getBoundingClientRect().width || 1);
    const cssHeight = Math.max(1, cameraCanvasWrap.clientHeight || cameraCanvasWrap.getBoundingClientRect().height || 1);
    if (cssWidth <= 1 || cssHeight <= 1) {
      requestCameraCanvasRender();
      return;
    }
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 1.25));
    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);
    if (cameraCanvas.width !== pixelWidth) cameraCanvas.width = pixelWidth;
    if (cameraCanvas.height !== pixelHeight) cameraCanvas.height = pixelHeight;
    cameraCanvas.style.width = `${cssWidth}px`;
    cameraCanvas.style.height = `${cssHeight}px`;

    const ctx = cameraCanvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const accent = canvasCssColor("--accent", "#8bd8bd");
    const accent2 = canvasCssColor("--accent-2", "#f5d76e");
    const line = canvasCssColor("--line", "#27313d");
    const barWidth = cssWidth / Math.max(1, renderedSegmentCount());
    const rows = cameraRowMetrics();
    cameraCanvasColors = { accent, accent2 };
    cameraCanvasMetrics = { barWidth, rows, cssWidth, dpr };

    ctx.fillStyle = "#101620";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let bar = 0; bar <= renderedSegmentCount(); bar += 1) {
      const x = Math.round(bar * barWidth) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssHeight);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    for (let bar = 0; bar < renderedSegmentCount(); bar += 1) {
      for (let beat = 1; beat < 4; beat += 1) {
        const x = Math.round(bar * barWidth + (beat * barWidth) / 4) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, cssHeight);
      }
    }
    ctx.stroke();
    renderCameraRuler(cssWidth, barWidth, dpr);

    rows.forEach((row) => {
      const rowTop = row.top;
      const rowHeight = row.height;
      ctx.fillStyle = colorAlpha(row.accent, row.type === "generated" ? 0.045 : 0.028);
      ctx.fillRect(0, rowTop, cssWidth, rowHeight);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(0, Math.round(rowTop + rowHeight) + 0.5);
      ctx.lineTo(cssWidth, Math.round(rowTop + rowHeight) + 0.5);
      ctx.stroke();

      const stepGap = Math.max(0.5, Math.min(4, 80 / Math.max(1, row.steps * visibleSegmentCount())));
      const stepWidth = Math.max(1, barWidth / row.steps);
      const cellY = rowTop + 5;
      const cellH = Math.max(4, rowHeight - 10);
      for (let bar = 0; bar < renderedSegmentCount(); bar += 1) {
        if (!state.config.patterns.jazz.bars[bar]) continue;
        for (let visualStep = 0; visualStep < row.steps; visualStep += 1) {
          const step = visualStepToPatternStep(visualStep, row.steps);
          const hitData = getHitData(row.hit, step, bar);
          const velocity = visualVelocityFor(row.hit, step, bar);
          const cellX = bar * barWidth + visualStep * stepWidth + stepGap / 2;
          const cellW = Math.max(1, stepWidth - stepGap);
          const selected = state.selected?.hit === row.hit
            && state.selected?.step === step
            && (state.selected?.bar ?? state.activeBar) === bar;
          drawCameraStepPad(ctx, {
            x: cellX,
            y: cellY,
            width: cellW,
            height: cellH,
            velocity,
            generated: row.type === "generated" && hitData.generated,
            selected,
            hovered: false,
            playing: false,
            trackColor: row.accent,
            accent,
            accent2
          });
        }
      }
    });

    redrawCameraPlaybackOverlay();
    updateCameraSelectionOverlay();
    updateCameraHoverOverlay();
  }

  function requestCameraCanvasRender() {
    if (cameraRenderRaf) return;
    cameraRenderRaf = window.requestAnimationFrame(() => {
      cameraRenderRaf = 0;
      renderCameraCanvas();
    });
  }

  function appendCurrentPianoRollLanes(startRow) {
    return appendPianoRollLanes({
      state,
      stepGrid,
      rows: pianoRollRows(),
      startRow,
      renderedSegmentCount: renderedSegmentCount(),
      viewStartBar: gridStartBar(),
      baseStepsPerBar: BASE_STEPS_PER_BAR,
      makeTrackLabel,
      normalizeStepPosition,
      setHitData,
      selectStep,
      renderStepGrid,
      refreshPianoRollLanes,
      noteNameForPitch,
      formatPitch,
      editorLaneGridRow: (kind, id, index) => editorLaneGridRow?.(kind, id, index, gridRows().length),
      setStatus: (message) => { status.textContent = message; }
    });
  }

  function refreshPianoRollLanes() {
    const scrollLeft = stepGrid.scrollLeft;
    const scrollTop = stepGrid.scrollTop;
    stepGrid.querySelectorAll(".piano-roll-lane, .piano-roll-lane-label").forEach((node) => node.remove());
    const rows = gridRows();
    const laneCount = appendCurrentPianoRollLanes(rows.length + 2);
    onAfterBuild();
    if (state.cameraMode) {
      const stackRowCount = Math.max(rows.length + laneCount, editorLaneCount?.() ?? 0);
      stepGrid.style.setProperty("--camera-grid-rows", String(stackRowCount + 1));
      stepGrid.style.setProperty("--camera-track-rows", String(stackRowCount));
      syncStepGridLaneRows(stepGrid);
    }
    renderStepGrid();
    stepGrid.scrollLeft = scrollLeft;
    stepGrid.scrollTop = scrollTop;
    return laneCount;
  }

  function sameCameraTarget(a, b) {
    if (!a || !b) return !a && !b;
    return a.hit === b.hit
      && Math.abs(Number(a.step) - Number(b.step)) < 0.0001
      && Number(a.bar) === Number(b.bar);
  }

  function cameraVisualStepForTarget(target, row) {
    const explicit = Number(target?.visualStep);
    if (Number.isFinite(explicit)) {
      return Math.max(0, Math.min(row.steps - 1, Math.round(explicit)));
    }
    const step = Number(target?.step);
    if (!Number.isFinite(step)) return 0;
    return Math.max(0, Math.min(row.steps - 1, Math.round((step / BASE_STEPS_PER_BAR) * row.steps)));
  }

  function cameraCellRectForTarget(target) {
    if (!target || !cameraCanvasMetrics) return null;
    const row = cameraCanvasMetrics.rows.find((item) => item.hit === target.hit);
    if (!row || !state.config.patterns.jazz.bars[target.bar]) return null;
    const stepGap = Math.max(0.5, Math.min(4, 80 / Math.max(1, row.steps * visibleSegmentCount())));
    const stepWidth = Math.max(1, cameraCanvasMetrics.barWidth / row.steps);
    const visualStep = cameraVisualStepForTarget(target, row);
    const width = Math.max(1, stepWidth - stepGap);
    return {
      x: target.bar * cameraCanvasMetrics.barWidth + visualStep * stepWidth + stepGap / 2,
      y: row.top + 5,
      width,
      height: Math.max(4, row.height - 10),
      radius: Math.min(5, Math.max(4, row.height - 10) / 2),
      accent: row.accent || "#7dd3fc",
      type: row.type
    };
  }

  function cameraTargetIsSelected(target) {
    return Boolean(state.selected
      && state.selected.hit === target?.hit
      && Math.abs(Number(state.selected.step) - Number(target?.step)) < 0.0001
      && Number(state.selected.bar ?? state.activeBar) === Number(target?.bar));
  }

  function cameraPlayingTargetsFor(barIndex, stepIndex) {
    if (!cameraCanvasMetrics) return [];
    const bar = Math.max(0, Math.round(Number(barIndex) || 0));
    const stepBase = Math.max(0, Math.min(BASE_STEPS_PER_BAR - 1, Math.floor(Number(stepIndex) || 0)));
    return cameraCanvasMetrics.rows.flatMap((row) => {
      const targets = [];
      for (let visualStep = 0; visualStep < row.steps; visualStep += 1) {
        const step = visualStepToPatternStep(visualStep, row.steps);
        if (Math.floor(step) !== stepBase) continue;
        const velocity = visualVelocityFor(row.hit, step, bar);
        if (velocity <= 0.005) continue;
        targets.push({
          hit: row.hit,
          type: row.type,
          step,
          visualStep,
          steps: row.steps,
          bar,
          velocity
        });
      }
      return targets;
    });
  }

  function drawCameraPlaybackTargets(targets) {
    if (!cameraPlaybackHitsLayer || !cameraCanvasMetrics) return;
    const children = cameraPlaybackHitsLayer.children;
    while (children.length < targets.length) {
      const item = document.createElement("div");
      item.className = "camera-grid-playback-hit";
      cameraPlaybackHitsLayer.appendChild(item);
    }
    Array.from(children).forEach((item, index) => {
      const target = targets[index];
      if (!target) {
        item.hidden = true;
        return;
      }
      const rect = cameraCellRectForTarget(target);
      if (!rect) {
        item.hidden = true;
        return;
      }
      const inset = Math.min(2, Math.max(1, rect.width * 0.14));
      const x = rect.x + inset;
      const y = rect.y + inset;
      const width = Math.max(1, rect.width - inset * 2);
      const height = Math.max(1, rect.height - inset * 2);
      const radius = Math.max(1, Math.min(rect.radius, height / 2));
      item.hidden = false;
      item.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      item.style.width = `${Math.max(2, Math.round(width))}px`;
      item.style.height = `${Math.max(2, Math.round(height))}px`;
      item.style.borderRadius = `${Math.round(radius)}px`;
      item.style.borderColor = colorAlpha(rect.accent, 0.98);
      item.style.background = colorAlpha(rect.accent, 0.2);
      item.style.boxShadow = `inset 0 0 0 1px ${colorAlpha(rect.accent, 0.36)}`;
    });
  }

  function drawCameraPlaybackBeat(barIndex, stepIndex) {
    if (!cameraPlaybackBeat || !cameraCanvasMetrics) return;
    const bar = Math.max(0, Math.min(renderedSegmentCount() - 1, Math.round(Number(barIndex) || 0)));
    const step = Math.max(0, Math.min(BASE_STEPS_PER_BAR - 1, Math.floor(Number(stepIndex) || 0)));
    const stepWidth = cameraCanvasMetrics.barWidth / BASE_STEPS_PER_BAR;
    const x = bar * cameraCanvasMetrics.barWidth + step * stepWidth;
    cameraPlaybackBeat.hidden = false;
    cameraPlaybackBeat.style.transform = `translateX(${Math.round(x)}px)`;
    cameraPlaybackBeat.style.width = `${Math.max(2, Math.round(stepWidth))}px`;
  }

  function hideCameraPlaybackBeat() {
    if (cameraPlaybackBeat) cameraPlaybackBeat.hidden = true;
  }

  function redrawCameraPlaybackOverlay() {
    if (state.playing) {
      drawCameraPlaybackBeat(state.cameraPlayheadBar, state.cameraPlayheadStep);
      drawCameraPlaybackTargets(cameraPlayingTargets);
    } else {
      hideCameraPlaybackBeat();
      drawCameraPlaybackTargets([]);
    }
  }

  function clearCameraPlayheadHits() {
    cameraPlayingTargets = [];
    cameraPlayingKey = "";
    hideCameraPlaybackBeat();
    drawCameraPlaybackTargets([]);
  }

  function renderCameraPlayheadHits(barIndex = state.cameraPlayheadBar, stepIndex = state.cameraPlayheadStep) {
    if (!state.cameraMode || !cameraPlaybackLayer || !cameraCanvasMetrics) return;
    if (!state.playing) {
      clearCameraPlayheadHits();
      return;
    }
    const bar = Math.max(0, Math.round(Number(barIndex) || 0));
    const step = Math.max(0, Math.min(BASE_STEPS_PER_BAR - 1, Math.floor(Number(stepIndex) || 0)));
    const nextKey = `${bar}:${step}`;
    if (nextKey === cameraPlayingKey) return;
    cameraPlayingTargets = cameraPlayingTargetsFor(bar, step);
    cameraPlayingKey = nextKey;
    drawCameraPlaybackBeat(bar, step);
    drawCameraPlaybackTargets(cameraPlayingTargets);
  }

  function updateCameraTrackSelectionNow() {
    stepGrid.querySelectorAll(".track-label").forEach((label) => {
      const isPrimary = state.selected?.hit === label.dataset.hit && state.selected?.mode === "row";
      const inSelection = state.selectedTracks.includes(label.dataset.hit);
      label.classList.toggle("is-selected-row", isPrimary || inSelection);
    });
  }

  function paintCameraCellNow(target, options = {}) {
    if (!cameraCanvas || !cameraCanvasWrap || !cameraCanvasMetrics) return false;
    const rect = cameraCellRectForTarget(target);
    if (!rect) return false;
    const ctx = cameraCanvas.getContext("2d");
    if (!ctx) return false;
    const dpr = cameraCanvasMetrics.dpr || Math.max(1, cameraCanvas.width / Math.max(1, cameraCanvasMetrics.cssWidth || 1));
    const hitData = getHitData(target.hit, target.step, target.bar);
    const velocity = Number.isFinite(Number(options.velocity))
      ? Number(options.velocity)
      : visualVelocityFor(target.hit, target.step, target.bar);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCameraStepPad(ctx, {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      velocity,
      generated: rect.type === "generated" && hitData.generated,
      selected: options.selected ?? cameraTargetIsSelected(target),
      hovered: false,
      playing: Boolean(options.playing),
      trackColor: rect.accent,
      accent: cameraCanvasColors.accent,
      accent2: cameraCanvasColors.accent2
    });
    ctx.restore();
    return true;
  }

  function paintCameraHitQueued(target, options = {}) {
    if (!target || !state.config.patterns.jazz.bars[target.bar]) return null;
    markCameraInteraction();
    lastCameraPaintAt = lastCameraInteractionAt;
    const storedVelocity = getHitData(target.hit, target.step, target.bar).velocity;
    const queuedVelocity = queuedVelocityFor(target.hit, target.step, target.bar);
    const hasQueuedVelocity = hasVelocityValue(queuedVelocity);
    const currentVelocity = hasQueuedVelocity ? Number(queuedVelocity) : storedVelocity;
    const visualVelocity = currentVelocity > 0.005 ? currentVelocity : defaultVelocityForHit(target.hit);
    paintCameraCellNow(target, { selected: Boolean(options.selected), velocity: visualVelocity });
    if (options.previewControls) {
      previewStepControls(target.hit, target.step, target.bar, visualVelocity, Boolean(options.deferPreviewControls));
    }
    if (storedVelocity <= 0.005 && !hasQueuedVelocity) {
      queueHitVelocity(target.hit, target.step, visualVelocity, target.bar, options.flushDelay ?? 160);
    }
    return visualVelocity;
  }

  function afterNextPaint(callback) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(callback);
    });
  }

  function updateCameraHoverOverlay() {
    if (!cameraHoverOverlay) return;
    const rect = cameraCellRectForTarget(cameraHover);
    if (!rect) {
      cameraHoverOverlay.hidden = true;
      return;
    }
    cameraHoverOverlay.hidden = false;
    cameraHoverOverlay.style.transform = `translate(${Math.round(rect.x - 1)}px, ${Math.round(rect.y - 1)}px)`;
    cameraHoverOverlay.style.width = `${Math.max(3, Math.round(rect.width + 2))}px`;
    cameraHoverOverlay.style.height = `${Math.max(4, Math.round(rect.height + 2))}px`;
    cameraHoverOverlay.style.borderRadius = `${Math.max(2, rect.radius + 1)}px`;
    cameraHoverOverlay.style.borderColor = colorAlpha(rect.accent, 0.92);
    cameraHoverOverlay.style.boxShadow = `0 0 0 1px rgba(0,0,0,0.34), 0 0 8px ${colorAlpha(rect.accent, 0.22)}`;
  }

  function setCameraHover(target) {
    const next = target && state.config.patterns.jazz.bars[target.bar] ? target : null;
    if (sameCameraTarget(cameraHover, next)) return;
    cameraHover = next;
    cameraCanvasWrap?.classList.toggle("is-hovering-cell", Boolean(cameraHover));
    updateCameraHoverOverlay();
  }

  function scrollCameraToBar(barIndex, behavior = "smooth") {
    if (!state.cameraMode || !stepGrid || !cameraCanvasWrap) return;
    if (!cameraCanvasMetrics) renderCameraCanvas();
    const barWidth = cameraCanvasMetrics?.barWidth
      || ((cameraCanvasWrap.clientWidth || cameraCanvasWrap.getBoundingClientRect().width || 1) / Math.max(1, renderedSegmentCount()));
    const maxScrollLeft = Math.max(0, stepGrid.scrollWidth - stepGrid.clientWidth);
    const nextLeft = Math.max(0, Math.min(maxScrollLeft, Math.round(barIndex * barWidth)));
    stepGrid.scrollTo({ left: nextLeft, behavior });
  }

  function clampCameraStepAbs(stepAbs) {
    const totalSteps = Math.max(1, renderedSegmentCount() * BASE_STEPS_PER_BAR);
    return Math.max(0, Math.min(totalSteps, Math.round(Number(stepAbs) || 0)));
  }

  function cameraBarPositionFromEvent(event) {
    if ((!cameraRulerWrap && !cameraCanvasWrap) || !cameraCanvasMetrics) renderCameraCanvas();
    if ((!cameraRulerWrap && !cameraCanvasWrap) || !cameraCanvasMetrics) return 0;
    const rect = (cameraRulerWrap || cameraCanvasWrap).getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    return x / Math.max(1, cameraCanvasMetrics.barWidth);
  }

  function cameraPointIsRuler(clientY) {
    if (!cameraRulerWrap) return false;
    const rect = cameraRulerWrap.getBoundingClientRect();
    return clientY >= rect.top && clientY <= rect.bottom;
  }

  function cameraRangeFromPositions(startBarPosition, endBarPosition) {
    const startStep = clampCameraStepAbs(startBarPosition * BASE_STEPS_PER_BAR);
    const endStep = clampCameraStepAbs(endBarPosition * BASE_STEPS_PER_BAR);
    return cameraRangeFromStepBounds(startStep, endStep);
  }

  function cameraRangeFromStepBounds(startStep, endStep) {
    let lo = Math.min(startStep, endStep);
    let hi = Math.max(startStep, endStep);
    if (hi === lo) hi = Math.min(renderedSegmentCount() * BASE_STEPS_PER_BAR, lo + 1);
    if (hi <= lo) lo = Math.max(0, hi - 1);
    return {
      startBar: Math.floor(lo / BASE_STEPS_PER_BAR),
      startStep: lo % BASE_STEPS_PER_BAR,
      startStepAbs: lo,
      endStepAbs: hi,
      lengthSteps: Math.max(1, hi - lo)
    };
  }

  function cameraRangeFromResizeDrag(drag, currentBarPosition) {
    if (!drag?.mode || drag.mode === "new") {
      return cameraRangeFromPositions(drag?.startBarPosition ?? currentBarPosition, currentBarPosition);
    }
    const totalSteps = Math.max(1, renderedSegmentCount() * BASE_STEPS_PER_BAR);
    const currentStep = clampCameraStepAbs(currentBarPosition * BASE_STEPS_PER_BAR);
    const anchor = Math.max(0, Math.min(totalSteps, Math.round(Number(drag.anchorStepAbs) || 0)));
    if (drag.mode === "resize-left") {
      const start = Math.min(currentStep, Math.max(0, anchor - 1));
      return cameraRangeFromStepBounds(start, anchor);
    }
    const end = Math.max(currentStep, Math.min(totalSteps, anchor + 1));
    return cameraRangeFromStepBounds(anchor, end);
  }

  function cameraSelectionResizeHit(barPosition) {
    const range = state.cameraBeatSelection;
    if (!range || !range.lengthSteps || !cameraCanvasMetrics) return null;
    const stepWidth = Math.max(0.1, cameraCanvasMetrics.barWidth / BASE_STEPS_PER_BAR);
    const pointerStep = clampCameraStepAbs(barPosition * BASE_STEPS_PER_BAR);
    const start = Math.max(0, Math.round(Number(range.startStepAbs) || 0));
    const end = Math.max(start + 1, Math.round(Number(range.endStepAbs) || start + range.lengthSteps || start + 1));
    const leftDistancePx = Math.abs(pointerStep - start) * stepWidth;
    const rightDistancePx = Math.abs(pointerStep - end) * stepWidth;
    const handlePx = 10;
    if (leftDistancePx <= handlePx && rightDistancePx <= handlePx) {
      return leftDistancePx <= rightDistancePx
        ? { mode: "resize-left", anchorStepAbs: end }
        : { mode: "resize-right", anchorStepAbs: start };
    }
    if (leftDistancePx <= handlePx) return { mode: "resize-left", anchorStepAbs: end };
    if (rightDistancePx <= handlePx) return { mode: "resize-right", anchorStepAbs: start };
    if (pointerStep > start && pointerStep < end) {
      return pointerStep - start <= end - pointerStep
        ? { mode: "resize-left", anchorStepAbs: end }
        : { mode: "resize-right", anchorStepAbs: start };
    }
    return null;
  }

  function cameraBeatLabel(stepAbs) {
    const clamped = Math.max(0, Math.round(Number(stepAbs) || 0));
    const bar = Math.floor(clamped / BASE_STEPS_PER_BAR);
    const step = clamped % BASE_STEPS_PER_BAR;
    return `${bar + 1}.${String(step + 1).padStart(2, "0")}`;
  }

  function cameraRangeLabel(range = state.cameraBeatSelection) {
    if (!range || !range.lengthSteps) return "selection";
    const endInclusive = Math.max(range.startStepAbs, range.endStepAbs - 1);
    return `${cameraBeatLabel(range.startStepAbs)}-${cameraBeatLabel(endInclusive)}`;
  }

  function updateCameraSelectionOverlay() {
    if (!cameraSelectionOverlay || !cameraCanvasMetrics) return;
    const range = state.cameraBeatSelection;
    if (!range || !range.lengthSteps) {
      cameraSelectionOverlay.hidden = true;
      return;
    }
    const stepWidth = cameraCanvasMetrics.barWidth / BASE_STEPS_PER_BAR;
    cameraSelectionOverlay.hidden = false;
    cameraSelectionOverlay.style.transform = `translateX(${Math.round(range.startStepAbs * stepWidth)}px)`;
    cameraSelectionOverlay.style.width = `${Math.max(3, Math.round(range.lengthSteps * stepWidth))}px`;
    cameraSelectionOverlay.title = `Beat range ${cameraRangeLabel(range)}`;
  }

  function setCameraBeatSelection(range) {
    state.cameraBeatSelection = range;
    updateCameraSelectionOverlay();
  }

  function openCameraSelectionMenu(event) {
    const range = state.cameraBeatSelection;
    if (!showContextMenu || !range || !range.lengthSteps) return;
    showContextMenu(event, [
      {
        label: `Loop ${cameraRangeLabel(range)}`,
        action: () => { void loopBeatSelection?.({ ...range }); }
      },
      {
        label: `Play ${cameraRangeLabel(range)}`,
        action: () => { void playBeatSelection?.({ ...range }); }
      },
      { separator: true },
      {
        label: "Clear beat selection",
        action: () => {
          setCameraBeatSelection(null);
          const stoppedLoop = clearBeatLoop?.();
          status.textContent = stoppedLoop ? "Beat selection cleared; loop off" : "Beat selection cleared";
        }
      }
    ]);
  }

  function rememberCameraPointer(event) {
    cameraPointerClient = { x: event.clientX, y: event.clientY };
    cameraPointerInsideWrap = true;
  }

  function hitTestCameraPoint(clientX, clientY) {
    if (!cameraCanvasWrap || !cameraCanvasMetrics) renderCameraCanvas();
    if (!cameraCanvasWrap || !cameraCanvasMetrics) return null;
    const rect = cameraCanvasWrap.getBoundingClientRect();
    const gridRect = stepGrid.getBoundingClientRect();
    if (clientX < gridRect.left || clientX > gridRect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const row = cameraCanvasMetrics.rows.find((item) => y >= item.top && y <= item.top + item.height);
    if (!row) return null;
    const bar = Math.max(0, Math.min(renderedSegmentCount() - 1, Math.floor(x / cameraCanvasMetrics.barWidth)));
    const inBar = Math.max(0, Math.min(0.999999, (x - bar * cameraCanvasMetrics.barWidth) / cameraCanvasMetrics.barWidth));
    const visualStep = Math.max(0, Math.min(row.steps - 1, Math.floor(inBar * row.steps)));
    return {
      hit: row.hit,
      type: row.type,
      step: visualStepToPatternStep(visualStep, row.steps),
      visualStep,
      steps: row.steps,
      bar
    };
  }

  function hitTestCameraCanvas(event) {
    return hitTestCameraPoint(event.clientX, event.clientY);
  }

  function syncCameraHoverToPointer() {
    cameraHoverScrollRaf = 0;
    if (!cameraPointerInsideWrap || !cameraPointerClient) return;
    if (cameraPointIsRuler(cameraPointerClient.y)) {
      setCameraHover(null);
      return;
    }
    setCameraHover(hitTestCameraPoint(cameraPointerClient.x, cameraPointerClient.y));
  }

  function requestCameraHoverSync() {
    if (!state.cameraMode || !cameraPointerInsideWrap || !cameraPointerClient || typeof window === "undefined") return;
    if (cameraHoverScrollRaf) return;
    cameraHoverScrollRaf = window.requestAnimationFrame(syncCameraHoverToPointer);
  }

  function buildCameraGrid() {
    const previousScrollLeft = stepGrid.scrollLeft;
    const previousBarOffset = cameraCanvasMetrics?.barWidth > 0
      ? previousScrollLeft / cameraCanvasMetrics.barWidth
      : null;
    const rows = gridRows();
    const stackRowCount = Math.max(rows.length, editorLaneCount?.() ?? rows.length);
    cameraHover = null;
    cameraPlayingKey = "";
    cancelCameraSelectionCommit();
    stepGrid.innerHTML = "";
    stepGrid.classList.add("is-camera-canvas");
    stepGrid.style.setProperty("--camera-grid-rows", String(stackRowCount + 1));
    stepGrid.style.setProperty("--camera-track-rows", String(stackRowCount));

    const corner = Object.assign(document.createElement("div"), {
      className: "step-header step-header--corner",
      textContent: "Track"
    });
    corner.style.gridColumn = "1";
    corner.style.gridRow = "1";
    stepGrid.appendChild(corner);

    cameraRulerWrap = document.createElement("div");
    cameraRulerWrap.className = "camera-grid-ruler-wrap";
    cameraRulerWrap.style.gridColumn = "2 / -1";
    cameraRulerWrap.style.gridRow = "1";
    cameraRulerCanvas = document.createElement("canvas");
    cameraRulerCanvas.className = "camera-grid-ruler-canvas";
    cameraRulerWrap.appendChild(cameraRulerCanvas);
    cameraSelectionOverlay = document.createElement("div");
    cameraSelectionOverlay.className = "camera-grid-selection";
    cameraSelectionOverlay.hidden = true;
    cameraRulerWrap.appendChild(cameraSelectionOverlay);
    stepGrid.appendChild(cameraRulerWrap);

    cameraCanvasWrap = document.createElement("div");
    cameraCanvasWrap.className = "camera-grid-canvas-wrap";
    cameraCanvasWrap.style.gridColumn = "2 / -1";
    cameraCanvasWrap.style.gridRow = `2 / span ${stackRowCount}`;
    cameraCanvas = document.createElement("canvas");
    cameraCanvas.className = "camera-grid-canvas";
    cameraCanvasWrap.appendChild(cameraCanvas);
    cameraPlaybackLayer = document.createElement("div");
    cameraPlaybackLayer.className = "camera-grid-playback";
    cameraPlaybackBeat = document.createElement("div");
    cameraPlaybackBeat.className = "camera-grid-playback-beat";
    cameraPlaybackBeat.hidden = true;
    cameraPlaybackLayer.appendChild(cameraPlaybackBeat);
    cameraPlaybackHitsLayer = document.createElement("div");
    cameraPlaybackHitsLayer.className = "camera-grid-playback-hits";
    cameraPlaybackLayer.appendChild(cameraPlaybackHitsLayer);
    cameraCanvasWrap.appendChild(cameraPlaybackLayer);
    cameraHoverOverlay = document.createElement("div");
    cameraHoverOverlay.className = "camera-grid-hover";
    cameraHoverOverlay.hidden = true;
    cameraCanvasWrap.appendChild(cameraHoverOverlay);
    cameraCanvasWrap.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      markCameraInteraction();
      rememberCameraPointer(event);
      const hit = hitTestCameraCanvas(event);
      if (!hit || !state.config.patterns.jazz.bars[hit.bar]) return;
      const sameSelection = state.selected
        && state.selected.hit === hit.hit
        && Math.abs(Number(state.selected.step) - Number(hit.step)) < 0.0001
        && Number(state.selected.bar ?? state.activeBar) === Number(hit.bar)
        && state.selected.mode === "step";
      const previousSelection = state.selected ? {
        hit: state.selected.hit,
        step: state.selected.step,
        bar: state.selected.bar ?? state.activeBar
      } : null;
      if (!sameSelection) {
        cancelCameraSelectionCommit();
        const storedVelocity = getHitData(hit.hit, hit.step, hit.bar).velocity;
        const currentVelocity = visualVelocityFor(hit.hit, hit.step, hit.bar);
        const visualVelocity = currentVelocity > 0.005 ? currentVelocity : defaultVelocityForHit(hit.hit);
        if (storedVelocity <= 0.005 && currentVelocity <= 0.005) {
          queueHitVelocity(hit.hit, hit.step, visualVelocity, hit.bar, 240);
        }
        commitCameraSelection({
          target: hit,
          previousSelection,
          visualVelocity,
          storedVelocity,
          scrollLeft: stepGrid.scrollLeft,
          scrollTop: stepGrid.scrollTop
        });
      }
      cameraPaintDrag = {
        pointerId: event.pointerId,
        lastKey: cameraTargetKey(hit),
        lastTarget: hit,
        moved: false,
        previousSelection
      };
      cameraCanvasWrap.setPointerCapture?.(event.pointerId);
      cameraPointerHandledClick = !sameSelection;
      if (sameSelection) {
        afterInputPaint(() => {
          setCameraHover(hit);
        });
      }
      event.preventDefault();
    });
    cameraCanvasWrap.addEventListener("pointermove", (event) => {
      markCameraInteraction();
      rememberCameraPointer(event);
      if (cameraPaintDrag && cameraPaintDrag.pointerId === event.pointerId) {
        const hit = hitTestCameraCanvas(event);
        if (!hit || !state.config.patterns.jazz.bars[hit.bar]) return;
        const key = cameraTargetKey(hit);
        if (key !== cameraPaintDrag.lastKey) {
          cameraPaintDrag.moved = true;
          cancelCameraSelectionCommit();
          cameraPaintDrag.lastKey = key;
          cameraPaintDrag.lastTarget = hit;
          paintCameraHitQueued(hit, {
            selected: false,
            previewControls: false,
            flushDelay: 260
          });
          setCameraHover(hit);
        }
        event.preventDefault();
        return;
      }
    });
    const finishCameraDrag = (event) => {
      if (!cameraDrag || cameraDrag.pointerId !== event.pointerId) return;
      if (cameraDrag.moved) {
        const range = cameraRangeFromResizeDrag(cameraDrag, cameraBarPositionFromEvent(event));
        setCameraBeatSelection(range);
        status.textContent = `Selected beats ${cameraRangeLabel(range)}`;
        cameraSuppressClick = true;
        event.preventDefault();
      }
      cameraRulerWrap?.releasePointerCapture?.(event.pointerId);
      cameraDrag = null;
      cameraRulerWrap?.classList.remove("is-ruler-dragging");
    };
    const finishCameraPaintDrag = (event) => {
      if (!cameraPaintDrag || cameraPaintDrag.pointerId !== event.pointerId) return;
      cameraCanvasWrap.releasePointerCapture?.(event.pointerId);
      if (cameraPaintDrag.moved && cameraPaintDrag.lastTarget) {
        const scrollLeft = stepGrid.scrollLeft;
        const scrollTop = stepGrid.scrollTop;
        const target = cameraPaintDrag.lastTarget;
        const storedVelocity = getHitData(target.hit, target.step, target.bar).velocity;
        const currentVelocity = visualVelocityFor(target.hit, target.step, target.bar);
        const visualVelocity = currentVelocity > 0.005 ? currentVelocity : defaultVelocityForHit(target.hit);
        if (cameraPaintDrag.previousSelection && !sameCameraTarget(cameraPaintDrag.previousSelection, target)) {
          paintCameraCellNow(cameraPaintDrag.previousSelection, { selected: false });
        }
        selectStep(target.hit, target.step, "step", target.bar, state.intensity, target.type === "generated", {
          deferTrackPanels: true,
          ...(storedVelocity <= 0.005 ? { previewVelocity: visualVelocity } : {})
        });
        updateCameraTrackSelectionNow();
        paintCameraCellNow(target, { selected: true, velocity: visualVelocity });
        scheduleDeferredDrawRender(scrollLeft, scrollTop);
        cameraSuppressClick = true;
        event.preventDefault();
      }
      cameraPaintDrag = null;
    };
    cameraRulerWrap.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      markCameraInteraction();
      cameraPointerInsideWrap = false;
      cameraPointerClient = null;
      const startBarPosition = cameraBarPositionFromEvent(event);
      const resizeHit = cameraSelectionResizeHit(startBarPosition);
      cameraDrag = {
        pointerId: event.pointerId,
        startBarPosition,
        mode: resizeHit?.mode || "new",
        anchorStepAbs: resizeHit?.anchorStepAbs ?? null,
        moved: false
      };
      setCameraHover(null);
      cameraRulerWrap.classList.add("is-ruler-dragging");
      cameraRulerWrap.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    cameraRulerWrap.addEventListener("pointermove", (event) => {
      markCameraInteraction();
      if (!cameraDrag || cameraDrag.pointerId !== event.pointerId) return;
      const current = cameraBarPositionFromEvent(event);
      const distanceSteps = Math.abs(current - cameraDrag.startBarPosition) * BASE_STEPS_PER_BAR;
      if (distanceSteps >= 0.35) cameraDrag.moved = true;
      if (!cameraDrag.moved) return;
      const range = cameraRangeFromResizeDrag(cameraDrag, current);
      setCameraBeatSelection(range);
      status.textContent = `Selected beats ${cameraRangeLabel(range)}`;
      setCameraHover(null);
      event.preventDefault();
    });
    cameraRulerWrap.addEventListener("pointerup", finishCameraDrag);
    cameraRulerWrap.addEventListener("pointercancel", finishCameraDrag);
    cameraRulerWrap.addEventListener("mousemove", () => {
      cameraRulerWrap.classList.add("is-ruler-hovering");
      setCameraHover(null);
    });
    cameraRulerWrap.addEventListener("mouseleave", () => {
      cameraRulerWrap.classList.remove("is-ruler-hovering");
      cameraRulerWrap.classList.remove("is-ruler-dragging");
    });
    cameraRulerWrap.addEventListener("contextmenu", (event) => {
      if (!state.cameraBeatSelection?.lengthSteps) {
        const position = cameraBarPositionFromEvent(event);
        setCameraBeatSelection(cameraRangeFromPositions(position, position + 1 / BASE_STEPS_PER_BAR));
      }
      openCameraSelectionMenu(event);
    });
    cameraCanvasWrap.addEventListener("pointerup", (event) => {
      finishCameraPaintDrag(event);
    });
    cameraCanvasWrap.addEventListener("pointercancel", (event) => {
      finishCameraPaintDrag(event);
    });
    cameraCanvasWrap.addEventListener("mousedown", (event) => {
      if (event.button === 0) event.preventDefault();
    });
    cameraCanvasWrap.addEventListener("mousemove", (event) => {
      markCameraInteraction();
      rememberCameraPointer(event);
      setCameraHover(hitTestCameraCanvas(event));
    });
    cameraCanvasWrap.addEventListener("mouseleave", () => {
      cameraPointerInsideWrap = false;
      cameraPointerClient = null;
      cameraCanvasWrap.classList.remove("is-ruler-hovering");
      cameraCanvasWrap.classList.remove("is-ruler-dragging");
      setCameraHover(null);
    });
    if (!cameraScrollHoverBound) {
      stepGrid.addEventListener("scroll", requestCameraHoverSync, { passive: true });
      cameraScrollHoverBound = true;
    }
    cameraCanvasWrap.addEventListener("click", (event) => {
      const handledOnPointerDown = cameraPointerHandledClick;
      cameraPointerHandledClick = false;
      if (handledOnPointerDown) {
        cameraSuppressClick = false;
        return;
      }
      if (cameraSuppressClick) {
        cameraSuppressClick = false;
        return;
      }
      const hit = hitTestCameraCanvas(event);
      if (!hit || !state.config.patterns.jazz.bars[hit.bar]) return;
      setCameraHover(hit);
      const scrollLeft = stepGrid.scrollLeft;
      const scrollTop = stepGrid.scrollTop;
      const previousSelection = state.selected ? {
        hit: state.selected.hit,
        step: state.selected.step,
        bar: state.selected.bar ?? state.activeBar
      } : null;
      if (state.selected
        && state.selected.hit === hit.hit
        && state.selected.step === hit.step
        && state.selected.bar === hit.bar
        && state.selected.mode === "step") {
        resetSelectedPanel();
        renderStepGrid();
        stepGrid.scrollLeft = scrollLeft;
        stepGrid.scrollTop = scrollTop;
        return;
      }
      const storedVelocity = getHitData(hit.hit, hit.step, hit.bar).velocity;
      const currentVelocity = visualVelocityFor(hit.hit, hit.step, hit.bar);
      const visualVelocity = currentVelocity > 0.005 ? currentVelocity : defaultVelocityForHit(hit.hit);
      if (storedVelocity <= 0.005 && currentVelocity <= 0.005) queueHitVelocity(hit.hit, hit.step, visualVelocity, hit.bar);
      selectStep(hit.hit, hit.step, "step", hit.bar, state.intensity, hit.type === "generated", {
        deferTrackPanels: true,
        ...(storedVelocity <= 0.005 ? { previewVelocity: visualVelocity } : {})
      });
      updateCameraTrackSelectionNow();
      if (previousSelection && !sameCameraTarget(previousSelection, hit)) {
        paintCameraCellNow(previousSelection, { selected: false });
      }
      paintCameraCellNow(hit, { selected: true, velocity: visualVelocity });
      scheduleDeferredDrawRender(scrollLeft, scrollTop);
    });
    stepGrid.appendChild(cameraCanvasWrap);

    rows.forEach(({ id: hit, label, type, accent }, index) => {
      const rowLabel = makeTrackLabel(hit, label, type, accent);
      rowLabel.style.gridColumn = "1";
      rowLabel.style.gridRow = String(editorLaneGridRow?.("grid", hit, index, rows.length) ?? (index + 2));
      stepGrid.appendChild(rowLabel);
    });
    const pianoRollLaneCount = appendCurrentPianoRollLanes(rows.length + 2);
    stepGrid.style.setProperty("--camera-grid-rows", String(Math.max(stackRowCount, rows.length + pianoRollLaneCount) + 1));
    syncStepGridLaneRows(stepGrid);
    renderStepGrid();
    onAfterBuild();
    const nextBarWidth = (cameraCanvasWrap.clientWidth || cameraCanvasWrap.getBoundingClientRect().width || 1)
      / Math.max(1, renderedSegmentCount());
    const nextScrollLeft = previousBarOffset !== null ? previousBarOffset * nextBarWidth : previousScrollLeft;
    const maxScrollLeft = Math.max(0, stepGrid.scrollWidth - stepGrid.clientWidth);
    stepGrid.scrollLeft = Math.max(0, Math.min(maxScrollLeft, Math.round(nextScrollLeft)));
    requestCameraCanvasRender();
  }

  function playbackTabBar() {
    if (!state.playing) return null;
    const raw = Number.isFinite(Number(playbackTabsBar))
      ? playbackTabsBar
      : Number.isFinite(Number(state.cameraPlayheadBar))
        ? state.cameraPlayheadBar
        : state.activeBar;
    const total = Math.max(1, state.config?.patterns?.jazz?.bars?.length || loopBarCount());
    return Math.max(0, Math.min(total - 1, Math.round(Number(raw) || 0)));
  }

  function playbackTabLoopIndex(bar = playbackTabBar()) {
    if (bar == null) return null;
    if (typeof loopIndexForBar === "function") {
      return Math.max(0, Math.min(loopCount() - 1, loopIndexForBar(bar)));
    }
    return Math.max(0, Math.min(loopCount() - 1, Math.floor(bar / Math.max(1, loopBarCount()))));
  }

  function displayedBarTabsLoopIndex() {
    const playbackLoop = playbackTabLoopIndex();
    return playbackLoop == null ? state.activeLoopIndex : playbackLoop;
  }

  function updatePlaybackTabHighlights(barIndex = state.cameraPlayheadBar) {
    playbackTabsBar = Number.isFinite(Number(barIndex)) ? Math.round(Number(barIndex)) : null;
    const playingBar = playbackTabBar();
    const playingLoop = playbackTabLoopIndex(playingBar);
    if (!state.playing && renderedBarTabsLoop !== null && renderedBarTabsLoop !== state.activeLoopIndex) {
      buildBarTabs();
      return;
    }
    if (state.playing && playingLoop != null && renderedBarTabsLoop !== null && renderedBarTabsLoop !== playingLoop) {
      buildBarTabs();
      return;
    }
    loopTabs.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("is-playing", playingLoop != null && Number(button.dataset.loop) === playingLoop);
    });
    barTabs.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("is-playing", playingBar != null && Number(button.dataset.bar) === playingBar);
    });
  }

  function buildStepGrid() {
    state.cameraMode = true;
    const rows = gridRows();
    const segments = visibleSegmentCount();
    const renderedSegments = renderedSegmentCount();
    const visibleGridColumns = segments * GRID_COLUMNS_PER_BAR;
    const renderedGridColumns = renderedSegments * GRID_COLUMNS_PER_BAR;
    const maxVisibleSteps = Math.max(
      BASE_STEPS_PER_BAR,
      ...rows.map(({ id }) => rowStepCount(id))
    ) * segments;
    state.renderedSegmentsCount = renderedSegments;
    stepGrid.style.setProperty("--visible-grid-columns", String(visibleGridColumns));
    stepGrid.style.setProperty("--rendered-grid-columns", String(renderedGridColumns));
    const stepGapX = Math.max(0.02, Math.min(1.5, 24 / visibleGridColumns));
    const stepGapY = Math.max(1, Math.min(6, 96 / maxVisibleSteps));
    const hitInset = Math.max(0.2, Math.min(5, 80 / maxVisibleSteps));
    const hitRadius = Math.max(1, Math.min(4, 64 / maxVisibleSteps));
    const barGap = Math.max(1, Math.min(8, 128 / maxVisibleSteps));
    const barPadX = Math.max(2, Math.min(8, 96 / maxVisibleSteps));
    const gridWidth = stepGrid.clientWidth || stepGrid.getBoundingClientRect?.().width || 800;
    const scaleGridWidth = Math.min(gridWidth, ZOOM_REFERENCE_GRID_WIDTH);
    const labelWidth = 92;
    const visibleGapWidth = visibleGridColumns * stepGapX;
    const stepColumnWidth = Math.max(0.02, (scaleGridWidth - labelWidth - visibleGapWidth) / visibleGridColumns);
    stepGrid.style.setProperty("--step-gap-x", `${stepGapX}px`);
    stepGrid.style.setProperty("--step-gap-y", `${stepGapY}px`);
    stepGrid.style.setProperty("--hit-inset", `${hitInset}px`);
    stepGrid.style.setProperty("--hit-radius", `${hitRadius}px`);
    stepGrid.style.setProperty("--step-column-width", `${stepColumnWidth}px`);
    barTabs.style.setProperty("--bar-gap", `${barGap}px`);
    barTabs.style.setProperty("--bar-tab-pad-x", `${barPadX}px`);
    stepGrid.classList.toggle("is-camera-scroll", Boolean(state.cameraMode));
    stepGrid.classList.toggle("is-camera-canvas", Boolean(state.cameraMode));
    if (!state.cameraMode) {
      stepGrid.scrollLeft = 0;
    }
    if (state.cameraMode) {
      buildCameraGrid();
      return;
    }
    cameraCanvas = null;
    cameraCanvasWrap = null;
    cameraPlaybackLayer = null;
    cameraPlaybackBeat = null;
    cameraPlaybackHitsLayer = null;
    cameraRulerCanvas = null;
    cameraRulerWrap = null;
    cameraCanvasMetrics = null;
    cameraSelectionOverlay = null;
    cameraHoverOverlay = null;
    cameraHover = null;
    cameraPlayingTargets = [];
    cameraPlayingKey = "";
    stepGrid.innerHTML = "";

    // Header row: "Track" corner + one header cell per step (global numbering).
    // First step of each segment gets a "is-bar-start" marker and a data-bar
    // attribute so renderStepGrid can update the bar number label.
    stepGrid.appendChild(Object.assign(document.createElement("div"), {
      className: "step-header step-header--corner",
      textContent: "Track"
    }));
    for (let seg = 0; seg < renderedSegments; seg += 1) {
      for (let step = 0; step < BASE_STEPS_PER_BAR; step += 1) {
        const header = document.createElement("div");
        header.className = "step-header step-header--step";
        header.style.gridColumn = `span ${GRID_COLUMNS_PER_BAR / BASE_STEPS_PER_BAR}`;
        header.dataset.barSeg = String(seg);
        const globalStep = seg * BASE_STEPS_PER_BAR + step + 1;
        header.textContent = String(globalStep).padStart(2, "0");
        if (step === 0) {
          header.classList.add("is-bar-start");
          // bar label span — text updated by renderStepGrid
          const barSpan = document.createElement("span");
          barSpan.className = "step-header__bar-label";
          barSpan.textContent = `Bar ${barIndexForSegment(seg) + 1}`;
          header.prepend(barSpan);
        }
        stepGrid.appendChild(header);
      }
    }

    rows.forEach(({ id: hit, label, type, accent }) => {
      const index = rows.findIndex((row) => row.id === hit);
      const gridRow = String(editorLaneGridRow?.("grid", hit, index, rows.length) ?? (index + 2));
      const rowLabel = makeTrackLabel(hit, label, type, accent);
      rowLabel.style.gridRow = gridRow;
      stepGrid.appendChild(rowLabel);

      const stepsForTrack = rowStepCount(hit);
      const stepRow = document.createElement("div");
      stepRow.className = `step-row ${type === "generated" ? "is-generated-row" : ""}`;
      stepRow.dataset.hit = hit;
      stepRow.dataset.type = type;
      stepRow.dataset.stepsPerBar = String(stepsForTrack);
      stepRow.style.gridColumn = "2 / -1";
      stepRow.style.gridRow = gridRow;
      stepRow.style.gridTemplateColumns = `repeat(${renderedSegments * stepsForTrack}, minmax(0, 1fr))`;
      stepRow.style.columnGap = `${Math.max(0.5, Math.min(5, 80 / Math.max(1, stepsForTrack * segments)))}px`;
      for (let seg = 0; seg < renderedSegments; seg += 1) {
        for (let visualStep = 0; visualStep < stepsForTrack; visualStep += 1) {
          const step = visualStepToPatternStep(visualStep, stepsForTrack);
          const baseStep = Math.floor(step);
          const button = document.createElement("button");
          button.type = "button";
          button.className = `step-button ${type === "generated" ? "is-generated-step" : ""}`;
          if (visualStep === 0 && seg > 0) button.classList.add("is-bar-start");
          button.dataset.hit = hit;
          button.dataset.type = type;
          button.dataset.step = String(step);
          button.dataset.visualStep = String(visualStep);
          button.dataset.stepsPerBar = String(stepsForTrack);
          button.dataset.baseStep = String(baseStep);
          button.dataset.seg = String(seg);
          button.dataset.beat = visualBeatKindForStep(visualStep, stepsForTrack, currentTimeSignature());
          button.style.setProperty("--track-accent", accent || "#7dd3fc");
          button.setAttribute("aria-label", `${label} bar+${seg} step ${visualStep + 1} of ${stepsForTrack}`);
          button.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            const barIndex = barIndexForSegment(seg);
            if (!state.config.patterns.jazz.bars[barIndex]) return;
            const sameSelection = state.selected
              && state.selected.hit === hit
              && Math.abs(Number(state.selected.step) - Number(step)) < 0.0001
              && Number(state.selected.bar ?? state.activeBar) === Number(barIndex)
              && state.selected.mode === "step";
            if (sameSelection) return;
            stepGrid.querySelectorAll(".step-button.is-selected").forEach((item) => item.classList.remove("is-selected"));
            button.classList.add("is-selected");
            const storedVelocity = getHitData(hit, step, barIndex).velocity;
            const currentVelocity = visualVelocityFor(hit, step, barIndex);
            const visualVelocity = currentVelocity > 0.005 ? currentVelocity : defaultVelocityForHit(hit);
            button.classList.add("is-on");
            button.classList.toggle("is-generated-on", type === "generated");
            button.style.setProperty("--level", String(Math.min(1, visualVelocity / 0.9)));
            afterInputPaint(() => previewStepSelectionControls?.(hit, step, barIndex, visualVelocity));
            if (storedVelocity <= 0.005 && currentVelocity <= 0.005) queueHitVelocity(hit, step, visualVelocity, barIndex);
          });
          button.addEventListener("mousedown", (event) => {
            event.preventDefault();
          });
          button.addEventListener("click", () => {
            const barIndex = barIndexForSegment(seg);
            if (!state.config.patterns.jazz.bars[barIndex]) return;
            const scrollLeft = stepGrid.scrollLeft;
            const scrollTop = stepGrid.scrollTop;
            if (state.selected
              && state.selected.hit === hit
              && state.selected.step === step
              && state.selected.bar === barIndex
              && state.selected.mode === "step") {
              resetSelectedPanel();
              renderStepGrid();
              stepGrid.scrollLeft = scrollLeft;
              stepGrid.scrollTop = scrollTop;
              return;
            }
            const storedVelocity = getHitData(hit, step, barIndex).velocity;
            const currentVelocity = visualVelocityFor(hit, step, barIndex);
            const visualVelocity = currentVelocity > 0.005 ? currentVelocity : defaultVelocityForHit(hit);
            if (storedVelocity <= 0.005 && currentVelocity <= 0.005) queueHitVelocity(hit, step, visualVelocity, barIndex);
            selectStep(hit, step, "step", barIndex, state.intensity, type === "generated", {
              ...(storedVelocity <= 0.005 ? { previewVelocity: visualVelocity } : {})
            });
            scheduleDeferredDrawRender(scrollLeft, scrollTop);
          });
          stepRow.appendChild(button);
        }
      }
      stepGrid.appendChild(stepRow);
    });
    appendCurrentPianoRollLanes(rows.length + 2);
    renderStepGrid();
    onAfterBuild();
  }

  function buildLoopTabs() {
    syncActiveLoopToBar();
    installRulerDragScroll(loopTabs);
    if (loopCountInput) {
      loopCountInput.max = String(maxLoopCount());
      loopCountInput.value = String(loopCount());
    }
    loopTabs.innerHTML = "";
    const barsPerLoop = loopBarCount();
    for (let index = 0; index < loopCount(); index += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.loop = String(index);
      button.textContent = String(index + 1);
      button.title = `Bars ${index * barsPerLoop + 1}-${(index + 1) * barsPerLoop} · Shift-click to multi-select · Right-click to copy/paste`;
      button.classList.toggle("is-active", index === state.activeLoopIndex);
      button.classList.toggle("is-multi-selected", state.selectedLoops.includes(index));
      button.addEventListener("click", (event) => {
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
          toggleLoopMultiSelect(index, event);
          return;
        }
        state.selectedLoops = [];
        state.selectedBars = [];
        state.loopAnchor = index;
        state.barAnchor = null;
        const local = localBarIndex(state.activeBar);
        state.activeLoopIndex = index;
        state.activeBar = loopStartBar(index) + local;
        state.pausedPlayback = null;
        clampActiveBar();
        if (activeLoopLength()) {
          state.loopBarIndex = clampLoopStart(state.activeBar, activeLoopLength());
          state.engine.setConfig(previewConfig());
          state.engine.seekToPhraseBar(state.activeBar, 0);
          state.playheadStep = 0;
          refreshLoopBarButton();
        } else if (state.playing) {
          state.engine.seekToPhraseBar(state.activeBar, 0);
          state.playheadStep = 0;
        }
        syncSelectionAfterNavigation();
        buildLoopTabs();
        buildBarTabs();
        renderStepGrid();
        status.textContent = state.playing || activeLoopLength()
          ? `Jumped to loop ${index + 1}`
          : `Editing loop ${index + 1}`;
      });
      button.addEventListener("contextmenu", (event) => {
        if (!state.selectedLoops.includes(index)) {
          state.selectedLoops = [index];
          state.loopAnchor = index;
          buildLoopTabs();
        }
        openLoopContextMenu(event, index);
      });
      loopTabs.appendChild(button);
    }
    updatePlaybackTabHighlights();
  }

  function buildBarTabs() {
    syncActiveLoopToBar();
    installRulerDragScroll(barTabs);
    barTabs.innerHTML = "";
    const barsPerLoop = loopBarCount();
    const barsPerSection = sectionBarCount();
    const displayedLoop = displayedBarTabsLoopIndex();
    renderedBarTabsLoop = displayedLoop;
    barTabs.style.setProperty("--bar-tab-count", String(barsPerLoop));
    for (let localIndex = 0; localIndex < barsPerLoop; localIndex += 1) {
      const index = loopStartBar(displayedLoop) + localIndex;
      if (!state.config.patterns.jazz.bars[index]) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.bar = String(index);
      button.dataset.localBar = String(localIndex);
      button.dataset.section = String(Math.floor(localIndex / barsPerSection) + 1);
      button.textContent = String(localIndex + 1).padStart(2, "0");
      button.title = `Loop ${displayedLoop + 1}, bar ${localIndex + 1} (song bar ${index + 1}) · Shift-click to multi-select · Right-click to copy/paste`;
      button.classList.toggle("is-active", index === state.activeBar);
      button.classList.toggle("is-section-start", localIndex % barsPerSection === 0);
      button.classList.toggle("is-multi-selected", state.selectedBars.includes(index));
      let barPointer = null;
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
          button.dataset.skipNextClick = "1";
          skipNextBarClickIndex = index;
          toggleBarMultiSelect(index, event);
          return;
        }
        barPointer = {
          pointerId: event.pointerId,
          startX: event.clientX,
          scrollLeft: barTabs.scrollLeft,
          moved: false
        };
        button.setPointerCapture?.(event.pointerId);
      });
      button.addEventListener("pointermove", (event) => {
        if (!barPointer || barPointer.pointerId !== event.pointerId) return;
        const delta = event.clientX - barPointer.startX;
        if (Math.abs(delta) >= 12) barPointer.moved = true;
        if (!barPointer.moved) return;
        barTabs.scrollLeft = barPointer.scrollLeft - delta;
        barTabs.classList.add("is-dragging");
        event.preventDefault();
      });
      const finishBarPointer = (event) => {
        if (!barPointer || barPointer.pointerId !== event.pointerId) return;
        const moved = barPointer.moved;
        barPointer = null;
        button.releasePointerCapture?.(event.pointerId);
        barTabs.classList.remove("is-dragging");
        button.dataset.skipNextClick = "1";
        skipNextBarClickIndex = index;
        window.setTimeout(() => {
          if (skipNextBarClickIndex === index) skipNextBarClickIndex = null;
          if (button.dataset.skipNextClick === "1") delete button.dataset.skipNextClick;
        }, 0);
        event.preventDefault();
        event.stopPropagation();
        if (!moved) toggleBarMultiSelect(index, event);
      };
      button.addEventListener("pointerup", finishBarPointer);
      button.addEventListener("pointercancel", (event) => {
        if (!barPointer || barPointer.pointerId !== event.pointerId) return;
        barPointer = null;
        button.releasePointerCapture?.(event.pointerId);
        barTabs.classList.remove("is-dragging");
      });
      button.addEventListener("click", (event) => {
        if (button.dataset.skipNextClick === "1" || skipNextBarClickIndex === index) {
          delete button.dataset.skipNextClick;
          skipNextBarClickIndex = null;
          event.preventDefault();
          return;
        }
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
          toggleBarMultiSelect(index, event);
          return;
        }
        toggleBarMultiSelect(index, event);
      });
      button.addEventListener("contextmenu", (event) => {
        openBarContextMenu(event, index);
      });
      barTabs.appendChild(button);
    }
    updatePlaybackTabHighlights();
  }

  function renderStepGrid() {
    syncActiveLoopToBar();
    if (state.cameraMode) {
      loopTabs.querySelectorAll("button").forEach((button) => {
        button.classList.toggle("is-active", Number(button.dataset.loop) === state.activeLoopIndex);
      });
      document.querySelectorAll(".bar-tabs button").forEach((button) => {
        const barIndex = Number(button.dataset.bar);
        button.classList.toggle("is-active", barIndex === state.activeBar);
        button.classList.toggle("is-multi-selected", state.selectedBars.includes(barIndex));
        button.classList.toggle("is-section-start", Number(button.dataset.localBar) % sectionBarCount() === 0);
      });
      stepGrid.querySelectorAll(".track-label").forEach((label) => {
        const isPrimary = state.selected?.hit === label.dataset.hit && state.selected?.mode === "row";
        const inSelection = state.selectedTracks.includes(label.dataset.hit);
        label.classList.toggle("is-selected-row", isPrimary || inSelection);
      });
      renderSoloButtons();
      requestCameraCanvasRender();
      updatePlaybackTabHighlights();
      onAfterRender();
      return;
    }
    // Refresh bar-start step headers to show current bar numbers
    stepGrid.querySelectorAll(".step-header--step[data-bar-seg]").forEach((header) => {
      const seg = Number(header.dataset.barSeg);
      const barIndex = barIndexForSegment(seg);
      const barLabel = header.querySelector(".step-header__bar-label");
      if (barLabel) barLabel.textContent = `Bar ${barIndex + 1}`;
      header.classList.toggle("is-bar-selected", state.selectedBars.includes(barIndex));
    });
    // Don't overwrite the loop-count input while user may be editing it.
    loopTabs.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.loop) === state.activeLoopIndex);
    });
    document.querySelectorAll(".bar-tabs button").forEach((button) => {
      const barIndex = Number(button.dataset.bar);
      button.classList.toggle("is-active", barIndex === state.activeBar);
      button.classList.toggle("is-multi-selected", state.selectedBars.includes(barIndex));
      button.classList.toggle("is-section-start", Number(button.dataset.localBar) % sectionBarCount() === 0);
    });
    stepGrid.querySelectorAll(".step-button").forEach((button) => {
      const hit = button.dataset.hit;
      const step = Number(button.dataset.step);
      const visualStep = Number(button.dataset.visualStep ?? button.dataset.step);
      const stepsPerBar = Number(button.dataset.stepsPerBar ?? BASE_STEPS_PER_BAR);
      const seg = Number(button.dataset.seg ?? 0);
      const barIndex = barIndexForSegment(seg);
      const hitData = getHitData(hit, step, barIndex);
      const velocity = visualVelocityFor(hit, step, barIndex);
      const isGeneratedRow = button.dataset.type === "generated";
      button.classList.toggle("is-on", velocity > 0);
      button.classList.toggle("is-generated-on", isGeneratedRow && hitData.generated && velocity > 0);
      button.classList.toggle("is-selected",
        state.selected?.hit === hit && state.selected?.step === step && (state.selected?.bar ?? state.activeBar) === barIndex);
      button.classList.toggle("is-row-selected", state.selected?.hit === hit && state.selected?.mode === "row");
      button.style.setProperty("--level", String(Math.min(1, velocity / 0.9)));
      const displayedPitch = displayedPitchForHit(hit, step, hitData.options, barIndex);
      button.dataset.note = "";
      const pitchLabel = `pitch ${formatPitch(displayedPitch)}`;
      button.title = `${hit} bar ${barIndex + 1} step ${visualStep + 1}/${stepsPerBar}: ${velocity.toFixed(2)} ${pitchLabel} offset ${hitData.options.offsetMs}ms`;
    });
    stepGrid.querySelectorAll(".track-label").forEach((label) => {
      const isPrimary = state.selected?.hit === label.dataset.hit && state.selected?.mode === "row";
      const inSelection = state.selectedTracks.includes(label.dataset.hit);
      label.classList.toggle("is-selected-row", isPrimary || inSelection);
    });
    renderSoloButtons();
    updatePlaybackTabHighlights();
    onAfterRender();
  }

  return {
    buildStepGrid,
    buildLoopTabs,
    buildBarTabs,
    renderStepGrid,
    refreshPianoRollLanes,
    renderCameraPlayheadHits,
    clearCameraPlayheadHits,
    updatePlaybackTabHighlights
  };
}
