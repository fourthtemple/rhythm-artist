import test from "node:test";
import assert from "node:assert/strict";

import { notesForTrack } from "../src/ui/piano-roll/piano-roll-lanes.js";

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
