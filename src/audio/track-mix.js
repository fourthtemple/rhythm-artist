// Pure getters/setters for per-track mix values (level, pan, bus/delay send,
// reverb send). Each value lives in a config map keyed by track id. These
// helpers clamp to the legal range and return/produce plain values without any
// knowledge of editor state or the audio engine, so the editor can wrap them
// with its own `applyConfig()` side effects.

const clampNumber = (value, min, max, fallback = 0) => {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
};

/** Range + default metadata for each per-track mix parameter. */
export const TRACK_MIX_PARAMS = {
  level: { map: "trackLevels", min: 0, max: 2, fallback: 1 },
  pan: { map: "trackPans", min: -1, max: 1, fallback: 0 },
  busSend: { map: "trackBusSends", min: 0, max: 1, fallback: 0 },
  reverbSend: { map: "trackReverbSends", min: 0, max: 1, fallback: 0 }
};

/** Read a clamped per-track mix value from a config object. */
export function getTrackMix(config, param, hit) {
  const spec = TRACK_MIX_PARAMS[param];
  if (!spec || !hit) return spec ? spec.fallback : 0;
  return clampNumber(config?.[spec.map]?.[hit], spec.min, spec.max, spec.fallback);
}

/**
 * Write a clamped per-track mix value into a config object, replacing the map
 * immutably so callers can detect the change. Returns the clamped value, or
 * `null` when the write was a no-op (missing param or hit).
 */
export function setTrackMix(config, param, hit, value) {
  const spec = TRACK_MIX_PARAMS[param];
  if (!spec || !hit) return null;
  const next = clampNumber(value, spec.min, spec.max, spec.fallback);
  config[spec.map] = { ...(config[spec.map] || {}), [hit]: next };
  return next;
}
