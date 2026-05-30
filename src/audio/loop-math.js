// Pure bar/loop arithmetic for the sequencer arrangement.
//
// A "song" is a flat array of bars. Bars are grouped into fixed-size loops of
// `loopBarCount` bars each. These helpers convert between bar indices, loop
// indices, and human-facing labels without touching editor state, so they are
// trivial to unit test. The editor keeps thin wrappers that feed live state
// (the bars array length and the active bar) into these functions.

/** Number of whole loops needed to hold `barsLength` bars (at least one). */
export function loopCountFor(barsLength, loopBarCount) {
  return Math.max(1, Math.ceil(barsLength / loopBarCount));
}

/** Position of a bar within its loop (0 … loopBarCount-1), wrapping safely. */
export function localBarIndex(barIndex, loopBarCount) {
  return ((Math.round(barIndex) % loopBarCount) + loopBarCount) % loopBarCount;
}

/** Which loop a bar belongs to, clamped to the legal [0, maxLoopCount) range. */
export function loopIndexForBar(barIndex, loopBarCount, maxLoopCount) {
  return Math.max(0, Math.min(maxLoopCount - 1, Math.floor(Math.max(0, barIndex) / loopBarCount)));
}

/** First song-bar index of a loop, clamped to the loops that actually exist. */
export function loopStartBar(loopIndex, barsLength, loopBarCount) {
  return Math.max(0, Math.min(loopCountFor(barsLength, loopBarCount) - 1, loopIndex)) * loopBarCount;
}

/** Clamp a loop start so a window of `length` bars fits inside the song. */
export function clampLoopStart(start, length, barsLength) {
  const safeLength = Math.max(1, Math.round(length) || 1);
  const maxStart = Math.max(0, barsLength - safeLength);
  return Math.max(0, Math.min(maxStart, Math.round(Number(start) || 0)));
}

/** Human label for a bar, e.g. "2.05" = loop 2, local bar 5. */
export function barLabel(barIndex, loopBarCount, maxLoopCount) {
  return `${loopIndexForBar(barIndex, loopBarCount, maxLoopCount) + 1}.${String(localBarIndex(barIndex, loopBarCount) + 1).padStart(2, "0")}`;
}
