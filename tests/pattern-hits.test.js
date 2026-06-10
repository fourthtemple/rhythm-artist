// Unit tests for the pure pattern-hit helpers, run with Node's built-in test
// runner: `node --test`. No external dependencies.
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHitEntry,
  hasStepOptions,
  serializeHitEntry,
  buildHitMap,
  readStoredHit,
  commitHitEntry
} from "../src/audio/pattern-hits.js";

test("normalizeHitEntry accepts the compact tuple form", () => {
  const entry = normalizeHitEntry([3, 0.5]);
  assert.equal(entry.step, 3);
  assert.equal(entry.velocity, 0.5);
  assert.equal(typeof entry.options, "object");
});

test("normalizeHitEntry clamps step and velocity into range", () => {
  const entry = normalizeHitEntry([99, 5]);
  assert.equal(entry.step, 15);
  assert.equal(entry.velocity, 1);
});

test("normalizeHitEntry preserves fractional dense-grid steps", () => {
  const entry = normalizeHitEntry([3.5, 0.5]);
  assert.equal(entry.step, 3.5);
  assert.deepEqual(serializeHitEntry(entry), [3.5, 0.5]);
});

test("normalizeHitEntry coerces junk to a silent step", () => {
  const entry = normalizeHitEntry(null);
  assert.equal(entry.step, 0);
  assert.equal(entry.velocity, 0);
});

test("hasStepOptions is false for defaults and true for a change", () => {
  const base = normalizeHitEntry([0, 1]).options;
  assert.equal(hasStepOptions(base), false);
  assert.equal(hasStepOptions({ ...base, pitch: 4 }), true);
  assert.equal(hasStepOptions({ ...base, chordIntervals: [0, 4, 7] }), true);
});

test("serializeHitEntry drops default options but keeps real ones", () => {
  assert.deepEqual(serializeHitEntry([2, 0.5]), [2, 0.5]);
  const tuple = serializeHitEntry({ step: 2, velocity: 0.5, options: { pitch: 3 } });
  assert.equal(tuple.length, 3);
  assert.equal(tuple[2].pitch, 3);
});

test("normalizeHitEntry preserves polyphonic chord intervals", () => {
  const entry = normalizeHitEntry([2, 0.5, { chordIntervals: [0, 4, 7, 12] }]);
  assert.deepEqual(entry.options.chordIntervals, [0, 4, 7, 12]);
  const tuple = serializeHitEntry(entry);
  assert.deepEqual(tuple[2].chordIntervals, [0, 4, 7, 12]);
});

test("normalizeHitEntry preserves MIDI pressure", () => {
  const entry = normalizeHitEntry([2, 0.5, { pressure: 0.74 }]);
  assert.equal(entry.options.pressure, 0.74);
  const tuple = serializeHitEntry(entry);
  assert.equal(tuple[2].pressure, 0.74);
});

test("normalizeHitEntry preserves piano roll note ownership", () => {
  const entry = normalizeHitEntry([2, 0.5, { pitch: 7, pianoRoll: 1 }]);
  assert.equal(entry.options.pitch, 7);
  assert.equal(entry.options.pianoRoll, 1);
  const tuple = serializeHitEntry(entry);
  assert.equal(tuple[2].pianoRoll, 1);
});

test("normalizeHitEntry preserves the full MIDI pitch offset range", () => {
  assert.equal(normalizeHitEntry([2, 0.5, { pitch: -99 }]).options.pitch, -33);
  assert.equal(normalizeHitEntry([2, 0.5, { pitch: 120 }]).options.pitch, 94);
});

test("buildHitMap keys entries by step", () => {
  const bar = { kick: [[0, 1], [4, 0.6]] };
  const map = buildHitMap(bar, "kick");
  assert.equal(map.size, 2);
  assert.equal(map.get(4).velocity, 0.6);
});

test("buildHitMap returns an empty map for a missing row", () => {
  assert.equal(buildHitMap({}, "snare").size, 0);
});

test("readStoredHit returns null when the step is empty", () => {
  const bar = { kick: [[0, 1]] };
  assert.equal(readStoredHit(bar, "kick", 7), null);
  assert.equal(readStoredHit(bar, "kick", 0).velocity, 1);
});

test("commitHitEntry inserts, sorts, and serializes a row", () => {
  const bar = { kick: [[4, 0.5]] };
  commitHitEntry(bar, "kick", 0, { step: 0, velocity: 1, options: normalizeHitEntry([0, 1]).options });
  assert.deepEqual(bar.kick.map((t) => t[0]), [0, 4]);
});

test("commitHitEntry removes a step when passed a null/silent entry", () => {
  const bar = { kick: [[0, 1], [4, 0.5]] };
  commitHitEntry(bar, "kick", 4, null);
  assert.deepEqual(bar.kick.map((t) => t[0]), [0]);
});
