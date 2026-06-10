// Unit tests for the pure loop-region geometry helpers. `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import {
  clampRegionBar,
  clampRegionLen,
  clampRegionChops,
  clampRegionGain,
  normalizeRegion,
  regionAtBar,
  pixelsToBars,
  regionPercent
} from "../src/ui/wave-edit/loop-region.js";

test("clampRegionBar keeps the region inside the song", () => {
  assert.equal(clampRegionBar(10, 2, 8), 6);
  assert.equal(clampRegionBar(-1, 2, 8), 0);
});

test("clampRegionLen keeps bar+len inside the song", () => {
  assert.equal(clampRegionLen(99, 6, 8), 2);
  assert.equal(clampRegionLen(0, 0, 8), 1 / 64);
  assert.equal(clampRegionLen(0.5, 0, 8), 0.5);
});

test("clampRegionChops/Gain clamp to their ranges", () => {
  assert.equal(clampRegionChops(99), 32);
  assert.equal(clampRegionChops(0), 1);
  assert.equal(clampRegionGain(5), 2);
  assert.equal(clampRegionGain(-1), 0);
});

test("normalizeRegion produces a clean clamped object", () => {
  const r = normalizeRegion({ bar: -3, len: 99, gain: 5, chops: 99 }, 8);
  assert.equal(r.bar, 0);
  assert.equal(r.len, 8);
  assert.equal(r.gain, 2);
  assert.equal(r.chops, 32);
});

test("normalizeRegion preserves fractional bar selections", () => {
  const r = normalizeRegion({ bar: 1.25, len: 0.5, gain: 1, chops: 4 }, 8);
  assert.equal(r.bar, 1.25);
  assert.equal(r.len, 0.5);
});

test("regionAtBar sizes to the source loop length", () => {
  const r = regionAtBar(2, 4, 8);
  assert.equal(r.bar, 2);
  assert.equal(r.len, 4);
});

test("pixelsToBars returns a fractional bar delta", () => {
  assert.equal(pixelsToBars(45, 20), 2.25);
  assert.equal(pixelsToBars(5, 20), 0.25);
});

test("regionPercent maps to timeline percentages", () => {
  const { left, width } = regionPercent({ bar: 2, len: 2 }, 8);
  assert.equal(left, 25);
  assert.equal(width, 25);
});
