// Unit tests for the pure per-track 808 "shape" data model. `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import {
  TRACK_SHAPE_FIELDS,
  globalShapeValue,
  resolvedShapeValue,
  formatShapeValue,
  setTrackShapeField,
  clearTrackShape
} from "../src/audio/track-shape.js";

const field = (key) => TRACK_SHAPE_FIELDS.find((f) => f.key === key);

test("globalShapeValue reads the mix-panel knob with a fallback", () => {
  assert.equal(globalShapeValue({ eightOhEightDrive: 0.4 }, field("drive")), 0.4);
  assert.equal(globalShapeValue({}, field("drive")), 0.18);
});

test("globalShapeValue treats choke as a boolean toggle", () => {
  assert.equal(globalShapeValue({ eightOhEightChoke: 0.7 }, field("choke")), 1);
  assert.equal(globalShapeValue({ eightOhEightChoke: 0.2 }, field("choke")), 0);
});

test("resolvedShapeValue prefers a per-track override", () => {
  const config = { trackShapes: { kick: { drive: 0.9 } } };
  const resolved = resolvedShapeValue(config, "kick", field("drive"));
  assert.equal(resolved.value, 0.9);
  assert.equal(resolved.overridden, true);
});

test("resolvedShapeValue falls back to the global when no override", () => {
  const resolved = resolvedShapeValue({}, "kick", field("drive"));
  assert.equal(resolved.value, 0.18);
  assert.equal(resolved.overridden, false);
});

test("formatShapeValue renders choke as on/off and others to 2dp", () => {
  assert.equal(formatShapeValue(field("choke"), 1), "on");
  assert.equal(formatShapeValue(field("choke"), 0), "off");
  assert.equal(formatShapeValue(field("drive"), 0.5), "0.50");
});

test("setTrackShapeField writes a clamped override immutably", () => {
  const config = {};
  assert.equal(setTrackShapeField(config, "kick", "drive", 9), true);
  assert.equal(config.trackShapes.kick.drive, 1); // clamped to max
});

test("setTrackShapeField rejects unknown fields/tracks", () => {
  assert.equal(setTrackShapeField({}, "kick", "nope", 1), false);
  assert.equal(setTrackShapeField({}, "", "drive", 1), false);
});

test("clearTrackShape removes overrides and reports whether it did", () => {
  const config = { trackShapes: { kick: { drive: 0.5 }, snare: { tone: 0.2 } } };
  assert.equal(clearTrackShape(config, "kick"), true);
  assert.equal(config.trackShapes.kick, undefined);
  assert.equal(config.trackShapes.snare.tone, 0.2);
  assert.equal(clearTrackShape(config, "kick"), false);
});
