import test from "node:test";
import assert from "node:assert/strict";

import {
  notesForTrack,
  optionsWithPianoRollNote,
  optionsWithoutPianoRollNote,
  pitchWheelDelta
} from "../src/ui/piano-roll/piano-roll-lanes.js";

test("piano roll lanes ignore unflagged grid seed hits", () => {
  const state = {
    config: {
      patterns: {
        jazz: {
          bars: [
            {
              bass: [
                [0, 0.72],
                [4, 0.5, { pitch: 7 }],
                [8, 0.66, { pitch: 12, pianoRoll: 1 }]
              ]
            }
          ]
        }
      }
    }
  };

  const notes = notesForTrack({
    state,
    trackId: "bass",
    renderedSegmentCount: 1,
    normalizeStepPosition: (step) => step,
    baseStepsPerBar: 16
  });

  assert.equal(notes.length, 1);
  assert.equal(notes[0].step, 8);
  assert.equal(notes[0].pitch, 12);
});

test("piano roll lanes read notes from the visible bar window", () => {
  const state = {
    config: {
      patterns: {
        jazz: {
          bars: [
            {},
            {},
            { bass: [[0, 0.4, { pitch: 3, pianoRoll: 1 }]] },
            { bass: [[4, 0.5, { pitch: 7, pianoRoll: 1 }]] }
          ]
        }
      }
    }
  };

  const notes = notesForTrack({
    state,
    trackId: "bass",
    renderedSegmentCount: 2,
    viewStartBar: 2,
    normalizeStepPosition: (step) => step,
    baseStepsPerBar: 16
  });

  assert.equal(notes.length, 2);
  assert.equal(notes[0].bar, 2);
  assert.equal(notes[0].viewBar, 0);
  assert.equal(notes[1].bar, 3);
  assert.equal(notes[1].viewBar, 1);
});

test("piano roll lanes include live MIDI notes in the visible window", () => {
  const state = {
    livePianoRollNotes: [{
      id: "computer:a",
      track: "bass",
      bar: 2,
      step: 5,
      pitch: 10,
      velocity: 0.6,
      options: { pitch: 10, pianoRoll: 1 }
    }],
    config: {
      patterns: {
        jazz: {
          bars: [{}, {}, {}, {}]
        }
      }
    }
  };

  const notes = notesForTrack({
    state,
    trackId: "bass",
    renderedSegmentCount: 2,
    viewStartBar: 2,
    normalizeStepPosition: (step) => step,
    baseStepsPerBar: 16
  });

  assert.equal(notes.length, 1);
  assert.equal(notes[0].live, true);
  assert.equal(notes[0].bar, 2);
  assert.equal(notes[0].viewBar, 0);
  assert.equal(notes[0].pitch, 10);
});

test("piano roll note edits remove only the selected chord note", () => {
  const options = { pitch: 0, chordIntervals: [0, 24], pianoRoll: 1, durationSteps: 2 };
  const next = optionsWithoutPianoRollNote({
    options,
    rootPitch: 0,
    interval: 0
  });

  assert.equal(next.pitch, 24);
  assert.deepEqual(next.chordIntervals, [0]);
  assert.equal(next.durationSteps, 2);
});

test("piano roll note edits merge a moved note without moving the remaining chord note", () => {
  const remaining = { pitch: 24, chordIntervals: [0], pianoRoll: 1, durationSteps: 2 };
  const next = optionsWithPianoRollNote(remaining, 1, { ...remaining, durationSteps: 2 });

  assert.equal(next.pitch, 1);
  assert.deepEqual(next.chordIntervals, [0, 23]);
  assert.equal(next.durationSteps, 2);
});

test("piano roll wheel scrolling accumulates small trackpad deltas", () => {
  const first = pitchWheelDelta({ deltaY: 8 }, 0);
  assert.equal(first.rows, 0);
  assert.equal(first.carry, 8);

  const second = pitchWheelDelta({ deltaY: 48 }, first.carry);
  assert.equal(second.rows, -1);
  assert.equal(second.carry, 0);
});

test("piano roll wheel scrolling limits large trackpad deltas to one row", () => {
  const delta = pitchWheelDelta({ deltaY: 280 }, 0);
  assert.equal(delta.rows, -1);
  assert.equal(delta.carry, 224);
});

test("piano roll shift-wheel still pages by an octave", () => {
  const delta = pitchWheelDelta({ deltaY: -1, shiftKey: true }, 12);
  assert.equal(delta.rows, 12);
  assert.equal(delta.carry, 0);
});
