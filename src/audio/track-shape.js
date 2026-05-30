// Pure data model for the per-track 808 "shape" (drive, punch, decay, tone,
// sub, choke). Each field either carries a per-track override or inherits the
// global 808 default from the mix-panel knobs. These helpers resolve, format,
// and write shape values against a plain config object with no DOM or editor
// state, so the inspector can wrap them with its own render side effects.

const clampNumber = (value, min, max, fallback = 0) => {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
};

// Maps each shape field to its global default config knob, the display label,
// and slider attributes.
export const TRACK_SHAPE_FIELDS = [
  { key: "drive", label: "Drive", globalKey: "eightOhEightDrive", min: 0, max: 1, step: 0.01 },
  { key: "punch", label: "Punch", globalKey: "eightOhEightPunch", min: 0, max: 1, step: 0.01 },
  { key: "decay", label: "Decay", globalKey: "eightOhEightDecay", min: 0.3, max: 2.5, step: 0.01 },
  { key: "tone", label: "Tone", globalKey: "eightOhEightTone", min: 0, max: 1, step: 0.01 },
  { key: "sub", label: "Sub", globalKey: "eightOhEightSub", min: 0, max: 1, step: 0.01 },
  { key: "choke", label: "Choke", globalKey: "eightOhEightChoke", min: 0, max: 1, step: 1 }
];

const SHAPE_FALLBACKS = { drive: 0.18, punch: 0.35, decay: 1, tone: 0.5, sub: 0.45, choke: 0 };

/** Global default for a shape field, read from the mix-panel 808 knobs. */
export function globalShapeValue(config, field) {
  const raw = config?.[field.globalKey];
  const fallback = SHAPE_FALLBACKS[field.key];
  const value = Number.isFinite(Number(raw)) ? Number(raw) : fallback;
  return field.key === "choke" ? (value >= 0.5 ? 1 : 0) : value;
}

/** Resolve a field's effective value + whether it's a per-track override. */
export function resolvedShapeValue(config, hit, field) {
  const override = config?.trackShapes?.[hit];
  if (override && override[field.key] !== undefined && override[field.key] !== null) {
    return { value: Number(override[field.key]), overridden: true };
  }
  return { value: globalShapeValue(config, field), overridden: false };
}

/** Format a shape value for display (choke is a boolean toggle). */
export function formatShapeValue(field, value) {
  if (field.key === "choke") return value >= 0.5 ? "on" : "off";
  return Number(value).toFixed(2);
}

/**
 * Write a single per-track shape field into a config object (immutably swapping
 * the `trackShapes` map). Returns true when the write happened, false for an
 * unknown field or missing track id.
 */
export function setTrackShapeField(config, hit, key, value) {
  if (!hit) return false;
  const field = TRACK_SHAPE_FIELDS.find((f) => f.key === key);
  if (!field) return false;
  const next = { ...(config.trackShapes || {}) };
  const current = { ...(next[hit] || {}) };
  current[key] = field.key === "choke"
    ? (Number(value) >= 0.5 ? 1 : 0)
    : clampNumber(value, field.min, field.max, globalShapeValue(config, field));
  next[hit] = current;
  config.trackShapes = next;
  return true;
}

/**
 * Remove all per-track shape overrides for a track (revert to global). Returns
 * true when an override existed and was cleared.
 */
export function clearTrackShape(config, hit) {
  if (!hit || !config.trackShapes?.[hit]) return false;
  const next = { ...config.trackShapes };
  delete next[hit];
  config.trackShapes = next;
  return true;
}
