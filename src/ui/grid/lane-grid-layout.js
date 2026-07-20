const CAMERA_HEADER_ROW_HEIGHT = 20;
const CAMERA_TRACK_ROW_HEIGHT = 32;

function numericPx(value) {
  const number = Number.parseFloat(String(value || ""));
  return Number.isFinite(number) ? number : 0;
}

function gridRowStartFor(el) {
  const inlineRow = String(el?.style?.gridRow || el?.style?.gridRowStart || "");
  const inlineStart = Number.parseInt(inlineRow, 10);
  if (Number.isFinite(inlineStart)) return inlineStart;

  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return 0;
  const computedStart = Number.parseInt(window.getComputedStyle(el).gridRowStart, 10);
  return Number.isFinite(computedStart) ? computedStart : 0;
}

function desiredRowHeightFor(el, defaultHeight) {
  const isResizableEditorLane = el?.classList?.contains?.("piano-roll-lane")
    || el?.classList?.contains?.("piano-roll-lane-label")
    || el?.classList?.contains?.("sample-lane")
    || el?.classList?.contains?.("sample-lane-label");
  const isFixedGridRow = !isResizableEditorLane && (
    el?.classList?.contains?.("track-label")
    || el?.classList?.contains?.("step-row")
  );
  if (isFixedGridRow) return defaultHeight;

  const inlineHeight = numericPx(el?.style?.height);
  const inlineMinHeight = numericPx(el?.style?.minHeight);
  const laneHeight = numericPx(el?.style?.getPropertyValue?.("--lane-height"));
  const rectHeight = typeof el?.getBoundingClientRect === "function"
    ? numericPx(el.getBoundingClientRect().height)
    : 0;
  return Math.max(defaultHeight, inlineHeight, inlineMinHeight, laneHeight, rectHeight);
}

export function syncStepGridLaneRows(stepGrid) {
  if (!stepGrid?.classList?.contains?.("is-camera-canvas")) return;

  const rowHeights = new Map([[1, CAMERA_HEADER_ROW_HEIGHT]]);
  stepGrid
    .querySelectorAll(".track-label, .step-row, .piano-roll-lane, .piano-roll-lane-label, .sample-lane, .sample-lane-label")
    .forEach((el) => {
      const row = gridRowStartFor(el);
      if (!Number.isFinite(row) || row < 2) return;
      const height = desiredRowHeightFor(el, CAMERA_TRACK_ROW_HEIGHT);
      rowHeights.set(row, Math.max(rowHeights.get(row) || CAMERA_TRACK_ROW_HEIGHT, height));
    });

  const lastRow = Math.max(1, ...rowHeights.keys());
  const rows = [];
  for (let row = 1; row <= lastRow; row += 1) {
    const fallback = row === 1 ? CAMERA_HEADER_ROW_HEIGHT : CAMERA_TRACK_ROW_HEIGHT;
    rows.push(`${Math.round(rowHeights.get(row) || fallback)}px`);
  }
  stepGrid.style.gridTemplateRows = rows.join(" ");
  stepGrid.style.setProperty("--camera-grid-rows", String(lastRow));
}
