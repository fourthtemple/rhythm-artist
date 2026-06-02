// Unit tests for loop-track editing math. `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import { cutRegionsToSelection, makeUnscaledRevealRegion, regionSourceSlice } from "../src/ui/loop-track-panel.js";

const closeTo = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be close to ${expected}`);
};

test("cutRegionsToSelection keeps a fractional marquee in place", () => {
  const track = {
    barsInFile: 2,
    regions: [{ bar: 0, len: 2, gain: 1, chops: 4, sliceSensitivity: 0.12, mode: "cut" }]
  };

  const [kept] = cutRegionsToSelection(track, 0.42, 0.71);

  closeTo(kept.bar, 0.42);
  closeTo(kept.len, 0.71);
  closeTo(kept.srcStartFrac, 0.21);
  closeTo(kept.srcEndFrac, 0.565);
});

test("cutRegionsToSelection maps cuts within an already-cut source window", () => {
  const track = {
    barsInFile: 4,
    regions: [{
      bar: 1,
      len: 1,
      gain: 1,
      chops: 4,
      sliceSensitivity: 0.12,
      mode: "cut",
      srcStartFrac: 0.25,
      srcEndFrac: 0.5
    }]
  };

  const [kept] = cutRegionsToSelection(track, 1.25, 0.5);

  closeTo(kept.bar, 1.25);
  closeTo(kept.len, 0.5);
  closeTo(kept.srcStartFrac, 0.3125);
  closeTo(kept.srcEndFrac, 0.4375);
});

test("regionSourceSlice draws cut mode by natural playback seconds", () => {
  const duration = 716.6787291666667;
  const barDuration = (60 / 118) * 4;
  const track = {
    barsInFile: 4,
    regions: [{ bar: 0, len: 32, gain: 1, chops: 4, sliceSensitivity: 0.12, mode: "cut" }]
  };

  const slice = regionSourceSlice(track.regions[0], track, 2, 4, duration, barDuration);

  closeTo(slice.startFrac, (2 * barDuration) / duration);
  closeTo(slice.endFrac, (4 * barDuration) / duration);
});

test("cutRegionsToSelection preserves the natural-time source under the marquee", () => {
  const duration = 716.6787291666667;
  const barDuration = (60 / 118) * 4;
  const track = {
    barsInFile: 4,
    regions: [{ bar: 0, len: 32, gain: 1, chops: 4, sliceSensitivity: 0.12, mode: "cut" }]
  };

  const [kept] = cutRegionsToSelection(track, 2.25, 0.5, duration, barDuration);

  closeTo(kept.bar, 2.25);
  closeTo(kept.len, 0.5);
  closeTo(kept.srcStartFrac, (2.25 * barDuration) / duration);
  closeTo(kept.srcEndFrac, (2.75 * barDuration) / duration);
});

test("makeUnscaledRevealRegion creates only the newly exposed natural-speed audio", () => {
  const duration = 100;
  const barDuration = 2;
  const scaled = {
    bar: 8,
    len: 4,
    gain: 1,
    chops: 4,
    sliceSensitivity: 0.12,
    mode: "stretch",
    srcStartFrac: 0.4,
    srcEndFrac: 0.5
  };

  const left = makeUnscaledRevealRegion(scaled, "left", 1, duration, barDuration);
  const right = makeUnscaledRevealRegion(scaled, "right", 1.5, duration, barDuration);

  assert.equal(left.mode, "cut");
  assert.equal(left.revealPreview, true);
  closeTo(left.bar, 7);
  closeTo(left.len, 1);
  closeTo(left.srcStartFrac, 0.38);
  closeTo(left.srcEndFrac, 0.4);

  assert.equal(right.mode, "cut");
  assert.equal(right.revealPreview, true);
  closeTo(right.bar, 12);
  closeTo(right.len, 1.5);
  closeTo(right.srcStartFrac, 0.5);
  closeTo(right.srcEndFrac, 0.53);

  closeTo(scaled.bar, 8);
  closeTo(scaled.len, 4);
  assert.equal(scaled.mode, "stretch");
  closeTo(scaled.srcStartFrac, 0.4);
  closeTo(scaled.srcEndFrac, 0.5);
});
