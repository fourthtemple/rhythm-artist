// Unit tests for the pure per-track mix getters/setters. `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import { getTrackMix, setTrackMix, TRACK_MIX_PARAMS } from "../src/audio/track-mix.js";

test("getTrackMix returns the fallback for a missing value", () => {
  assert.equal(getTrackMix({}, "level", "kick"), 1);
  assert.equal(getTrackMix({}, "pan", "kick"), 0);
});

test("getTrackMix clamps stored values into range", () => {
  const config = { trackLevels: { kick: 9 }, trackPans: { kick: -9 } };
  assert.equal(getTrackMix(config, "level", "kick"), 2);
  assert.equal(getTrackMix(config, "pan", "kick"), -1);
});

test("getTrackMix is safe for an unknown param", () => {
  assert.equal(getTrackMix({}, "nope", "kick"), 0);
});

test("setTrackMix writes a clamped value into the right map", () => {
  const config = {};
  const result = setTrackMix(config, "level", "kick", 5);
  assert.equal(result, 2);
  assert.equal(config.trackLevels.kick, 2);
});

test("setTrackMix replaces the map immutably", () => {
  const before = { snare: 0.5 };
  const config = { trackLevels: before };
  setTrackMix(config, "level", "kick", 1);
  assert.notEqual(config.trackLevels, before);
  assert.equal(config.trackLevels.snare, 0.5);
});

test("setTrackMix is a no-op for a missing param or hit", () => {
  assert.equal(setTrackMix({}, "nope", "kick", 1), null);
  assert.equal(setTrackMix({}, "level", "", 1), null);
});

test("every mix param exposes a map and range", () => {
  for (const spec of Object.values(TRACK_MIX_PARAMS)) {
    assert.equal(typeof spec.map, "string");
    assert.ok(spec.max > spec.min);
  }
});
