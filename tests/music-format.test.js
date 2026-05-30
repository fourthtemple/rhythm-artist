// Unit tests for the pure music/pitch/pan formatting helpers. `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import {
  formatPitch,
  noteNameForPitch,
  isBlackPitch,
  scaleSemitoneForIndex,
  formatPan,
  displayedPitch,
  storedPitch
} from "../src/ui/music-format.js";

test("formatPitch signs the offset", () => {
  assert.equal(formatPitch(3), "+3");
  assert.equal(formatPitch(-2), "-2");
  assert.equal(formatPitch(0), "0");
});

test("noteNameForPitch maps offset 0 to A1", () => {
  assert.equal(noteNameForPitch(0), "A1");
});

test("isBlackPitch flags black keys", () => {
  assert.equal(isBlackPitch(1), true); // A#1
  assert.equal(isBlackPitch(0), false); // A1
});

test("scaleSemitoneForIndex wraps and octave-shifts", () => {
  const scale = [0, 2, 4, 5, 7, 9, 11];
  assert.equal(scaleSemitoneForIndex(0, scale), 0);
  assert.equal(scaleSemitoneForIndex(7, scale), 12);
});

test("formatPan labels left/center/right", () => {
  assert.equal(formatPan(0), "C");
  assert.equal(formatPan(-0.5), "L50");
  assert.equal(formatPan(0.5), "R50");
});

test("displayedPitch/storedPitch round-trip for pitched and unpitched", () => {
  // Unpitched track: stored offset is shown verbatim.
  assert.equal(displayedPitch(4, null), 4);
  assert.equal(storedPitch(4, null), 4);
  // Pitched track (base 7): displayed is absolute, stored is the trim.
  assert.equal(displayedPitch(2, 7), 9);
  assert.equal(storedPitch(9, 7), 2);
});
