import test from "node:test";
import assert from "node:assert/strict";

import {
  PITCH_OFFSET_MAX,
  PITCH_OFFSET_MIN,
  SYNTH_SCALE,
  clamp,
  normalizeStepOptions
} from "../src/audio/rhythm-config.js";
import { A1_MIDI_NOTE } from "../src/ui/music-format.js";
import { createNoteInspector } from "../src/ui/note-inspector.js";

function makeInspector(overrides = {}) {
  const calls = [];
  const state = {
    activeBar: 0,
    playheadStep: 0,
    selected: { hit: "pluck", step: 4, bar: 0 },
    selectedTracks: [],
    engine: {
      auditionPitchedTrack: async (...args) => {
        calls.push(args);
      }
    },
    ...overrides.state
  };
  const hitData = overrides.hitData || {
    velocity: 0.44,
    options: normalizeStepOptions({
      attackMs: 18,
      chordIntervals: [0, 7],
      dubEcho: 0.25,
      reverbSend: 0.31
    })
  };
  const inspector = createNoteInspector({
    state,
    setStatus: () => {},
    runningFromFile: false,
    stepGrid: { querySelector: () => null },
    selectedPiano: null,
    selectedPitch: {},
    selectedPitchNumber: {},
    selectedPitchValue: {},
    selectedVelocity: {},
    selectedVelocityNumber: {},
    selectedVelocityValue: {},
    selectedDubEcho: {},
    selectedDubEchoNumber: {},
    selectedDubEchoValue: {},
    selectedOptionControls: {},
    PITCH_SLIDER_MIN: PITCH_OFFSET_MIN,
    PITCH_SLIDER_MAX: PITCH_OFFSET_MAX,
    SYNTH_SCALE,
    A1_MIDI_NOTE,
    BLACK_NOTE_PITCH_CLASSES: new Set([1, 3, 6, 8, 10]),
    STEP_OPTION_DEFAULTS: {},
    clamp,
    normalizeStepOptions,
    normalizeHitEntry: (entry) => ({ step: entry?.[0] ?? 0, velocity: entry?.[1] ?? 0, options: entry?.[2] || {} }),
    sequencedBassPitchForStep: () => 0,
    scaleSemitoneForIndex: (index, scale) => scale[index] || 0,
    formatPitch: (pitch) => String(pitch),
    noteNameForPitch: (pitch) => `P${pitch}`,
    displayedPitchValueFor: (value) => Number(value) || 0,
    storedPitchValueFor: (value) => Number(value) || 0,
    setPairedControl: () => {},
    getHitData: () => hitData,
    setHitData: () => {},
    setHitVelocity: () => {},
    selectStep: () => {},
    renderStepGrid: () => {},
    activeLoopLength: () => 1,
    clampLoopStart: () => 0,
    defaultNoteState: () => ({ instrument: "eightOhEightKick", velocity: 0.32, options: normalizeStepOptions() }),
    setDefaultNoteVelocity: () => {},
    setDefaultNoteOption: () => {},
    trackName: (track) => track,
    onPitchFocus: () => {}
  });
  return { inspector, calls, state };
}

test("piano preview auditions the selected instrument track", async () => {
  const { inspector, calls } = makeInspector();

  await inspector.previewPianoPitch(12);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "pluck");
  assert.equal(calls[0][1], 12);
  assert.equal(calls[0][2].gain, 0.44);
  assert.deepEqual(calls[0][2].chordIntervals, [0, 7]);
  assert.equal(calls[0][2].step, 4);
  assert.equal(calls[0][2].phraseBar, 0);
  assert.equal(calls[0][2].optionsRaw.attackMs, 18);
  assert.equal(calls[0][2].optionsRaw.dubEcho, 0.25);
});

test("piano preview falls back to the default instrument when no note is selected", async () => {
  const { inspector, calls } = makeInspector({
    state: {
      selected: null,
      selectedTracks: []
    }
  });

  await inspector.previewPianoPitch(5);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "eightOhEightKick");
  assert.equal(calls[0][2].gain, 0.32);
});
