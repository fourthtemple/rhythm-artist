// Pure geometry/clamping helpers for loop-track regions on the arrangement
// lane. A region is `{ bar, len, gain, chops }` placed over the song's bar
// timeline. These helpers clamp region fields and convert between pixels, bars,
// and percentages with no DOM or editor state, so the lane renderer and drag
// handlers can stay thin.

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
};

const clampFloat = (value, min, max, fallback) => {
  const n = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
};

/** Clamp a region's start bar so the region stays inside the song. */
export function clampRegionBar(bar, len, totalBars) {
  return Math.max(0, Math.min(Math.max(0, totalBars - len), clampInt(bar, 0, totalBars, 0)));
}

/** Clamp a region's length so `bar + len` stays inside the song. */
export function clampRegionLen(len, bar, totalBars) {
  return Math.max(1, Math.min(Math.max(1, totalBars - bar), clampInt(len, 1, totalBars, 1)));
}

/** Clamp a chop count to the supported 1..32 range. */
export function clampRegionChops(chops) {
  return clampInt(chops, 1, 32, 4);
}

/** Clamp a region gain to the 0..2 range. */
export function clampRegionGain(gain) {
  return clampFloat(gain, 0, 2, 1);
}

/**
 * Normalize raw region field inputs (e.g. from the region panel) into a clean
 * `{ bar, len, gain, chops }` object, clamped against the song length.
 */
export function normalizeRegion({ bar, len, gain, chops }, totalBars) {
  const safeBar = Math.max(0, clampInt(bar, 0, totalBars, 0));
  const safeLen = Math.max(1, clampInt(len, 1, totalBars, 1));
  return {
    bar: safeBar,
    len: safeLen,
    chops: clampRegionChops(chops),
    gain: clampRegionGain(gain)
  };
}

/** Build a fresh region at a clicked bar, sized to the loop's source length. */
export function regionAtBar(clickBar, barsInFile, totalBars) {
  return {
    bar: clampInt(clickBar, 0, Math.max(0, totalBars - 1), 0),
    len: Math.min(Math.max(1, barsInFile), totalBars),
    gain: 1,
    chops: 4
  };
}

/** Convert a horizontal pixel delta into a (rounded) bar delta. */
export function pixelsToBars(dxPixels, pxPerBar) {
  return Math.round(dxPixels / Math.max(1, pxPerBar));
}

/** Position/width as percentages of the song timeline, for CSS placement. */
export function regionPercent(region, totalBars) {
  const span = Math.max(1, totalBars);
  return {
    left: (region.bar / span) * 100,
    width: (region.len / span) * 100
  };
}
