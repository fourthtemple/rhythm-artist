import test from "node:test";
import assert from "node:assert/strict";

import {
  chordForComputerKey,
  computerOctaveDeltaForKey,
  computerOctaveFromKey,
  createFakeMidiKeyboard,
  pitchForComputerKey,
  resolvePerformanceTrack
} from "../src/ui/piano-roll/fake-midi-keyboard.js";

test("piano roll mode records to the open piano roll target instead of the selected grid row", () => {
  const target = resolvePerformanceTrack({
    trackEditorMode: "pianoRoll",
    selectedHit: "kick",
    pianoRollTargetTrack: "bass",
    openPianoRollTracks: ["bass"],
    gridTrackIds: ["kick", "bass"]
  });

  assert.equal(target, "bass");
});

test("piano roll mode does not fall back to grid-hit recording without an open piano roll", () => {
  const target = resolvePerformanceTrack({
    trackEditorMode: "pianoRoll",
    selectedHit: "kick",
    openPianoRollTracks: [],
    gridTrackIds: ["kick"]
  });

  assert.equal(target, null);
});

test("grid mode still uses the selected grid row as the performance target", () => {
  const target = resolvePerformanceTrack({
    trackEditorMode: "grid",
    selectedHit: "kick",
    pianoRollTargetTrack: "bass",
    openPianoRollTracks: ["bass"],
    gridTrackIds: ["kick", "bass"]
  });

  assert.equal(target, "kick");
});

test("computer number keys select octave slots 1 through 10", () => {
  assert.equal(computerOctaveFromKey("1"), 1);
  assert.equal(computerOctaveFromKey("9"), 9);
  assert.equal(computerOctaveFromKey("0"), 10);
});

test("arrow keys nudge the computer keyboard octave", () => {
  assert.equal(computerOctaveDeltaForKey("ArrowLeft"), -1);
  assert.equal(computerOctaveDeltaForKey("ArrowDown"), -1);
  assert.equal(computerOctaveDeltaForKey("ArrowRight"), 1);
  assert.equal(computerOctaveDeltaForKey("ArrowUp"), 1);
});

test("computer keyboard octave 4 preserves the old A-key C2 pitch", () => {
  assert.equal(pitchForComputerKey("a", 4), 3);
  assert.equal(pitchForComputerKey("k", 4), 15);
});

test("computer keyboard octave slots span the playable MIDI range", () => {
  assert.equal(pitchForComputerKey("a", 1), -33);
  assert.equal(pitchForComputerKey("k", 10), 87);
});

test("bottom row keys select computer keyboard chords", () => {
  assert.equal(chordForComputerKey("z")?.label, "1");
  assert.deepEqual(chordForComputerKey("x")?.intervals, [0, 4, 7]);
  assert.equal(chordForComputerKey("m")?.label, "5");
});

test("clearing a recording take removes only the recorded piano-roll notes", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };

  try {
    const state = {
      activeBar: 0,
      playheadStep: 3,
      selected: null,
      selectedTracks: [],
      trackEditorMode: "pianoRoll",
      pianoRollTargetTrack: "sampler~kick",
      gridTrackIds: ["sampler~kick"],
      intensity: 0.5,
      config: {
        generatedRowsEditable: 1,
        pianoRollTracks: ["sampler~kick"],
        patterns: {
          jazz: {
            bars: [{ "sampler~kick": [] }]
          }
        }
      }
    };
    const readStoredHit = (bar, hit, step) =>
      (bar?.[hit] || []).find((entry) => Number(entry.step) === Number(step)) || null;
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, pianoRoll: 0, ...options });
    const setHitData = (hit, step, patch, barIndex = state.activeBar) => {
      const bar = state.config.patterns.jazz.bars[barIndex];
      const current = readStoredHit(bar, hit, step);
      const next = {
        step,
        velocity: patch.velocity ?? current?.velocity ?? 0,
        options: normalizeStepOptions({ ...(current?.options || {}), ...(patch.options || {}) })
      };
      bar[hit] = (bar[hit] || []).filter((entry) => Number(entry.step) !== Number(step));
      if (next.velocity > 0.005) bar[hit].push(next);
    };
    let refreshCount = 0;
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit,
      setHitData,
      selectStep: () => {},
      refreshPianoRollLanes: () => { refreshCount += 1; },
      renderStepGrid: () => {},
      addGridTrack: () => {},
      renderTrackExplorer: () => {},
      renderSelectedPiano: () => {},
      PITCH_SLIDER_MIN: -48,
      PITCH_SLIDER_MAX: 87,
      BLACK_NOTE_PITCH_CLASSES: new Set(),
      A1_MIDI_NOTE: 33,
      noteNameForPitch: () => "A",
      formatPitch: (pitch) => String(pitch)
    });

    assert.equal(keyboard.setRecording(true, { announce: false }), true);
    keyboard.recordNote(7, { velocity: 0.5, track: "sampler~kick", chordIntervals: [0] });
    assert.equal(state.config.patterns.jazz.bars[0]["sampler~kick"].length, 1);
    assert.equal(state.config.patterns.jazz.bars[0]["sampler~kick"][0].options.pianoRoll, 1);
    assert.equal(refreshCount, 1);

    assert.equal(keyboard.clearRecordingTake({ announce: false }), true);
    assert.deepEqual(state.config.patterns.jazz.bars[0]["sampler~kick"], []);
    assert.equal(refreshCount, 2);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("recorded piano-roll notes repaint immediately when animation frames are available", () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  let rafCount = 0;
  globalThis.window = {
    requestAnimationFrame: () => {
      rafCount += 1;
      return rafCount;
    },
    cancelAnimationFrame: () => {}
  };

  try {
    const state = {
      activeBar: 0,
      playheadStep: 4,
      selected: null,
      selectedTracks: [],
      trackEditorMode: "pianoRoll",
      pianoRollTargetTrack: "sampler~bass",
      gridTrackIds: ["sampler~bass"],
      midiKeyboardArmed: false,
      midiRecording: false,
      intensity: 0.5,
      config: {
        generatedRowsEditable: 1,
        pianoRollTracks: ["sampler~bass"],
        patterns: {
          jazz: {
            bars: [{ "sampler~bass": [] }]
          }
        }
      }
    };
    const readStoredHit = (bar, hit, step) =>
      (bar?.[hit] || []).find((entry) => Number(entry.step) === Number(step)) || null;
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, pianoRoll: 0, ...options });
    const setHitData = (hit, step, patch, barIndex = state.activeBar) => {
      const bar = state.config.patterns.jazz.bars[barIndex];
      const current = readStoredHit(bar, hit, step);
      const next = {
        step,
        velocity: patch.velocity ?? current?.velocity ?? 0,
        options: normalizeStepOptions({ ...(current?.options || {}), ...(patch.options || {}) })
      };
      bar[hit] = (bar[hit] || []).filter((entry) => Number(entry.step) !== Number(step));
      if (next.velocity > 0.005) bar[hit].push(next);
    };
    let refreshCount = 0;
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit,
      setHitData,
      selectStep: () => {},
      refreshPianoRollLanes: () => { refreshCount += 1; },
      renderStepGrid: () => {},
      addGridTrack: () => {},
      renderTrackExplorer: () => {},
      renderSelectedPiano: () => {},
      PITCH_SLIDER_MIN: -48,
      PITCH_SLIDER_MAX: 87,
      BLACK_NOTE_PITCH_CLASSES: new Set(),
      A1_MIDI_NOTE: 33,
      noteNameForPitch: () => "A",
      formatPitch: (pitch) => String(pitch)
    });

    assert.equal(keyboard.setRecording(true, { announce: false }), true);
    keyboard.recordNote(12, { velocity: 0.5, track: "sampler~bass", chordIntervals: [0] });

    assert.equal(refreshCount, 1);
    assert.equal(rafCount, 0);
    assert.equal(state.config.patterns.jazz.bars[0]["sampler~bass"].length, 1);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("triggering a piano note creates a live visual for an open piano-roll lane", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  let rafCount = 0;
  globalThis.window = {
    requestAnimationFrame: () => {
      rafCount += 1;
      return rafCount;
    },
    cancelAnimationFrame: () => {},
    setTimeout: (callback) => {
      callback();
      return 1;
    }
  };

  try {
    const state = {
      activeBar: 0,
      playheadStep: 6,
      selected: null,
      selectedTracks: [],
      trackEditorMode: "grid",
      pianoRollTargetTrack: "sampler~lead",
      gridTrackIds: ["sampler~lead"],
      midiKeyboardArmed: true,
      midiRecording: false,
      intensity: 0.5,
      config: {
        generatedRowsEditable: 1,
        pianoRollTracks: ["sampler~lead"],
        patterns: {
          jazz: {
            bars: [{ "sampler~lead": [] }]
          }
        }
      }
    };
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, pianoRoll: 0, ...options });
    let refreshCount = 0;
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: true,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit: () => null,
      setHitData: () => {},
      selectStep: () => {},
      refreshPianoRollLanes: () => { refreshCount += 1; },
      renderStepGrid: () => {},
      addGridTrack: () => {},
      renderTrackExplorer: () => {},
      renderSelectedPiano: () => {},
      PITCH_SLIDER_MIN: -48,
      PITCH_SLIDER_MAX: 87,
      BLACK_NOTE_PITCH_CLASSES: new Set(),
      A1_MIDI_NOTE: 33,
      noteNameForPitch: () => "A",
      formatPitch: (pitch) => String(pitch)
    });

    await keyboard.triggerNote({ pitch: 9 }, {
      record: false,
      track: "sampler~lead",
      sourceId: "test-live",
      hold: true,
      velocity: 0.7,
      chordIntervals: [0]
    });

    assert.equal(state.livePianoRollNotes.length, 1);
    assert.equal(state.livePianoRollNotes[0].id, "test-live");
    assert.equal(state.livePianoRollNotes[0].step, 6);
    assert.equal(refreshCount, 1);
    assert.equal(rafCount, 0);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
