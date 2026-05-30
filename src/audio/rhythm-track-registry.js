/**
 * rhythm-track-registry.js
 *
 * Single source of truth for every track and track-group in the sequencer.
 *
 * Before the registry, track ids/labels/sends/velocities lived in scattered
 * hardcoded lists across `rhythm-config.js`, `rhythm-engine.js` and
 * `rhythm-sequence-editor.js`. Adding a track meant editing all three and
 * keeping them in sync by hand. Now everything is derived from
 * `TRACK_REGISTRY` + `TRACK_GROUPS` below, so the grid, the Add-Track dialog,
 * the engine routing, and save/load all read from one place.
 *
 * Each registry entry:
 *   id            unique key used in patterns + config (e.g. "eightOhEightKick")
 *   label         display name shown in the grid + dialogs
 *   group         id of a TRACK_GROUPS entry this track belongs to
 *   kind          "pattern"  -> a sampled/synth drum or bass voice always shown
 *                 "generated"-> a synth/808 voice (was the "Generated Parts")
 *   voice         which engine voice plays it (see RhythmEngine.playTrackVoice)
 *   defaultVelocity  velocity used when a step is first toggled on
 *   busSend       default delay/echo send (0..1)
 *   reverbSend    default reverb send (0..1)
 *   level         default per-track output level / gain trim (0..2, 1 = unity)
 *   pan           default per-track stereo pan (-1 = left .. 1 = right)
 *   removable     can the user remove it from the grid (false for core kit)
 *   addByDefault  is it in the grid on a fresh project
 */

export const TRACK_GROUPS = [
  { id: "core", label: "Core Kit", accent: "#7dd3fc" },
  { id: "synth", label: "Synths", accent: "#c4b5fd" },
  { id: "eightOhEight", label: "808 Kit", accent: "#fca5a5" },
  { id: "fx", label: "FX & Space", accent: "#86efac" }
];

export const TRACK_REGISTRY = [
  // ── Core kit (always present, sampled / bass) ───────────────
  { id: "bass", label: "Bass", group: "core", kind: "pattern", voice: "bass", defaultVelocity: 0.68, busSend: 0.28, reverbSend: 0.16, removable: false, addByDefault: true },
  { id: "kick", label: "Kick", group: "core", kind: "pattern", voice: "sample", sample: "kick", defaultVelocity: 0.46, busSend: 0.18, reverbSend: 0.08, removable: false, addByDefault: true },
  { id: "snare", label: "Snare", group: "core", kind: "pattern", voice: "sample", sample: "snare", defaultVelocity: 0.34, busSend: 0.34, reverbSend: 0.24, removable: false, addByDefault: true },
  { id: "hat", label: "Hat", group: "core", kind: "pattern", voice: "sample", sample: "hat", defaultVelocity: 0.16, busSend: 0.18, reverbSend: 0.14, removable: false, addByDefault: true },
  { id: "rim", label: "Rim", group: "core", kind: "pattern", voice: "sample", sample: "rim", defaultVelocity: 0.12, busSend: 0.4, reverbSend: 0.3, removable: false, addByDefault: true },

  // ── Synths (generated) ──────────────────────────────────────
  { id: "pluck", label: "Pluck", group: "synth", kind: "generated", voice: "pluck", defaultVelocity: 0.18, busSend: 0.45, reverbSend: 0.32, removable: true, addByDefault: true },
  { id: "funk", label: "Funk", group: "synth", kind: "generated", voice: "funk", defaultVelocity: 0.22, busSend: 0.38, reverbSend: 0.24, removable: true, addByDefault: true },
  { id: "pad", label: "Pad", group: "synth", kind: "generated", voice: "pad", defaultVelocity: 0.2, busSend: 0.62, reverbSend: 0.62, removable: true, addByDefault: true },
  { id: "whale", label: "LFO", group: "synth", kind: "generated", voice: "whale", defaultVelocity: 0.24, busSend: 0.58, reverbSend: 0.46, removable: true, addByDefault: true },

  // ── 808 kit (generated) ─────────────────────────────────────
  { id: "eightOhEightKick", label: "808 Kick", group: "eightOhEight", kind: "generated", voice: "eight808Kick", defaultVelocity: 0.32, busSend: 0.22, reverbSend: 0.08, removable: true, addByDefault: true },
  { id: "eightOhEightSnare", label: "808 Snare", group: "eightOhEight", kind: "generated", voice: "eight808Snare", defaultVelocity: 0.24, busSend: 0.2, reverbSend: 0.1, removable: true, addByDefault: true },
  { id: "eightOhEightHat", label: "808 Hat", group: "eightOhEight", kind: "generated", voice: "eight808Hat", defaultVelocity: 0.16, busSend: 0.12, reverbSend: 0.06, removable: true, addByDefault: true },
  { id: "eightOhEightClick", label: "808 Click", group: "eightOhEight", kind: "generated", voice: "eight808Click", defaultVelocity: 0.16, busSend: 0.18, reverbSend: 0.08, removable: true, addByDefault: true },
  // Extended 808 kit — available in the Add-Track dialog, off the grid by default.
  { id: "eightOhEightClap", label: "808 Clap", group: "eightOhEight", kind: "generated", voice: "eight808Clap", defaultVelocity: 0.26, busSend: 0.24, reverbSend: 0.18, removable: true, addByDefault: false },
  { id: "eightOhEightTomLow", label: "808 Tom Lo", group: "eightOhEight", kind: "generated", voice: "eight808TomLow", defaultVelocity: 0.3, busSend: 0.2, reverbSend: 0.16, removable: true, addByDefault: false },
  { id: "eightOhEightTomMid", label: "808 Tom Mid", group: "eightOhEight", kind: "generated", voice: "eight808TomMid", defaultVelocity: 0.3, busSend: 0.2, reverbSend: 0.16, removable: true, addByDefault: false },
  { id: "eightOhEightTomHigh", label: "808 Tom Hi", group: "eightOhEight", kind: "generated", voice: "eight808TomHigh", defaultVelocity: 0.3, busSend: 0.2, reverbSend: 0.16, removable: true, addByDefault: false },
  { id: "eightOhEightCowbell", label: "808 Cowbell", group: "eightOhEight", kind: "generated", voice: "eight808Cowbell", defaultVelocity: 0.24, busSend: 0.26, reverbSend: 0.12, removable: true, addByDefault: false },
  { id: "eightOhEightConga", label: "808 Conga", group: "eightOhEight", kind: "generated", voice: "eight808Conga", defaultVelocity: 0.28, busSend: 0.22, reverbSend: 0.16, removable: true, addByDefault: false },
  { id: "eightOhEightMaraca", label: "808 Maraca", group: "eightOhEight", kind: "generated", voice: "eight808Maraca", defaultVelocity: 0.18, busSend: 0.14, reverbSend: 0.08, removable: true, addByDefault: false },
  { id: "eightOhEightCymbal", label: "808 Cymbal", group: "eightOhEight", kind: "generated", voice: "eight808Cymbal", defaultVelocity: 0.2, busSend: 0.3, reverbSend: 0.4, removable: true, addByDefault: false },

  // ── FX & space (generated) ──────────────────────────────────
  { id: "echo", label: "Echo", group: "fx", kind: "generated", voice: "echo", defaultVelocity: 0.3, busSend: 1, reverbSend: 0.42, removable: true, addByDefault: true },
  { id: "space", label: "Space", group: "fx", kind: "generated", voice: "space", defaultVelocity: 0.4, busSend: 1, reverbSend: 1, removable: true, addByDefault: true }
];

// ── Lookups + derived lists ───────────────────────────────────

export const TRACK_BY_ID = Object.fromEntries(TRACK_REGISTRY.map((t) => [t.id, t]));
export const GROUP_BY_ID = Object.fromEntries(TRACK_GROUPS.map((g) => [g.id, g]));

export const getTrackDef = (id) => TRACK_BY_ID[id] || null;
export const getGroupDef = (id) => GROUP_BY_ID[id] || null;

/** Tracks shown on a fresh project, in registry order. */
export const DEFAULT_GRID_TRACK_IDS = TRACK_REGISTRY
  .filter((t) => t.addByDefault)
  .map((t) => t.id);

/** Every track id known to the engine (used for send tables). */
export const ALL_TRACK_IDS = TRACK_REGISTRY.map((t) => t.id);

/** Pattern (always-on, sampled/bass) track ids. */
export const PATTERN_TRACK_IDS = TRACK_REGISTRY
  .filter((t) => t.kind === "pattern")
  .map((t) => t.id);

/** Generated (synth/808/fx) track ids that ship on by default. */
export const GENERATED_TRACK_IDS = TRACK_REGISTRY
  .filter((t) => t.kind === "generated" && t.addByDefault)
  .map((t) => t.id);

/** 808-kit track ids that ship on by default. */
export const EIGHT_OH_EIGHT_DEFAULT_IDS = TRACK_REGISTRY
  .filter((t) => t.group === "eightOhEight" && t.addByDefault)
  .map((t) => t.id);

export const TRACK_LABELS = Object.fromEntries(TRACK_REGISTRY.map((t) => [t.id, t.label]));
export const TRACK_DEFAULT_VELOCITY = Object.fromEntries(TRACK_REGISTRY.map((t) => [t.id, t.defaultVelocity]));
export const TRACK_BUS_SENDS = Object.fromEntries(TRACK_REGISTRY.map((t) => [t.id, t.busSend]));
export const TRACK_REVERB_SENDS = Object.fromEntries(TRACK_REGISTRY.map((t) => [t.id, t.reverbSend]));

/** Per-track output level (gain trim). Unity = 1; defaults to 1 unless set. */
export const TRACK_LEVELS = Object.fromEntries(TRACK_REGISTRY.map((t) => [t.id, t.level ?? 1]));

/** Per-track stereo pan (-1 left .. 1 right). Defaults to centre (0). */
export const TRACK_PANS = Object.fromEntries(TRACK_REGISTRY.map((t) => [t.id, t.pan ?? 0]));

/** Group the registry by group id, preserving TRACK_GROUPS order. */
export const tracksByGroup = (predicate = () => true) => TRACK_GROUPS.map((group) => ({
  group,
  tracks: TRACK_REGISTRY.filter((t) => t.group === group.id && predicate(t))
})).filter((entry) => entry.tracks.length > 0);
