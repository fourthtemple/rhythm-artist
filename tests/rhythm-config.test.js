import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NOTE_INSTRUMENT,
  DEFAULT_GRID_TRACK_IDS,
  effectiveStepOptionsForTrack,
  metronomeBeatEventsForStep,
  normalizeTrackOptionDefaults,
  normalizeRhythmConfig,
  normalizeTimeSignature,
  normalizeTrackStepCount,
  TRACK_BY_ID
} from "../src/audio/rhythm-config.js";

test("normalizeTrackStepCount allows arbitrary integer grid densities", () => {
  assert.equal(normalizeTrackStepCount(7), 7);
  assert.equal(normalizeTrackStepCount(13), 13);
  assert.equal(normalizeTrackStepCount(20.8), 21);
});

test("normalizeTrackStepCount clamps unusable extremes", () => {
  assert.equal(normalizeTrackStepCount(0), 1);
  assert.equal(normalizeTrackStepCount(-12), 1);
  assert.equal(normalizeTrackStepCount(999), 128);
});

test("piano roll is an editor layout, not an instrument track", () => {
  assert.equal(TRACK_BY_ID.pianoRoll, undefined);
  assert.ok(!DEFAULT_GRID_TRACK_IDS.includes("pianoRoll"));
  const config = normalizeRhythmConfig();
  assert.deepEqual(config.pianoRollTracks, []);
  assert.equal(config.patterns.jazz.bars[0].pianoRoll, undefined);
});

test("normalizeRhythmConfig preserves opened piano roll instruments", () => {
  const config = normalizeRhythmConfig({
    pianoRollTracks: ["bass", "pad", "missing", "bass"],
    pianoRollLaneHeights: {
      bass: 58,
      pad: 999,
      missing: 120,
      kick: 9999
    }
  });
  assert.deepEqual(config.pianoRollTracks, ["bass", "pad"]);
  assert.deepEqual(config.pianoRollLaneHeights, { bass: 58, pad: 999 });
});

test("normalizeRhythmConfig preserves lane automation parameter choices", () => {
  const config = normalizeRhythmConfig({
    trackAutomationParams: {
      "grid:kick": "velocity",
      "piano:bass": "reverbSend",
      "wave:loop_a": "dubEcho",
      "grid:bad": "missing",
      "bad:kick": "velocity"
    }
  });
  assert.deepEqual(config.trackAutomationParams, {
    "grid:kick": "velocity",
    "piano:bass": "reverbSend",
    "wave:loop_a": "dubEcho"
  });
});

test("normalizeRhythmConfig preserves mixed editor lane order", () => {
  const config = normalizeRhythmConfig({
    pianoRollTracks: ["bass", "pad"],
    loopTracks: [
      { id: "loop_a", name: "Loop A", barsInFile: 4, url: "./assets/audio/sample-pack/loops/ra_loop_01_118bpm.wav", regions: [] },
      { id: "loop_b", name: "Loop B", barsInFile: 4, url: "./assets/audio/sample-pack/loops/ra_loop_02_118bpm.wav", regions: [] }
    ],
    trackViewTrackIds: ["rim"],
    editorLaneOrder: ["wave:loop_a", "grid:kick", "piano:bass", "wave:loop_b", "grid:rim", "piano:pad", "wave:missing", "grid:missing", "piano:missing"]
  });
  assert.deepEqual(config.editorLaneOrder, ["wave:loop_a", "grid:kick", "piano:bass", "wave:loop_b", "grid:rim", "piano:pad"]);
});

test("normalizeRhythmConfig preserves explicit Track View entries", () => {
  const config = normalizeRhythmConfig({
    trackViewTrackIds: ["bass", "missing", "eightOhEightKick", "bass"],
    trackSamples: {
      kick: {
        source: "bundled-sample",
        label: "Custom Kick",
        url: "./assets/audio/sample-pack/drums/kick.wav"
      }
    },
    pianoRollTracks: ["pad"]
  });
  assert.deepEqual(config.trackViewTrackIds, ["bass", "eightOhEightKick", "kick", "pad"]);
});

test("normalizeRhythmConfig preserves hidden grid tracks", () => {
  const config = normalizeRhythmConfig({
    hiddenGridTrackIds: ["kick", "missing", "bass", "kick"]
  });
  assert.deepEqual(config.hiddenGridTrackIds, ["kick", "bass"]);
});

test("normalizeRhythmConfig preserves nonstandard per-track step counts", () => {
  const config = normalizeRhythmConfig({
    trackStepCounts: {
      kick: 7,
      snare: 13,
      hat: 16
    }
  });
  assert.equal(config.trackStepCounts.kick, 7);
  assert.equal(config.trackStepCounts.snare, 13);
  assert.equal(config.trackStepCounts.hat, undefined);
});

test("normalizeRhythmConfig stores sparse per-track sampler defaults", () => {
  const config = normalizeRhythmConfig({
    trackOptionDefaults: {
      kick: {
        offsetMs: 240,
        attackMs: 44,
        wobble: 9,
        dubEcho: 0.42,
        delaySend: 0.35,
        reverbSend: 0.25
      },
      snare: {
        attackMs: 18,
        reverbSend: 0
      }
    }
  });
  assert.deepEqual(config.trackOptionDefaults.kick, {
    offsetMs: 180,
    attackMs: 44,
    wobble: 4,
    dubEcho: 0.42,
    delaySend: 0.35,
    reverbSend: 0.25
  });
  assert.equal(config.trackOptionDefaults.snare, undefined);
});

test("normalizeRhythmConfig stores sparse per-track default note velocities", () => {
  const config = normalizeRhythmConfig({
    trackDefaultVelocities: {
      kick: 0.91,
      snare: 0.17,
      hat: 0.16,
      missing: 0.44
    }
  });
  assert.equal(config.trackDefaultVelocities.kick, 0.9);
  assert.equal(config.trackDefaultVelocities.snare, 0.17);
  assert.equal(config.trackDefaultVelocities.hat, undefined);
  assert.equal(config.trackDefaultVelocities.missing, undefined);
});

test("normalizeRhythmConfig stores an editable default note preset", () => {
  const config = normalizeRhythmConfig({
    defaultNote: {
      instrument: "missing",
      velocity: 4,
      options: {
        pitch: 200,
        attackMs: 44,
        dubEcho: 0.31,
        delaySend: 0.4,
        reverbSend: 0.2
      }
    }
  });

  assert.equal(config.defaultNote.instrument, DEFAULT_NOTE_INSTRUMENT);
  assert.equal(config.defaultNote.velocity, 0.9);
  assert.equal(config.defaultNote.options.pitch, 94);
  assert.equal(config.defaultNote.options.attackMs, 44);
  assert.equal(config.defaultNote.options.dubEcho, 0.31);
  assert.equal(config.defaultNote.options.delaySend, 0.4);
  assert.equal(config.defaultNote.options.reverbSend, 0.2);
});

test("effectiveStepOptionsForTrack lets note options override track defaults", () => {
  const config = {
    trackOptionDefaults: {
      kick: normalizeTrackOptionDefaults({ offsetMs: 20, attackMs: 55, delaySend: 0.4 })
    }
  };
  const options = effectiveStepOptionsForTrack(config, "kick", { attackMs: 8, reverbSend: 0.2 });
  assert.equal(options.offsetMs, 20);
  assert.equal(options.attackMs, 8);
  assert.equal(options.delaySend, 0.4);
  assert.equal(options.reverbSend, 0.2);
});

test("normalizeRhythmConfig preserves MIDI maps", () => {
  const config = normalizeRhythmConfig({
    midiNoteMap: {
      kick: 36,
      "sampler~abc": 48,
      missing: 50,
      snare: 200
    },
    midiControlMap: {
      "selected.velocity": {
        kind: "cc",
        channel: 2,
        controller: 74,
        label: "Volume"
      },
      "selected.chord.maj": {
        kind: "note",
        noteNumber: 60,
        label: "Chord"
      },
      bad: {
        kind: "unknown"
      }
    }
  });
  assert.deepEqual(config.midiNoteMap, {
    kick: 36,
    "sampler~abc": 48
  });
  assert.deepEqual(config.midiControlMap["selected.velocity"], {
    kind: "cc",
    channel: 2,
    controller: 74,
    noteNumber: 0,
    label: "Volume"
  });
  assert.deepEqual(config.midiControlMap["selected.chord.maj"], {
    kind: "note",
    channel: 1,
    controller: 0,
    noteNumber: 60,
    label: "Chord"
  });
  assert.equal(config.midiControlMap.bad, undefined);
});

test("normalizeRhythmConfig clamps arrangement and metronome settings", () => {
  const config = normalizeRhythmConfig({
    barsPerVerse: 999,
    barsPerSection: 0,
    timeSignature: "3/4",
    metronomeEnabled: true,
    metronomeVolume: 2
  });
  assert.equal(config.barsPerVerse, 64);
  assert.equal(config.barsPerSection, 1);
  assert.equal(config.timeSignature, "3/4");
  assert.equal(config.metronomeEnabled, 1);
  assert.equal(config.metronomeVolume, 1);
});

test("normalizeTimeSignature accepts common meters and rejects unusable values", () => {
  assert.equal(normalizeTimeSignature("7/8"), "7/8");
  assert.equal(normalizeTimeSignature("3/4"), "3/4");
  assert.equal(normalizeTimeSignature("bad"), "4/4");
  assert.equal(normalizeTimeSignature("17/4"), "4/4");
});

test("metronome beat events follow the selected time signature", () => {
  assert.deepEqual(metronomeBeatEventsForStep(0, 16, "4/4"), [
    { beatIndex: 0, accent: true, offsetSteps: 0 }
  ]);
  assert.deepEqual(metronomeBeatEventsForStep(4, 16, "4/4"), [
    { beatIndex: 1, accent: false, offsetSteps: 0 }
  ]);
  const secondBeat = metronomeBeatEventsForStep(5, 16, "3/4");
  assert.equal(secondBeat.length, 1);
  assert.equal(secondBeat[0].beatIndex, 1);
  assert.equal(secondBeat[0].accent, false);
  assert.ok(Math.abs(secondBeat[0].offsetSteps - 1 / 3) < 0.000001);
  const thirdBeat = metronomeBeatEventsForStep(10, 16, "3/4");
  assert.equal(thirdBeat.length, 1);
  assert.equal(thirdBeat[0].beatIndex, 2);
  assert.equal(thirdBeat[0].accent, false);
  assert.ok(Math.abs(thirdBeat[0].offsetSteps - 2 / 3) < 0.000001);
});

test("normalizeRhythmConfig preserves browser-reloadable loop tracks only", () => {
  const config = normalizeRhythmConfig({
    loopTracks: [
      {
        id: "loop_a",
        name: "Break",
        barsInFile: 4,
        source: "bundled-sample",
        url: "./assets/audio/sample-pack/loops/ra_loop_01_118bpm.wav",
        root: "crate",
        path: "break.wav",
        regions: [{ bar: 1.25, len: 0.5, gain: 1.4, chops: 6, sliceSensitivity: 0.2, mode: "stretch", srcStartFrac: 0.1, srcEndFrac: 0.8 }]
      },
      {
        id: "loop_handle",
        name: "Handle Break",
        barsInFile: 2,
        source: "browser-file-handle",
        handleId: "fh_123",
        path: "Handle Break.wav",
        regions: [{ bar: 0, len: 1 }]
      },
      {
        id: "loop_relink",
        name: "Safari Break",
        barsInFile: 2,
        source: "local-file",
        relinkRequired: true,
        path: "Safari Break.wav",
        regions: [{ bar: 0, len: 1 }]
      },
      {
        id: "loop_blob",
        name: "Temporary",
        barsInFile: 2,
        url: "blob:http://localhost:3000/not-real",
        regions: [{ bar: 0, len: 1 }]
      }
    ]
  });

  assert.equal(config.loopTracks.length, 3);
  assert.equal(config.loopTracks[0].id, "loop_a");
  assert.equal(config.loopTracks[0].url, "./assets/audio/sample-pack/loops/ra_loop_01_118bpm.wav");
  assert.equal(config.loopTracks[0].regions[0].bar, 1.25);
  assert.equal(config.loopTracks[0].regions[0].mode, "stretch");
  assert.equal(config.loopTracks[1].handleId, "fh_123");
  assert.equal(config.loopTracks[2].relinkRequired, true);
});
