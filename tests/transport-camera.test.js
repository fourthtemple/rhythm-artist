// Unit tests for camera-mode playback window anchoring. `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import {
  cameraAnchorForBar,
  cameraFollowScrollLeftForStart,
  cameraPageFollowStartForPosition,
  cameraViewStartForPosition,
  clearRestartBarSelectionState
} from "../src/ui/transport.js";

test("cameraAnchorForBar centers the phrase bar when possible", () => {
  assert.equal(cameraAnchorForBar(10, 4, 32), 8);
  assert.equal(cameraAnchorForBar(10, 3, 32), 8);
});

test("cameraAnchorForBar clamps at song edges", () => {
  assert.equal(cameraAnchorForBar(0, 4, 32), 0);
  assert.equal(cameraAnchorForBar(31, 4, 32), 28);
});

test("cameraAnchorForBar respects the active loop range", () => {
  assert.equal(cameraAnchorForBar(14, 4, 32, 8, 8), 12);
  assert.equal(cameraAnchorForBar(20, 4, 32, 8, 8), null);
});

test("cameraAnchorForBar keeps end loops inside the song", () => {
  assert.equal(cameraAnchorForBar(31, 8, 32, 30, 2), 24);
});

test("cameraViewStartForPosition preserves fractional camera movement", () => {
  assert.equal(cameraViewStartForPosition(10.5, 4, 32), 8.5);
  assert.equal(cameraViewStartForPosition(10, 3, 32), 8.5);
  assert.equal(cameraAnchorForBar(10.5, 4, 32), 8);
});

test("cameraPageFollowStartForPosition waits until the last visible bar", () => {
  assert.equal(cameraPageFollowStartForPosition(0.5, 0, 2, 32), null);
  assert.equal(cameraPageFollowStartForPosition(1, 0, 2, 32), 1);
  assert.equal(cameraPageFollowStartForPosition(1.75, 0, 2, 32), 1);
});

test("cameraPageFollowStartForPosition treats a mostly visible final bar as visible", () => {
  assert.equal(cameraPageFollowStartForPosition(6.75, 4, 7.35, 32), null);
  assert.equal(cameraPageFollowStartForPosition(7, 4, 7.35, 32), 7);
});

test("cameraPageFollowStartForPosition recovers when playback is before the view", () => {
  assert.equal(cameraPageFollowStartForPosition(3, 8, 10, 32), 3);
});

test("cameraFollowScrollLeftForStart reaches the final scrollable bar", () => {
  assert.equal(cameraFollowScrollLeftForStart(29, 100, 3000, 35), 2865);
  assert.equal(cameraFollowScrollLeftForStart(30, 100, 3000, 35), 3000);
  assert.equal(cameraFollowScrollLeftForStart(31, 100, 3000, 35), 3000);
});

test("clearRestartBarSelectionState clears bar and beat selections only", () => {
  const state = {
    selectedBars: [4, 5],
    barAnchor: 4,
    cameraBeatSelection: { startStepAbs: 64, endStepAbs: 80, lengthSteps: 16 },
    selected: { hit: "bass", step: 0, bar: 4 }
  };
  assert.equal(clearRestartBarSelectionState(state), true);
  assert.deepEqual(state.selectedBars, []);
  assert.equal(state.barAnchor, null);
  assert.equal(state.cameraBeatSelection, null);
  assert.deepEqual(state.selected, { hit: "bass", step: 0, bar: 4 });
  assert.equal(clearRestartBarSelectionState(state), false);
});
