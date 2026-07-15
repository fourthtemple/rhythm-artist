import test from "node:test";
import assert from "node:assert/strict";

import {
  chordForComputerKey,
  computerOctaveDeltaForKey,
  computerOctaveFromKey,
  computerOctaveFromPianoOctave,
  createFakeMidiKeyboard,
  pianoOctaveFromComputerOctave,
  pitchForComputerKey,
  resolvePerformanceInputTarget,
  resolvePerformanceTrack
} from "../src/ui/piano-roll/fake-midi-keyboard.js";

test("piano roll mode records to the selected grid row before the previous piano roll target", () => {
  const target = resolvePerformanceTrack({
    trackEditorMode: "pianoRoll",
    selectedHit: "kick",
    pianoRollTargetTrack: "bass",
    openPianoRollTracks: ["bass"],
    gridTrackIds: ["kick", "bass"]
  });

  assert.equal(target, "kick");
});

test("piano roll mode records to a newly selected open piano roll before the previous target", () => {
  const target = resolvePerformanceTrack({
    trackEditorMode: "pianoRoll",
    selectedTracks: ["pluck"],
    pianoRollTargetTrack: "bass",
    openPianoRollTracks: ["bass", "pluck"],
    gridTrackIds: ["bass", "pluck"]
  });

  assert.equal(target, "pluck");
});

test("piano roll mode routes selected grid-only drum rows as drum triggers", () => {
  assert.deepEqual(resolvePerformanceInputTarget({
    trackEditorMode: "pianoRoll",
    selectedHit: "eightOhEightHat",
    pianoRollTargetTrack: "sampler~bass",
    openPianoRollTracks: ["sampler~bass"],
    gridTrackIds: ["sampler~bass", "eightOhEightHat"]
  }), {
    mode: "gridTrack",
    hit: "eightOhEightHat"
  });
});

test("piano roll mode keeps selected open piano-roll tracks as pitched targets", () => {
  assert.deepEqual(resolvePerformanceInputTarget({
    trackEditorMode: "pianoRoll",
    selectedHit: "sampler~bass",
    pianoRollTargetTrack: "sampler~old",
    openPianoRollTracks: ["sampler~bass", "sampler~old"],
    gridTrackIds: ["sampler~bass", "sampler~old"]
  }), {
    mode: "track",
    track: "sampler~bass"
  });
});

test("piano roll mode does not fall back to grid-hit recording without an open piano roll", () => {
  const target = resolvePerformanceTrack({
    trackEditorMode: "pianoRoll",
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

test("computer keyboard follows the visible piano octave", () => {
  assert.equal(computerOctaveFromPianoOctave(2), 4);
  assert.equal(computerOctaveFromPianoOctave(3), 5);
  assert.equal(pianoOctaveFromComputerOctave(4), 2);
  assert.equal(pianoOctaveFromComputerOctave(5), 3);
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
    let liveRefreshCount = 0;
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
      refreshLivePianoRollNotes: () => { liveRefreshCount += 1; },
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
  const rafCallbacks = [];
  globalThis.window = {
    requestAnimationFrame: (callback) => {
      rafCount += 1;
      rafCallbacks.push(callback);
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
    let liveRefreshCount = 0;
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
      refreshLivePianoRollNotes: () => { liveRefreshCount += 1; },
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
    assert.equal(refreshCount, 0);
    assert.equal(liveRefreshCount, 0);
    assert.equal(rafCount, 1);
    rafCallbacks.shift()?.();
    assert.equal(refreshCount, 0);
    assert.equal(liveRefreshCount, 1);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("triggering a piano note reports the recorded bar and step for piano-roll reveal", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.window = {
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setTimeout: () => 1
  };

  try {
    const state = {
      activeBar: 1,
      playheadStep: 9,
      selected: null,
      selectedTracks: [],
      trackEditorMode: "pianoRoll",
      pianoRollTargetTrack: "sampler~lead",
      gridTrackIds: ["sampler~lead"],
      midiKeyboardArmed: true,
      midiRecording: true,
      intensity: 0.5,
      config: {
        generatedRowsEditable: 1,
        pianoRollTracks: ["sampler~lead"],
        patterns: {
          jazz: {
            bars: [{ "sampler~lead": [] }, { "sampler~lead": [] }]
          }
        }
      },
      engine: {
        auditionPitchedTrack: async () => {}
      }
    };
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, chordIntervals: [0], pianoRoll: 0, ...options });
    const reveals = [];
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit: () => null,
      setHitData: () => {},
      selectStep: () => {},
      refreshPianoRollLanes: () => {},
      refreshLivePianoRollNotes: () => {},
      renderStepGrid: () => {},
      addGridTrack: () => {},
      renderTrackExplorer: () => {},
      renderSelectedPiano: () => {},
      onPianoRollRecordPosition: (position) => reveals.push(position),
      PITCH_SLIDER_MIN: -48,
      PITCH_SLIDER_MAX: 87,
      BLACK_NOTE_PITCH_CLASSES: new Set(),
      A1_MIDI_NOTE: 33,
      noteNameForPitch: () => "A",
      formatPitch: (pitch) => String(pitch)
    });

    await keyboard.triggerNote({ pitch: 9 }, {
      record: true,
      track: "sampler~lead",
      sourceId: "test-live-reveal",
      hold: true,
      velocity: 0.7,
      chordIntervals: [0]
    });

    assert.deepEqual(reveals, [{
      track: "sampler~lead",
      barIndex: 1,
      step: 9,
      pitch: 9,
      live: true
    }]);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("triggering a piano note auditions before repainting live notes", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const rafCallbacks = [];
  globalThis.window = {
    requestAnimationFrame: (callback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    },
    cancelAnimationFrame: () => {},
    setTimeout: () => 1
  };

  try {
    const events = [];
    const state = {
      activeBar: 0,
      playheadStep: 3,
      selected: null,
      selectedTracks: [],
      trackEditorMode: "pianoRoll",
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
      },
      engine: {
        auditionPitchedTrack: async () => {
          events.push("audio");
        }
      }
    };
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, pianoRoll: 0, ...options });
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit: () => null,
      setHitData: () => {},
      selectStep: () => {},
      refreshPianoRollLanes: () => { events.push("refresh"); },
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

    assert.deepEqual(events, ["audio"]);
    assert.equal(state.livePianoRollNotes.length, 1);
    assert.equal(rafCallbacks.length, 1);
    rafCallbacks.shift()?.();
    assert.deepEqual(events, ["audio", "refresh"]);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("recording a held piano note defers full redraw while live note is visible", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const rafCallbacks = [];
  globalThis.window = {
    requestAnimationFrame: (callback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    },
    cancelAnimationFrame: () => {},
    setTimeout: () => 1
  };

  try {
    const state = {
      activeBar: 0,
      playheadStep: 7,
      selected: null,
      selectedTracks: [],
      trackEditorMode: "pianoRoll",
      pianoRollTargetTrack: "sampler~lead",
      gridTrackIds: ["sampler~lead"],
      midiKeyboardArmed: true,
      midiRecording: true,
      intensity: 0.5,
      config: {
        generatedRowsEditable: 1,
        pianoRollTracks: ["sampler~lead"],
        patterns: {
          jazz: {
            bars: [{ "sampler~lead": [] }]
          }
        }
      },
      engine: {
        auditionPitchedTrack: async () => {}
      }
    };
    const readStoredHit = (bar, hit, step) =>
      (bar?.[hit] || []).find((entry) => Number(entry.step ?? entry[0]) === Number(step)) || null;
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, chordIntervals: [0], pianoRoll: 0, ...options });
    const patches = [];
    const setHitData = (hit, step, patch, barIndex = state.activeBar) => {
      patches.push({ hit, step, patch, barIndex });
      const bar = state.config.patterns.jazz.bars[barIndex];
      const current = readStoredHit(bar, hit, step);
      const currentOptions = Array.isArray(current) ? current[2] : current?.options;
      const currentVelocity = Array.isArray(current) ? current[1] : current?.velocity;
      const next = {
        step,
        velocity: patch.velocity ?? currentVelocity ?? 0,
        options: normalizeStepOptions({ ...(currentOptions || {}), ...(patch.options || {}) })
      };
      bar[hit] = (bar[hit] || []).filter((entry) => Number(entry.step ?? entry[0]) !== Number(step));
      if (next.velocity > 0.005) bar[hit].push(next);
    };
    let refreshCount = 0;
    let liveRefreshCount = 0;
    let selectCount = 0;
    let syncRecordedConfigCount = 0;
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit,
      setHitData,
      selectStep: () => { selectCount += 1; },
      refreshPianoRollLanes: () => { refreshCount += 1; },
      refreshLivePianoRollNotes: () => { liveRefreshCount += 1; },
      renderStepGrid: () => {},
      addGridTrack: () => {},
      renderTrackExplorer: () => {},
      renderSelectedPiano: () => {},
      syncRecordedConfig: () => { syncRecordedConfigCount += 1; },
      PITCH_SLIDER_MIN: -48,
      PITCH_SLIDER_MAX: 87,
      BLACK_NOTE_PITCH_CLASSES: new Set(),
      A1_MIDI_NOTE: 33,
      noteNameForPitch: () => "A",
      formatPitch: (pitch) => String(pitch)
    });

    await keyboard.triggerNote({ pitch: 11 }, {
      record: true,
      track: "sampler~lead",
      sourceId: "test-live-record",
      hold: true,
      velocity: 0.7,
      chordIntervals: [0]
    });

    const recorded = state.config.patterns.jazz.bars[0]["sampler~lead"];
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].step, 7);
    assert.equal(recorded[0].options.pitch, 11);
    assert.equal(patches.length, 1);
    assert.equal(patches[0].patch.deferApply, true);
    assert.equal(patches[0].patch.skipHistory, true);
    assert.equal(selectCount, 0);
    assert.equal(refreshCount, 0);
    assert.equal(liveRefreshCount, 0);
    assert.equal(syncRecordedConfigCount, 0);
    assert.equal(rafCallbacks.length, 1);
    rafCallbacks.shift()?.();
    assert.equal(refreshCount, 0);
    assert.equal(liveRefreshCount, 1);

    keyboard.setRecording(false, { announce: false });
    assert.equal(syncRecordedConfigCount, 1);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("releasing a held recorded piano note stores its played duration", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.window = {
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setTimeout: () => 1
  };

  try {
    const state = {
      activeBar: 0,
      playheadStep: 2,
      selected: null,
      selectedTracks: [],
      trackEditorMode: "pianoRoll",
      pianoRollTargetTrack: "sampler~lead",
      gridTrackIds: ["sampler~lead"],
      midiKeyboardArmed: true,
      midiRecording: true,
      intensity: 0.5,
      quantize: { enabled: false },
      config: {
        generatedRowsEditable: 1,
        pianoRollTracks: ["sampler~lead"],
        patterns: {
          jazz: {
            bars: [{ "sampler~lead": [] }]
          }
        }
      },
      engine: {
        auditionPitchedTrack: async () => {}
      }
    };
    const readStoredHit = (bar, hit, step) =>
      (bar?.[hit] || []).find((entry) => Number(entry.step ?? entry[0]) === Number(step)) || null;
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, chordIntervals: [0], pianoRoll: 0, durationSteps: 1, ...options });
    const setHitData = (hit, step, patch, barIndex = state.activeBar) => {
      const bar = state.config.patterns.jazz.bars[barIndex];
      const current = readStoredHit(bar, hit, step);
      const currentOptions = Array.isArray(current) ? current[2] : current?.options;
      const currentVelocity = Array.isArray(current) ? current[1] : current?.velocity;
      const next = {
        step,
        velocity: patch.velocity ?? currentVelocity ?? 0,
        options: normalizeStepOptions({ ...(currentOptions || {}), ...(patch.options || {}) })
      };
      bar[hit] = (bar[hit] || []).filter((entry) => Number(entry.step ?? entry[0]) !== Number(step));
      if (next.velocity > 0.005) bar[hit].push(next);
    };
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit,
      setHitData,
      selectStep: () => {},
      refreshPianoRollLanes: () => {},
      refreshLivePianoRollNotes: () => {},
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

    await keyboard.triggerNote({ pitch: 11 }, {
      record: true,
      track: "sampler~lead",
      sourceId: "test-held-duration",
      hold: true,
      velocity: 0.7,
      chordIntervals: [0]
    });
    state.playheadStep = 5.63;
    keyboard.releaseNote("test-held-duration", { recorded: true });

    const recorded = state.config.patterns.jazz.bars[0]["sampler~lead"];
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].step, 2);
    assert.equal(recorded[0].options.pitch, 11);
    assert.equal(recorded[0].options.durationSteps, 3.75);
    assert.deepEqual(state.livePianoRollNotes || [], []);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("recording after switching tracks writes to the selected track instead of the old piano roll", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.window = {
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setTimeout: () => 1
  };

  try {
    const state = {
      activeBar: 0,
      playheadStep: 6,
      selected: null,
      selectedTracks: ["sampler~new"],
      trackEditorMode: "pianoRoll",
      pianoRollTargetTrack: "sampler~old",
      gridTrackIds: ["sampler~old", "sampler~new"],
      midiKeyboardArmed: true,
      midiRecording: true,
      intensity: 0.5,
      config: {
        generatedRowsEditable: 1,
        pianoRollTracks: ["sampler~old"],
        patterns: {
          jazz: {
            bars: [{
              "sampler~old": [],
              "sampler~new": []
            }]
          }
        }
      },
      engine: {
        auditionPitchedTrack: async () => {}
      }
    };
    const readStoredHit = (bar, hit, step) =>
      (bar?.[hit] || []).find((entry) => Number(entry.step ?? entry[0]) === Number(step)) || null;
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, chordIntervals: [0], pianoRoll: 0, ...options });
    const setHitData = (hit, step, patch, barIndex = state.activeBar) => {
      const bar = state.config.patterns.jazz.bars[barIndex];
      const current = readStoredHit(bar, hit, step);
      const currentOptions = Array.isArray(current) ? current[2] : current?.options;
      const currentVelocity = Array.isArray(current) ? current[1] : current?.velocity;
      const next = {
        step,
        velocity: patch.velocity ?? currentVelocity ?? 0,
        options: normalizeStepOptions({ ...(currentOptions || {}), ...(patch.options || {}) })
      };
      bar[hit] = (bar[hit] || []).filter((entry) => Number(entry.step ?? entry[0]) !== Number(step));
      if (next.velocity > 0.005) bar[hit].push(next);
    };
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit,
      setHitData,
      selectStep: () => {},
      refreshPianoRollLanes: () => {},
      refreshLivePianoRollNotes: () => {},
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

    await keyboard.triggerNote({ pitch: 13 }, {
      record: true,
      sourceId: "test-switched-track",
      hold: true,
      velocity: 0.7,
      chordIntervals: [0]
    });

    const oldTrack = state.config.patterns.jazz.bars[0]["sampler~old"];
    const newTrack = state.config.patterns.jazz.bars[0]["sampler~new"];
    assert.deepEqual(oldTrack, []);
    assert.equal(newTrack.length, 1);
    assert.equal(newTrack[0].step, 6);
    assert.equal(newTrack[0].options.pitch, 13);
    assert.equal(state.pianoRollTargetTrack, "sampler~new");
    assert.deepEqual(state.config.pianoRollTracks, ["sampler~old", "sampler~new"]);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("recording into a piano-roll-only track does not add a step sequencer row", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.window = {
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setTimeout: () => 1
  };

  try {
    const state = {
      activeBar: 0,
      playheadStep: 4,
      selected: null,
      selectedTracks: ["sampler~lead"],
      trackEditorMode: "pianoRoll",
      pianoRollTargetTrack: "sampler~lead",
      gridTrackIds: [],
      midiKeyboardArmed: true,
      midiRecording: true,
      intensity: 0.5,
      config: {
        generatedRowsEditable: 1,
        pianoRollTracks: ["sampler~lead"],
        patterns: {
          jazz: {
            bars: [{ "sampler~lead": [] }]
          }
        }
      },
      engine: {
        auditionPitchedTrack: async () => {}
      }
    };
    const readStoredHit = (bar, hit, step) =>
      (bar?.[hit] || []).find((entry) => Number(entry.step ?? entry[0]) === Number(step)) || null;
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, chordIntervals: [0], pianoRoll: 0, ...options });
    const setHitData = (hit, step, patch, barIndex = state.activeBar) => {
      const bar = state.config.patterns.jazz.bars[barIndex];
      const current = readStoredHit(bar, hit, step);
      const currentOptions = Array.isArray(current) ? current[2] : current?.options;
      const currentVelocity = Array.isArray(current) ? current[1] : current?.velocity;
      const next = {
        step,
        velocity: patch.velocity ?? currentVelocity ?? 0,
        options: normalizeStepOptions({ ...(currentOptions || {}), ...(patch.options || {}) })
      };
      bar[hit] = (bar[hit] || []).filter((entry) => Number(entry.step ?? entry[0]) !== Number(step));
      if (next.velocity > 0.005) bar[hit].push(next);
    };
    let addGridCount = 0;
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit,
      setHitData,
      selectStep: () => {},
      refreshPianoRollLanes: () => {},
      refreshLivePianoRollNotes: () => {},
      renderStepGrid: () => {},
      addGridTrack: () => { addGridCount += 1; },
      renderTrackExplorer: () => {},
      renderSelectedPiano: () => {},
      PITCH_SLIDER_MIN: -48,
      PITCH_SLIDER_MAX: 87,
      BLACK_NOTE_PITCH_CLASSES: new Set(),
      A1_MIDI_NOTE: 33,
      noteNameForPitch: () => "A",
      formatPitch: (pitch) => String(pitch)
    });

    await keyboard.recordNote(10, {
      velocity: 0.7,
      track: "sampler~lead",
      chordIntervals: [0]
    });

    assert.equal(addGridCount, 0);
    assert.deepEqual(state.gridTrackIds, []);
    assert.deepEqual(state.config.pianoRollTracks, ["sampler~lead"]);
    assert.equal(state.config.patterns.jazz.bars[0]["sampler~lead"][0].options.pitch, 10);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("released MIDI notes do not create stale held live visuals", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.window = {
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setTimeout: () => 1
  };

  try {
    const state = {
      activeBar: 0,
      playheadStep: 3,
      selected: null,
      selectedTracks: [],
      trackEditorMode: "pianoRoll",
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
      },
      engine: {
        auditionPitchedTrack: async () => {}
      }
    };
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, pianoRoll: 0, ...options });
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit: () => null,
      setHitData: () => {},
      selectStep: () => {},
      refreshPianoRollLanes: () => {},
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
      sourceId: "midi:0:60",
      hold: true,
      velocity: 0.7,
      chordIntervals: [0]
    });

    assert.deepEqual(state.livePianoRollNotes || [], []);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("released MIDI notes still record after audio audition resolves", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const rafCallbacks = [];
  globalThis.window = {
    requestAnimationFrame: (callback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    },
    cancelAnimationFrame: () => {},
    setTimeout: () => 1
  };

  try {
    const state = {
      activeBar: 0,
      playheadStep: 5,
      selected: null,
      selectedTracks: [],
      trackEditorMode: "pianoRoll",
      pianoRollTargetTrack: "sampler~lead",
      gridTrackIds: ["sampler~lead"],
      midiKeyboardArmed: true,
      midiRecording: true,
      intensity: 0.5,
      config: {
        generatedRowsEditable: 1,
        pianoRollTracks: ["sampler~lead"],
        patterns: {
          jazz: {
            bars: [{ "sampler~lead": [] }]
          }
        }
      },
      engine: {
        auditionPitchedTrack: async () => {}
      }
    };
    const readStoredHit = (bar, hit, step) =>
      (bar?.[hit] || []).find((entry) => Number(entry.step ?? entry[0]) === Number(step)) || null;
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, chordIntervals: [0], pianoRoll: 0, ...options });
    const setHitData = (hit, step, patch, barIndex = state.activeBar) => {
      const bar = state.config.patterns.jazz.bars[barIndex];
      const current = readStoredHit(bar, hit, step);
      const currentOptions = Array.isArray(current) ? current[2] : current?.options;
      const currentVelocity = Array.isArray(current) ? current[1] : current?.velocity;
      const next = {
        step,
        velocity: patch.velocity ?? currentVelocity ?? 0,
        options: normalizeStepOptions({ ...(currentOptions || {}), ...(patch.options || {}) })
      };
      bar[hit] = (bar[hit] || []).filter((entry) => Number(entry.step ?? entry[0]) !== Number(step));
      if (next.velocity > 0.005) bar[hit].push(next);
    };
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit,
      setHitData,
      selectStep: () => {},
      refreshPianoRollLanes: () => {},
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
      record: true,
      track: "sampler~lead",
      sourceId: "midi:0:60",
      hold: true,
      velocity: 0.7,
      chordIntervals: [0]
    });

    const recorded = state.config.patterns.jazz.bars[0]["sampler~lead"];
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].step, 5);
    assert.equal(recorded[0].options.pitch, 9);
    assert.equal(recorded[0].options.pianoRoll, 1);
    assert.deepEqual(state.livePianoRollNotes || [], []);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("MIDI recording snaps to the selected track steps per bar", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.window = {
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setTimeout: () => 1
  };

  try {
    const state = {
      activeBar: 0,
      playheadStep: 5.6,
      selected: null,
      selectedTracks: ["sampler~lead"],
      trackEditorMode: "pianoRoll",
      pianoRollTargetTrack: "sampler~lead",
      gridTrackIds: ["sampler~lead"],
      midiKeyboardArmed: true,
      midiRecording: true,
      intensity: 0.5,
      config: {
        generatedRowsEditable: 1,
        pianoRollTracks: ["sampler~lead"],
        quantize: { enabled: true },
        trackStepCounts: { "sampler~lead": 4 },
        patterns: {
          jazz: {
            bars: [{ "sampler~lead": [] }]
          }
        }
      },
      quantize: { enabled: true },
      engine: {
        auditionPitchedTrack: async () => {}
      }
    };
    const readStoredHit = (bar, hit, step) =>
      (bar?.[hit] || []).find((entry) => Number(entry.step ?? entry[0]) === Number(step)) || null;
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, chordIntervals: [0], pianoRoll: 0, ...options });
    const setHitData = (hit, step, patch, barIndex = state.activeBar) => {
      const bar = state.config.patterns.jazz.bars[barIndex];
      const current = readStoredHit(bar, hit, step);
      const currentOptions = Array.isArray(current) ? current[2] : current?.options;
      const currentVelocity = Array.isArray(current) ? current[1] : current?.velocity;
      const next = {
        step,
        velocity: patch.velocity ?? currentVelocity ?? 0,
        options: normalizeStepOptions({ ...(currentOptions || {}), ...(patch.options || {}) })
      };
      bar[hit] = (bar[hit] || []).filter((entry) => Number(entry.step ?? entry[0]) !== Number(step));
      if (next.velocity > 0.005) bar[hit].push(next);
    };
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit,
      setHitData,
      selectStep: () => {},
      refreshPianoRollLanes: () => {},
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

    await keyboard.recordNote(9, {
      velocity: 0.7,
      track: "sampler~lead",
      chordIntervals: [0]
    });

    const recorded = state.config.patterns.jazz.bars[0]["sampler~lead"];
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].step, 4);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("MIDI recording can bypass quantize snapping", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.window = {
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setTimeout: () => 1
  };

  try {
    const state = {
      activeBar: 0,
      playheadStep: 5.6,
      selected: null,
      selectedTracks: ["sampler~lead"],
      trackEditorMode: "pianoRoll",
      pianoRollTargetTrack: "sampler~lead",
      gridTrackIds: ["sampler~lead"],
      midiKeyboardArmed: true,
      midiRecording: true,
      intensity: 0.5,
      quantize: { enabled: false },
      config: {
        generatedRowsEditable: 1,
        pianoRollTracks: ["sampler~lead"],
        trackStepCounts: { "sampler~lead": 4 },
        patterns: {
          jazz: {
            bars: [{ "sampler~lead": [] }]
          }
        }
      },
      engine: {
        auditionPitchedTrack: async () => {}
      }
    };
    const readStoredHit = (bar, hit, step) =>
      (bar?.[hit] || []).find((entry) => Number(entry.step ?? entry[0]) === Number(step)) || null;
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, chordIntervals: [0], pianoRoll: 0, ...options });
    const setHitData = (hit, step, patch, barIndex = state.activeBar) => {
      const bar = state.config.patterns.jazz.bars[barIndex];
      const current = readStoredHit(bar, hit, step);
      const currentOptions = Array.isArray(current) ? current[2] : current?.options;
      const currentVelocity = Array.isArray(current) ? current[1] : current?.velocity;
      const next = {
        step,
        velocity: patch.velocity ?? currentVelocity ?? 0,
        options: normalizeStepOptions({ ...(currentOptions || {}), ...(patch.options || {}) })
      };
      bar[hit] = (bar[hit] || []).filter((entry) => Number(entry.step ?? entry[0]) !== Number(step));
      if (next.velocity > 0.005) bar[hit].push(next);
    };
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit,
      setHitData,
      selectStep: () => {},
      refreshPianoRollLanes: () => {},
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

    await keyboard.recordNote(9, {
      velocity: 0.7,
      track: "sampler~lead",
      chordIntervals: [0]
    });

    const recorded = state.config.patterns.jazz.bars[0]["sampler~lead"];
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].step, 5.6);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("MIDI recording while playing stamps notes from the audio clock", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.window = {
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setTimeout: () => 1
  };

  try {
    const state = {
      activeBar: 0,
      playheadStep: 1,
      cameraPlayheadBar: 0,
      cameraPlayheadStep: 1,
      playing: true,
      selected: null,
      selectedTracks: ["sampler~lead"],
      trackEditorMode: "pianoRoll",
      pianoRollTargetTrack: "sampler~lead",
      gridTrackIds: ["sampler~lead"],
      midiKeyboardArmed: true,
      midiRecording: true,
      intensity: 0.5,
      quantize: { enabled: false },
      config: {
        generatedRowsEditable: 1,
        pianoRollTracks: ["sampler~lead"],
        patterns: {
          jazz: {
            bars: [{ "sampler~lead": [] }]
          }
        }
      },
      engine: {
        getPlaybackState: () => ({
          playing: true,
          phraseBar: 0,
          step: 6,
          nextStepTime: 10.5,
          stepDuration: 0.25,
          contextTime: 10.375
        }),
        auditionPitchedTrack: async () => {}
      }
    };
    const readStoredHit = (bar, hit, step) =>
      (bar?.[hit] || []).find((entry) => Number(entry.step ?? entry[0]) === Number(step)) || null;
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, chordIntervals: [0], pianoRoll: 0, ...options });
    const setHitData = (hit, step, patch, barIndex = state.activeBar) => {
      const bar = state.config.patterns.jazz.bars[barIndex];
      const current = readStoredHit(bar, hit, step);
      const currentOptions = Array.isArray(current) ? current[2] : current?.options;
      const currentVelocity = Array.isArray(current) ? current[1] : current?.velocity;
      const next = {
        step,
        velocity: patch.velocity ?? currentVelocity ?? 0,
        options: normalizeStepOptions({ ...(currentOptions || {}), ...(patch.options || {}) })
      };
      bar[hit] = (bar[hit] || []).filter((entry) => Number(entry.step ?? entry[0]) !== Number(step));
      if (next.velocity > 0.005) bar[hit].push(next);
    };
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit,
      setHitData,
      selectStep: () => {},
      refreshPianoRollLanes: () => {},
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

    await keyboard.recordNote(9, {
      velocity: 0.7,
      track: "sampler~lead",
      chordIntervals: [0]
    });

    const recorded = state.config.patterns.jazz.bars[0]["sampler~lead"];
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].step, 5.5);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("MIDI recording prefers current audible playback position over scheduler lookahead", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.window = {
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setTimeout: () => 1
  };

  try {
    const state = {
      activeBar: 0,
      playheadStep: 1,
      cameraPlayheadBar: 0,
      cameraPlayheadStep: 1,
      playing: true,
      selected: null,
      selectedTracks: ["sampler~lead"],
      trackEditorMode: "pianoRoll",
      pianoRollTargetTrack: "sampler~lead",
      gridTrackIds: ["sampler~lead"],
      midiKeyboardArmed: true,
      midiRecording: true,
      intensity: 0.5,
      quantize: { enabled: false },
      config: {
        generatedRowsEditable: 1,
        pianoRollTracks: ["sampler~lead"],
        patterns: {
          jazz: {
            bars: [{ "sampler~lead": [] }]
          }
        }
      },
      engine: {
        currentPlaybackPosition: () => ({ phraseBar: 0, step: 2.25, absStep: 2.25 }),
        getPlaybackState: () => ({
          playing: true,
          phraseBar: 0,
          step: 6,
          nextStepTime: 10.5,
          stepDuration: 0.25,
          contextTime: 10.375
        }),
        auditionPitchedTrack: async () => {}
      }
    };
    const readStoredHit = (bar, hit, step) =>
      (bar?.[hit] || []).find((entry) => Number(entry.step ?? entry[0]) === Number(step)) || null;
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, chordIntervals: [0], pianoRoll: 0, ...options });
    const setHitData = (hit, step, patch, barIndex = state.activeBar) => {
      const bar = state.config.patterns.jazz.bars[barIndex];
      const current = readStoredHit(bar, hit, step);
      const currentOptions = Array.isArray(current) ? current[2] : current?.options;
      const currentVelocity = Array.isArray(current) ? current[1] : current?.velocity;
      const next = {
        step,
        velocity: patch.velocity ?? currentVelocity ?? 0,
        options: normalizeStepOptions({ ...(currentOptions || {}), ...(patch.options || {}) })
      };
      bar[hit] = (bar[hit] || []).filter((entry) => Number(entry.step ?? entry[0]) !== Number(step));
      if (next.velocity > 0.005) bar[hit].push(next);
    };
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit,
      setHitData,
      selectStep: () => {},
      refreshPianoRollLanes: () => {},
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

    await keyboard.recordNote(9, {
      velocity: 0.7,
      track: "sampler~lead",
      chordIntervals: [0]
    });

    const recorded = state.config.patterns.jazz.bars[0]["sampler~lead"];
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].step, 2.25);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("triggering a piano note without a selected track auditions the default instrument", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.window = {
    setTimeout: (callback) => {
      callback();
      return 1;
    }
  };

  try {
    const state = {
      activeBar: 0,
      playheadStep: 0,
      selected: null,
      selectedTracks: [],
      trackEditorMode: "grid",
      pianoRollTargetTrack: null,
      gridTrackIds: [],
      midiKeyboardArmed: false,
      midiRecording: false,
      pianoRollLastVelocity: 0.42,
      intensity: 0.5,
      config: {
        generatedRowsEditable: 1,
        pianoRollTracks: [],
        patterns: {
          jazz: {
            bars: [{ eightOhEightKick: [] }]
          }
        }
      },
      engine: {
        auditionPitchedTrack: async (track, pitch, options) => {
          state.lastAudition = { track, pitch, options };
        }
      }
    };
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, pianoRoll: 0, ...options });
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit: () => null,
      setHitData: () => {},
      selectStep: () => {},
      refreshPianoRollLanes: () => {},
      renderStepGrid: () => {},
      addGridTrack: () => {},
      renderTrackExplorer: () => {},
      renderSelectedPiano: () => {},
      defaultNoteState: () => ({
        instrument: "eightOhEightKick",
        velocity: 0.32,
        options: normalizeStepOptions()
      }),
      PITCH_SLIDER_MIN: -48,
      PITCH_SLIDER_MAX: 87,
      BLACK_NOTE_PITCH_CLASSES: new Set(),
      A1_MIDI_NOTE: 33,
      noteNameForPitch: () => "A",
      formatPitch: (pitch) => String(pitch)
    });

    await keyboard.triggerNote({ pitch: 5 }, { record: false, track: null, chordIntervals: [0] });

    assert.equal(state.lastAudition.track, "eightOhEightKick");
    assert.equal(state.lastAudition.pitch, 5);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("first app gesture requests MIDI access without arming computer keys", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const documentListeners = new Map();
  const midiInput = { id: "keyboard-one", name: "Keyboard One", state: "connected" };
  let requestCount = 0;
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, listener) => {
      documentListeners.set(type, listener);
    }
  };
  globalThis.window = {
    addEventListener: () => {},
    setTimeout: (callback) => {
      callback();
      return 1;
    }
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      requestMIDIAccess: async () => {
        requestCount += 1;
        return {
          inputs: new Map([["keyboard-one", midiInput]]),
          onstatechange: null
        };
      }
    }
  });

  try {
    const state = {
      activeBar: 0,
      playheadStep: 0,
      selected: null,
      selectedTracks: [],
      trackEditorMode: "grid",
      pianoRollTargetTrack: null,
      gridTrackIds: ["kick"],
      midiKeyboardArmed: false,
      midiRecording: false,
      pianoRollLastVelocity: 0.42,
      computerKeyboardOctave: 4,
      computerKeyboardChordId: "single",
      intensity: 0.5,
      config: {
        generatedRowsEditable: 1,
        pianoRollTracks: [],
        patterns: {
          jazz: {
            bars: [{ kick: [] }]
          }
        }
      }
    };
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, pianoRoll: 0, ...options });
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit: () => null,
      setHitData: () => {},
      selectStep: () => {},
      refreshPianoRollLanes: () => {},
      renderStepGrid: () => {},
      addGridTrack: () => {},
      renderTrackExplorer: () => {},
      renderTrackInspector: () => {},
      renderSelectedPiano: () => {},
      PITCH_SLIDER_MIN: -48,
      PITCH_SLIDER_MAX: 94,
      BLACK_NOTE_PITCH_CLASSES: new Set(),
      A1_MIDI_NOTE: 33,
      noteNameForPitch: () => "A",
      formatPitch: (pitch) => String(pitch)
    });

    keyboard.wire();
    assert.equal(requestCount, 0);
    assert.equal(state.midiKeyboardArmed, false);
    documentListeners.get("pointerdown")?.({ type: "pointerdown", target: null });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(requestCount, 1);
    assert.equal(typeof midiInput.onmidimessage, "function");
    assert.equal(state.midiKeyboardArmed, false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});

test("unmapped MIDI notes fall back to the default instrument as pitched notes", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const midiInput = { id: "keyboard-one", name: "Keyboard One", state: "connected" };
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.window = {
    setTimeout: (callback) => {
      callback();
      return 1;
    }
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      requestMIDIAccess: async () => ({
        inputs: new Map([["keyboard-one", midiInput]]),
        onstatechange: null
      })
    }
  });

  try {
    const state = {
      activeBar: 0,
      playheadStep: 0,
      selected: null,
      selectedTracks: [],
      trackEditorMode: "grid",
      pianoRollTargetTrack: null,
      gridTrackIds: ["kick"],
      midiKeyboardArmed: false,
      midiRecording: false,
      pianoRollLastVelocity: 0.42,
      intensity: 0.5,
      config: {
        generatedRowsEditable: 1,
        midiNoteMap: {},
        pianoRollTracks: [],
        patterns: {
          jazz: {
            bars: [{ kick: [] }]
          }
        }
      },
      engine: {
        auditionPitchedTrack: async (track, pitch, options) => {
          state.lastAudition = { track, pitch, options };
        }
      }
    };
    const normalizeStepOptions = (options = {}) => ({ pitch: 0, pianoRoll: 0, ...options });
    const keyboard = createFakeMidiKeyboard({
      $: () => null,
      state,
      runningFromFile: false,
      setStatus: () => {},
      normalizeStepOptions,
      readStoredHit: () => null,
      setHitData: () => {},
      selectStep: () => {},
      refreshPianoRollLanes: () => {},
      renderStepGrid: () => {},
      addGridTrack: () => {},
      renderTrackExplorer: () => {},
      renderSelectedPiano: () => {},
      defaultNoteState: () => ({
        instrument: "eightOhEightKick",
        velocity: 0.32,
        options: normalizeStepOptions()
      }),
      PITCH_SLIDER_MIN: -48,
      PITCH_SLIDER_MAX: 94,
      BLACK_NOTE_PITCH_CLASSES: new Set(),
      A1_MIDI_NOTE: 33,
      noteNameForPitch: () => "A",
      formatPitch: (pitch) => String(pitch)
    });

    assert.equal(await keyboard.requestMidiAccess({ announce: false }), true);
    midiInput.onmidimessage?.({ target: midiInput, data: [0x90, 60, 127] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(state.lastAudition.track, "eightOhEightKick");
    assert.equal(state.lastAudition.pitch, 27);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});
