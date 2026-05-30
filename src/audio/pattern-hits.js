// Pure helpers for normalizing and serializing pattern "hit" entries.
//
// A hit entry describes a single note placed on a track row at a given step.
// On disk it is stored as a compact tuple `[step, velocity]` or, when it
// carries non-default step options, `[step, velocity, options]`. In memory we
// prefer the richer `{ step, velocity, options }` shape. These helpers convert
// between the two representations and have no dependency on editor state, which
// keeps them easy to unit test in isolation.
import { normalizeStepOptions, STEP_OPTION_DEFAULTS } from "./rhythm-config.js";

const clampNumber = (value, min, max, fallback = 0) => {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
};

/**
 * Coerce any stored hit representation (tuple, object, or junk) into the
 * canonical `{ step, velocity, options }` shape with normalized step options.
 */
export function normalizeHitEntry(entry) {
  if (Array.isArray(entry)) {
    const [step, velocity, options] = entry;
    return {
      step: Math.round(clampNumber(step, 0, 15, 0)),
      velocity: clampNumber(velocity, 0, 1, 0),
      options: normalizeStepOptions(options)
    };
  }
  if (entry && typeof entry === "object") {
    const optionSource = entry.options && typeof entry.options === "object"
      ? { ...entry.options, ...entry }
      : entry;
    return {
      step: Math.round(clampNumber(entry.step, 0, 15, 0)),
      velocity: clampNumber(entry.velocity, 0, 1, 0),
      options: normalizeStepOptions(optionSource)
    };
  }
  return { step: 0, velocity: 0, options: normalizeStepOptions() };
}

/**
 * True when any step option deviates from its default, meaning the options
 * object must be persisted alongside the step/velocity tuple.
 */
export function hasStepOptions(options = {}) {
  return Object.entries(STEP_OPTION_DEFAULTS)
    .some(([key, value]) => Math.abs(Number(options[key] ?? value) - value) > 0.0001);
}

/**
 * Convert a hit entry into the compact on-disk tuple, only attaching an options
 * object when it carries non-default values.
 */
export function serializeHitEntry(entry) {
  const normalized = normalizeHitEntry(entry);
  const tuple = [
    normalized.step,
    Number(normalized.velocity.toFixed(2))
  ];
  if (hasStepOptions(normalized.options)) {
    tuple.push({
      pitch: normalized.options.pitch,
      offsetMs: normalized.options.offsetMs,
      attackMs: normalized.options.attackMs,
      delayMs: normalized.options.delayMs,
      delaySend: Number(normalized.options.delaySend.toFixed(2)),
      reverbSend: Number(normalized.options.reverbSend.toFixed(2)),
      dubEcho: Number(normalized.options.dubEcho.toFixed(2)),
      wobble: Number(normalized.options.wobble.toFixed(2))
    });
  }
  return tuple;
}

/**
 * Build a `Map<step, normalizedEntry>` for a single track row within a bar.
 * Pure: reads `bar[hit]` and normalizes each stored entry. Returns an empty
 * Map when the row is missing.
 */
export function buildHitMap(bar, hit) {
  return new Map((bar?.[hit] || []).map((entry) => {
    const normalized = normalizeHitEntry(entry);
    return [normalized.step, normalized];
  }));
}

/**
 * Look up the stored entry for a given step in a bar's track row, or `null`
 * when the step has no stored hit. Pure read against the provided bar.
 */
export function readStoredHit(bar, hit, step) {
  return buildHitMap(bar, hit).get(step) || null;
}

/**
 * Commit a single (already merged) entry back into a bar's track row,
 * mutating `bar[hit]`. When the entry's velocity is effectively silent the
 * step is removed. The row is always re-sorted by step and serialized to the
 * compact on-disk tuple form.
 */
export function commitHitEntry(bar, hit, step, mergedEntry) {
  const next = buildHitMap(bar, hit);
  if (!mergedEntry || mergedEntry.velocity <= 0.005) next.delete(step);
  else next.set(step, mergedEntry);
  bar[hit] = Array.from(next.values())
    .sort((a, b) => a.step - b.step)
    .map(serializeHitEntry);
  return bar[hit];
}
