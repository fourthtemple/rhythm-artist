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

import { visualBeatKindForStep } from "../audio/rhythm-config.js";

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
 * @param {(hit:string) => number} deps.trackStepCount
 * @param {() => number} deps.loopCount
 * @param {(barIndex?:number) => number} deps.localBarIndex
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
 * @param {(hit:string, event?:object) => void} deps.selectRowWithModifiers
 * @param {(hit:string) => void} deps.selectRowToggle
 * @param {(hit:string, step:number, mode?:string, barIndex?:number, pressure?:number, generated?:boolean) => void} deps.selectStep
 * @param {(hit:string, step:number, barIndex?:number) => any} deps.getHitData
 * @param {(hit:string, step:number, velocity:number, barIndex?:number) => void} deps.setHitVelocity
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
    trackStepCount,
    loopCount,
    localBarIndex,
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
    selectRowWithModifiers,
    selectRowToggle,
    selectStep,
    getHitData,
    setHitVelocity,
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
    resetSelectedPanel
  } = deps;
  const onAfterBuild = deps.onAfterBuild ?? (() => {});
  const onAfterRender = deps.onAfterRender ?? (() => {});
  const BASE_STEPS_PER_BAR = 16;
  const GRID_COLUMNS_PER_BAR = 96;
  const CAMERA_HEADER_HEIGHT = 32;
  let cameraCanvas = null;
  let cameraCanvasWrap = null;
  let cameraCanvasMetrics = null;
  let cameraSelectionOverlay = null;
  let cameraHoverOverlay = null;
  let cameraHover = null;
  let cameraDrag = null;
  let cameraSuppressClick = false;
  let cameraRenderRaf = 0;
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
    rowLabel.dataset.type = type;
    rowLabel.style.setProperty("--track-accent", accent);
    rowLabel.style.setProperty("--group-accent", accent);
    rowLabel.tabIndex = 0;
    rowLabel.title = `Select ${label} row · Shift-click for a range · ⌘/Ctrl-click to toggle`;
    const rowText = document.createElement("span");
    rowText.textContent = label;
    rowText.title = label;
    const soloButton = document.createElement("button");
    soloButton.type = "button";
    soloButton.className = "solo-button";
    soloButton.dataset.soloTrack = hit;
    soloButton.textContent = "S";
    soloButton.title = `Solo ${label}`;
    soloButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSolo(hit);
    });
    rowLabel.addEventListener("click", (event) => {
      selectRowWithModifiers(hit, event);
      renderStepGrid();
    });
    rowLabel.addEventListener("contextmenu", (event) => {
      if (!state.selectedTracks.includes(hit)) {
        selectRowWithModifiers(hit, {});
        renderStepGrid();
      }
      openTrackContextMenu(event, hit);
    });
    rowLabel.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectRowToggle(hit);
      renderStepGrid();
    });
    rowLabel.append(rowText, soloButton);
    return rowLabel;
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
    trackColor,
    accent,
    accent2
  }) {
    const radius = Math.min(5, height / 2);
    const level = Math.max(0, Math.min(1, velocity / 0.95));
    const isOn = velocity > 0.005;
    const activeColor = trackColor || (generated ? "#86efac" : "#7dd3fc");

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
        const meterH = Math.max(3, innerH * level);
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
        hitGradient.addColorStop(0, colorAlpha(activeColor, 0.94));
        hitGradient.addColorStop(0.68, colorAlpha(activeColor, 0.78));
        hitGradient.addColorStop(1, colorAlpha(activeColor, 0.62));
        fillRoundedRect(ctx, innerX, meterY, innerW, meterH, Math.min(innerRadius, meterH / 2), hitGradient);

        strokeRoundedRect(
          ctx,
          innerX + 0.5,
          meterY + 0.5,
          Math.max(1, innerW - 1),
          Math.max(1, meterH - 1),
          Math.min(innerRadius, meterH / 2),
          "rgba(255,255,255,0.2)",
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
      const fallbackTop = CAMERA_HEADER_HEIGHT + index * 38;
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

    const muted = canvasCssColor("--muted", "#8f9bae");
    const accent = canvasCssColor("--accent", "#8bd8bd");
    const accent2 = canvasCssColor("--accent-2", "#f5d76e");
    const line = canvasCssColor("--line", "#27313d");
    const barWidth = cssWidth / Math.max(1, renderedSegmentCount());
    const rows = cameraRowMetrics();
    cameraCanvasMetrics = { barWidth, rows };

    ctx.fillStyle = "#101620";
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = "#151c28";
    ctx.fillRect(0, 0, cssWidth, CAMERA_HEADER_HEIGHT);

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
        ctx.moveTo(x, CAMERA_HEADER_HEIGHT);
        ctx.lineTo(x, cssHeight);
      }
    }
    ctx.stroke();

    ctx.font = "700 9px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillStyle = accent2;
    for (let bar = 0; bar < renderedSegmentCount(); bar += 1) {
      const x = bar * barWidth + 5;
      ctx.fillText(`Bar ${bar + 1}`, x, 4);
    }
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillStyle = muted;
    for (let bar = 0; bar < renderedSegmentCount(); bar += 1) {
      if (barWidth < 96 && bar % 2 !== 0) continue;
      for (let step = 0; step < BASE_STEPS_PER_BAR; step += 4) {
        const x = bar * barWidth + (step * barWidth) / BASE_STEPS_PER_BAR + 5;
        ctx.fillText(String(step + 1).padStart(2, "0"), x, 18);
      }
    }

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
          const velocity = hitData.velocity;
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
            trackColor: row.accent,
            accent,
            accent2
          });
        }
      }
    });

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

  function sameCameraTarget(a, b) {
    if (!a || !b) return !a && !b;
    return a.hit === b.hit && a.step === b.step && a.bar === b.bar;
  }

  function cameraCellRectForTarget(target) {
    if (!target || !cameraCanvasMetrics) return null;
    const row = cameraCanvasMetrics.rows.find((item) => item.hit === target.hit);
    if (!row || !state.config.patterns.jazz.bars[target.bar]) return null;
    const stepGap = Math.max(0.5, Math.min(4, 80 / Math.max(1, row.steps * visibleSegmentCount())));
    const stepWidth = Math.max(1, cameraCanvasMetrics.barWidth / row.steps);
    const visualStep = Math.max(0, Math.min(row.steps - 1, Math.round(Number(target.visualStep) || 0)));
    const width = Math.max(1, stepWidth - stepGap);
    return {
      x: target.bar * cameraCanvasMetrics.barWidth + visualStep * stepWidth + stepGap / 2,
      y: row.top + 5,
      width,
      height: Math.max(4, row.height - 10),
      radius: Math.min(5, Math.max(4, row.height - 10) / 2),
      accent: row.accent || "#7dd3fc"
    };
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
    if (!cameraCanvasWrap || !cameraCanvasMetrics) renderCameraCanvas();
    if (!cameraCanvasWrap || !cameraCanvasMetrics) return 0;
    const rect = cameraCanvasWrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    return x / Math.max(1, cameraCanvasMetrics.barWidth);
  }

  function cameraEventIsRuler(event) {
    if (!cameraCanvasWrap) return false;
    const rect = cameraCanvasWrap.getBoundingClientRect();
    const y = event.clientY - rect.top;
    return y >= 0 && y <= CAMERA_HEADER_HEIGHT;
  }

  function cameraRangeFromPositions(startBarPosition, endBarPosition) {
    const startStep = clampCameraStepAbs(startBarPosition * BASE_STEPS_PER_BAR);
    const endStep = clampCameraStepAbs(endBarPosition * BASE_STEPS_PER_BAR);
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
          status.textContent = "Beat selection cleared";
        }
      }
    ]);
  }

  function hitTestCameraCanvas(event) {
    if (!cameraCanvasWrap || !cameraCanvasMetrics) renderCameraCanvas();
    if (!cameraCanvasWrap || !cameraCanvasMetrics) return null;
    const rect = cameraCanvasWrap.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
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

  function buildCameraGrid() {
    const previousScrollLeft = stepGrid.scrollLeft;
    const rows = gridRows();
    cameraHover = null;
    stepGrid.innerHTML = "";
    stepGrid.classList.add("is-camera-canvas");
    stepGrid.style.setProperty("--camera-grid-rows", String(rows.length + 1));

    const corner = Object.assign(document.createElement("div"), {
      className: "step-header step-header--corner",
      textContent: "Track"
    });
    corner.style.gridColumn = "1";
    corner.style.gridRow = "1";
    stepGrid.appendChild(corner);

    cameraCanvasWrap = document.createElement("div");
    cameraCanvasWrap.className = "camera-grid-canvas-wrap";
    cameraCanvasWrap.style.gridColumn = "2 / -1";
    cameraCanvasWrap.style.gridRow = `1 / span ${rows.length + 1}`;
    cameraCanvas = document.createElement("canvas");
    cameraCanvas.className = "camera-grid-canvas";
    cameraCanvasWrap.appendChild(cameraCanvas);
    cameraSelectionOverlay = document.createElement("div");
    cameraSelectionOverlay.className = "camera-grid-selection";
    cameraSelectionOverlay.hidden = true;
    cameraCanvasWrap.appendChild(cameraSelectionOverlay);
    cameraHoverOverlay = document.createElement("div");
    cameraHoverOverlay.className = "camera-grid-hover";
    cameraHoverOverlay.hidden = true;
    cameraCanvasWrap.appendChild(cameraHoverOverlay);
    const playheadLine = document.createElement("div");
    playheadLine.className = "camera-grid-playhead-line";
    playheadLine.hidden = true;
    cameraCanvasWrap.appendChild(playheadLine);
    cameraCanvasWrap.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (!cameraEventIsRuler(event)) return;
      cameraDrag = {
        pointerId: event.pointerId,
        startBarPosition: cameraBarPositionFromEvent(event),
        moved: false
      };
      setCameraHover(null);
      cameraCanvasWrap.classList.add("is-ruler-dragging");
      cameraCanvasWrap.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    cameraCanvasWrap.addEventListener("pointermove", (event) => {
      if (!cameraDrag || cameraDrag.pointerId !== event.pointerId) return;
      const current = cameraBarPositionFromEvent(event);
      const distanceSteps = Math.abs(current - cameraDrag.startBarPosition) * BASE_STEPS_PER_BAR;
      if (distanceSteps >= 0.35) cameraDrag.moved = true;
      if (!cameraDrag.moved) return;
      const range = cameraRangeFromPositions(cameraDrag.startBarPosition, current);
      setCameraBeatSelection(range);
      status.textContent = `Selected beats ${cameraRangeLabel(range)}`;
      setCameraHover(null);
      event.preventDefault();
    });
    const finishCameraDrag = (event) => {
      if (!cameraDrag || cameraDrag.pointerId !== event.pointerId) return;
      if (cameraDrag.moved) {
        const range = cameraRangeFromPositions(cameraDrag.startBarPosition, cameraBarPositionFromEvent(event));
        setCameraBeatSelection(range);
        status.textContent = `Selected beats ${cameraRangeLabel(range)}`;
        cameraSuppressClick = true;
        event.preventDefault();
      }
      cameraCanvasWrap.releasePointerCapture?.(event.pointerId);
      cameraDrag = null;
      cameraCanvasWrap.classList.remove("is-ruler-dragging");
    };
    cameraCanvasWrap.addEventListener("pointerup", finishCameraDrag);
    cameraCanvasWrap.addEventListener("pointercancel", finishCameraDrag);
    cameraCanvasWrap.addEventListener("mousedown", (event) => {
      if (event.button === 0) event.preventDefault();
    });
    cameraCanvasWrap.addEventListener("mousemove", (event) => {
      const inRuler = cameraEventIsRuler(event);
      cameraCanvasWrap.classList.toggle("is-ruler-hovering", inRuler);
      if (inRuler) {
        setCameraHover(null);
        return;
      }
      setCameraHover(hitTestCameraCanvas(event));
    });
    cameraCanvasWrap.addEventListener("mouseleave", () => {
      cameraCanvasWrap.classList.remove("is-ruler-hovering");
      cameraCanvasWrap.classList.remove("is-ruler-dragging");
      setCameraHover(null);
    });
    cameraCanvasWrap.addEventListener("click", (event) => {
      if (cameraSuppressClick) {
        cameraSuppressClick = false;
        return;
      }
      const hit = hitTestCameraCanvas(event);
      if (!hit || !state.config.patterns.jazz.bars[hit.bar]) return;
      setCameraHover(hit);
      const scrollLeft = stepGrid.scrollLeft;
      const scrollTop = stepGrid.scrollTop;
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
      const current = getHitData(hit.hit, hit.step, hit.bar);
      if (current.velocity <= 0.005) {
        setHitVelocity(hit.hit, hit.step, DEFAULT_VELOCITY[hit.hit] ?? 0.5, hit.bar);
      }
      selectStep(hit.hit, hit.step, "step", hit.bar, state.intensity, hit.type === "generated");
      renderStepGrid();
      stepGrid.scrollLeft = scrollLeft;
      stepGrid.scrollTop = scrollTop;
    });
    cameraCanvasWrap.addEventListener("contextmenu", (event) => {
      const inRuler = cameraEventIsRuler(event);
      if (!inRuler && !state.cameraBeatSelection?.lengthSteps) return;
      if (inRuler && !state.cameraBeatSelection?.lengthSteps) {
        const position = cameraBarPositionFromEvent(event);
        setCameraBeatSelection(cameraRangeFromPositions(position, position + 1 / BASE_STEPS_PER_BAR));
      }
      openCameraSelectionMenu(event);
    });
    stepGrid.appendChild(cameraCanvasWrap);

    rows.forEach(({ id: hit, label, type, accent }, index) => {
      const rowLabel = makeTrackLabel(hit, label, type, accent);
      rowLabel.style.gridColumn = "1";
      rowLabel.style.gridRow = String(index + 2);
      stepGrid.appendChild(rowLabel);
    });
    renderStepGrid();
    onAfterBuild();
    stepGrid.scrollLeft = previousScrollLeft;
    requestCameraCanvasRender();
  }

  function buildStepGrid() {
    state.cameraMode = true;
    const segments = visibleSegmentCount();
    const renderedSegments = renderedSegmentCount();
    const visibleGridColumns = segments * GRID_COLUMNS_PER_BAR;
    const renderedGridColumns = renderedSegments * GRID_COLUMNS_PER_BAR;
    const maxVisibleSteps = Math.max(
      BASE_STEPS_PER_BAR,
      ...gridRows().map(({ id }) => rowStepCount(id))
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
    const labelWidth = 92;
    const visibleGapWidth = visibleGridColumns * stepGapX;
    const stepColumnWidth = Math.max(0.02, (gridWidth - labelWidth - visibleGapWidth) / visibleGridColumns);
    stepGrid.style.setProperty("--step-gap-x", `${stepGapX}px`);
    stepGrid.style.setProperty("--step-gap-y", `${stepGapY}px`);
    stepGrid.style.setProperty("--hit-inset", `${hitInset}px`);
    stepGrid.style.setProperty("--hit-radius", `${hitRadius}px`);
    stepGrid.style.setProperty("--step-column-width", `${stepColumnWidth}px`);
    barTabs.style.setProperty("--bar-gap", `${barGap}px`);
    barTabs.style.setProperty("--bar-tab-pad-x", `${barPadX}px`);
    stepGrid.classList.toggle("is-camera-scroll", Boolean(state.cameraMode));
    stepGrid.classList.toggle("is-camera-canvas", Boolean(state.cameraMode));
    stepGrid.classList.remove("is-camera-active");
    stepGrid.style.setProperty("--camera-x", "0px");
    if (!state.cameraMode) {
      stepGrid.scrollLeft = 0;
    }
    if (state.cameraMode) {
      buildCameraGrid();
      return;
    }
    cameraCanvas = null;
    cameraCanvasWrap = null;
    cameraCanvasMetrics = null;
    cameraSelectionOverlay = null;
    cameraHoverOverlay = null;
    cameraHover = null;
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
        const globalStep = seg * BASE_STEPS_PER_BAR + step + 1;
        header.textContent = String(globalStep).padStart(2, "0");
        if (step === 0) {
          header.classList.add("is-bar-start");
          header.dataset.barSeg = String(seg); // used by renderStepGrid
          // bar label span — text updated by renderStepGrid
          const barSpan = document.createElement("span");
          barSpan.className = "step-header__bar-label";
          barSpan.textContent = `Bar ${barIndexForSegment(seg) + 1}`;
          header.prepend(barSpan);
        }
        stepGrid.appendChild(header);
      }
    }

    gridRows().forEach(({ id: hit, label, type, accent }) => {
      const rowLabel = makeTrackLabel(hit, label, type, accent);
      stepGrid.appendChild(rowLabel);

      const stepsForTrack = rowStepCount(hit);
      const stepRow = document.createElement("div");
      stepRow.className = `step-row ${type === "generated" ? "is-generated-row" : ""}`;
      stepRow.dataset.hit = hit;
      stepRow.dataset.type = type;
      stepRow.dataset.stepsPerBar = String(stepsForTrack);
      stepRow.style.gridColumn = "2 / -1";
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
            const current = getHitData(hit, step, barIndex);
            if (current.velocity <= 0.005) {
              setHitVelocity(hit, step, DEFAULT_VELOCITY[hit] ?? 0.5, barIndex);
            }
            selectStep(hit, step, "step", barIndex, state.intensity, type === "generated");
            renderStepGrid();
            stepGrid.scrollLeft = scrollLeft;
            stepGrid.scrollTop = scrollTop;
          });
          stepRow.appendChild(button);
        }
      }
      stepGrid.appendChild(stepRow);
    });
    renderStepGrid();
    onAfterBuild();
  }

  function buildLoopTabs() {
    syncActiveLoopToBar();
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
      button.textContent = `Verse ${index + 1}`;
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
  }

  function buildBarTabs() {
    syncActiveLoopToBar();
    barTabs.innerHTML = "";
    const barsPerLoop = loopBarCount();
    const barsPerSection = sectionBarCount();
    barTabs.style.setProperty("--bar-tab-count", String(barsPerLoop));
    for (let localIndex = 0; localIndex < barsPerLoop; localIndex += 1) {
      const index = loopStartBar() + localIndex;
      if (!state.config.patterns.jazz.bars[index]) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.bar = String(index);
      button.dataset.localBar = String(localIndex);
      button.dataset.section = String(Math.floor(localIndex / barsPerSection) + 1);
      button.textContent = String(localIndex + 1).padStart(2, "0");
      button.title = `Loop ${state.activeLoopIndex + 1}, bar ${localIndex + 1} (song bar ${index + 1}) · Shift-click to multi-select · Right-click to copy/paste`;
      button.classList.toggle("is-multi-selected", state.selectedBars.includes(index));
      button.addEventListener("click", (event) => {
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
          toggleBarMultiSelect(index, event);
          return;
        }
        state.selectedBars = [];
        state.selectedLoops = [];
        state.barAnchor = index;
        state.loopAnchor = state.activeLoopIndex;
        // Snap to segment boundary so the grid always shows a full segment window
        const segments = state.segmentsCount ?? 1;
        state.activeBar = Math.floor(index / segments) * segments;
        syncActiveLoopToBar();
        if (activeLoopLength()) {
          state.loopBarIndex = clampLoopStart(index, activeLoopLength());
          state.engine.setConfig(previewConfig());
          state.engine.seekToPhraseBar(index, 0);
          state.playheadStep = 0;
          refreshLoopBarButton();
        } else if (state.playing) {
          state.engine.seekToPhraseBar(index, 0);
          state.playheadStep = 0;
          status.textContent = `Jumped to bar ${String(index + 1).padStart(2, "0")}`;
        }
        syncSelectionAfterNavigation();
        clearPlayhead();
        buildBarTabs();
        renderStepGrid();
        if (state.cameraMode) {
          scrollCameraToBar(index);
        }
      });
      button.addEventListener("contextmenu", (event) => {
        if (!state.selectedBars.includes(index)) {
          state.selectedBars = [index];
          state.barAnchor = index;
          buildBarTabs();
        }
        openBarContextMenu(event, index);
      });
      barTabs.appendChild(button);
    }
  }

  function renderStepGrid() {
    syncActiveLoopToBar();
    if (state.cameraMode) {
      loopTabs.querySelectorAll("button").forEach((button) => {
        button.classList.toggle("is-active", Number(button.dataset.loop) === state.activeLoopIndex);
      });
      document.querySelectorAll(".bar-tabs button").forEach((button) => {
        const barIndex = Number(button.dataset.bar);
        const segments = state.segmentsCount ?? 1;
        const inWindow = barIndex >= state.activeBar && barIndex < state.activeBar + segments;
        button.classList.toggle("is-active", inWindow);
        button.classList.toggle("is-section-start", Number(button.dataset.localBar) % sectionBarCount() === 0);
      });
      stepGrid.querySelectorAll(".track-label").forEach((label) => {
        const isPrimary = state.selected?.hit === label.dataset.hit && state.selected?.mode === "row";
        const inSelection = state.selectedTracks.includes(label.dataset.hit);
        label.classList.toggle("is-selected-row", isPrimary || inSelection);
      });
      renderSoloButtons();
      requestCameraCanvasRender();
      onAfterRender();
      return;
    }
    // Refresh bar-start step headers to show current bar numbers
    stepGrid.querySelectorAll(".step-header--step[data-bar-seg]").forEach((header) => {
      const seg = Number(header.dataset.barSeg);
      const barLabel = header.querySelector(".step-header__bar-label");
      if (barLabel) barLabel.textContent = `Bar ${barIndexForSegment(seg) + 1}`;
    });
    // Don't overwrite the loop-count input while user may be editing it.
    loopTabs.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.loop) === state.activeLoopIndex);
    });
    document.querySelectorAll(".bar-tabs button").forEach((button) => {
      const barIndex = Number(button.dataset.bar);
      const segments = state.segmentsCount ?? 1;
      const inWindow = barIndex >= state.activeBar && barIndex < state.activeBar + segments;
      button.classList.toggle("is-active", inWindow);
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
      const velocity = hitData.velocity;
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
    onAfterRender();
  }

  return { buildStepGrid, buildLoopTabs, buildBarTabs, renderStepGrid };
}
