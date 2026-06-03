import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRhythmConfig,
  normalizeTrackStepCount
} from "../src/audio/rhythm-config.js";

test("normalizeTrackStepCount allows arbitrary integer grid densities", () => {
  assert.equal(normalizeTrackStepCount(7), 7);
  assert.equal(normalizeTrackStepCount(13), 13);
  assert.equal(normalizeTrackStepCount(20.8), 21);
});

test("normalizeTrackStepCount clamps unusable extremes", () => {
  assert.equal(normalizeTrackStepCount(0), 1);
  assert.equal(normalizeTrackStepCount(-12), 1);
  assert.equal(normalizeTrackStepCount(999), 128);
});

test("normalizeRhythmConfig preserves nonstandard per-track step counts", () => {
  const config = normalizeRhythmConfig({
    trackStepCounts: {
      kick: 7,
      snare: 13,
      hat: 16
    }
  });
  assert.equal(config.trackStepCounts.kick, 7);
  assert.equal(config.trackStepCounts.snare, 13);
  assert.equal(config.trackStepCounts.hat, undefined);
});
