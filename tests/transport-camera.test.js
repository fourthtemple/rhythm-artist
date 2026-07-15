// Unit tests for camera-mode playback window anchoring. `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import {
  cameraAnchorForBar,
  cameraFollowScrollLeftForStart,
  cameraPageFollowStartForPosition,
  cameraViewStartForPosition,
  clearRestartBarSelectionState,
  queuedBeatForDisplay
} from "../src/ui/transport.js";
import {
  selectedBarsCameraSpanRange
} from "../src/ui/grid/step-grid-builder.js";

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

test("selectedBarsCameraSpanRange maps selected bars into one ruler range", () => {
  assert.deepEqual(selectedBarsCameraSpanRange([0], 0, 8, 16), {
    source: "bar",
    startBar: 0,
    startStep: 0,
    startStepAbs: 0,
    endStepAbs: 16,
    lengthSteps: 16
  });
  assert.deepEqual(selectedBarsCameraSpanRange([5, 6, 7], 4, 8, 16), {
    source: "bar",
    startBar: 1,
    startStep: 0,
    startStepAbs: 16,
    endStepAbs: 64,
    lengthSteps: 48
  });
  assert.equal(selectedBarsCameraSpanRange([12], 0, 8, 16), null);
});

test("queuedBeatForDisplay holds the first future beat instead of jumping ahead", () => {
  const first = { phraseBar: 0, step: 0, scheduledTime: 10.08, stepDuration: 0.125 };
  const second = { phraseBar: 0, step: 1, scheduledTime: 10.205, stepDuration: 0.125 };
  const beforeStart = queuedBeatForDisplay([first, second], null, 10.02);
  assert.equal(beforeStart.beat, first);
  assert.equal(beforeStart.previousBeat, null);
  assert.equal(beforeStart.dropCount, 0);

  const afterFirst = queuedBeatForDisplay([first, second], null, 10.09);
  assert.equal(afterFirst.beat, first);
  assert.equal(afterFirst.previousBeat, first);
  assert.equal(afterFirst.dropCount, 0);

  const betweenBeats = queuedBeatForDisplay([second], first, 10.14);
  assert.equal(betweenBeats.beat, first);
  assert.equal(betweenBeats.previousBeat, first);
  assert.equal(betweenBeats.dropCount, 0);
});
