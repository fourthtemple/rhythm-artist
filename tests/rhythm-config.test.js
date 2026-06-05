import test from "node:test";
import assert from "node:assert/strict";
import {
  metronomeBeatEventsForStep,
  normalizeRhythmConfig,
  normalizeTimeSignature,
  normalizeTrackStepCount
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
