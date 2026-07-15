import test from "node:test";
import assert from "node:assert/strict";

import { RhythmEngine } from "../src/audio/rhythm-engine.js";

test("currentPlaybackPosition uses the audible beat queue, not the future scheduler cursor", () => {
  const engine = new RhythmEngine();
  engine.context = { currentTime: 10.125 };
  engine.rememberScheduledBeat({ phraseBar: 0, step: 2, scheduledTime: 10, stepDuration: 0.25 });
  engine.rememberScheduledBeat({ phraseBar: 0, step: 3, scheduledTime: 10.25, stepDuration: 0.25 });
  engine.nextStep = 6;
  engine.nextStepTime = 11;

  const position = engine.currentPlaybackPosition();

  assert.equal(position.phraseBar, 0);
  assert.equal(position.step, 2.5);
  assert.equal(position.absStep, 2.5);
});

test("currentPlaybackPosition records at the first scheduled beat before audio starts", () => {
  const engine = new RhythmEngine();
  engine.context = { currentTime: 9.95 };
  engine.rememberScheduledBeat({ phraseBar: 0, step: 0, scheduledTime: 10, stepDuration: 0.25 });

  const position = engine.currentPlaybackPosition();

  assert.equal(position.phraseBar, 0);
  assert.equal(position.step, 0);
  assert.equal(position.absStep, 0);
});

test("piano-roll playback frequencies use the same chromatic pitch offset as preview", () => {
  const engine = new RhythmEngine();
  const c4Offset = 60 - 33;
  const [root, majorThird] = engine.chordFrequenciesForOptions({
    pitch: c4Offset,
    chordIntervals: [0, 4]
  });

  assert.ok(Math.abs(root - 261.625565) < 0.001);
  assert.ok(Math.abs(majorThird - 329.627557) < 0.001);
});

test("pitched audition routes through the editable track note renderer", () => {
  const engine = new RhythmEngine();
  const calls = [];
  engine.context = { currentTime: 3 };
  engine.playEditableGeneratedTrackNote = (...args) => calls.push(args);

  engine.auditionPitchedTrackNow("bass", 7, {
    gain: 0.5,
    pressure: 0.2,
    chordIntervals: [0, 4],
    step: 6,
    phraseBar: 1,
    style: "jazz"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "bass");
  assert.equal(calls[0][1], 3.012);
  assert.deepEqual(calls[0][2], {
    step: 6,
    phraseBar: 1,
    style: "jazz",
    velocity: 0.5,
    optionsRaw: {
      pitch: 7,
      chordIntervals: [0, 4],
      pressure: 0.2,
      attackMs: 11,
      reverbSend: 0.08,
      durationSteps: 1,
      pianoRoll: 1
    }
  });
});

test("pitched audition preserves selected note options", () => {
  const engine = new RhythmEngine();
  const calls = [];
  engine.context = { currentTime: 3 };
  engine.playEditableGeneratedTrackNote = (...args) => calls.push(args);

  engine.auditionPitchedTrackNow("pluck", 12, {
    gain: 0.42,
    pressure: 0.35,
    chordIntervals: [0, 7],
    step: 4,
    phraseBar: 2,
    style: "jazz",
    durationSteps: 3,
    optionsRaw: {
      attackMs: 24,
      offsetMs: -8,
      dubEcho: 0.3,
      reverbSend: 0.44
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "pluck");
  assert.deepEqual(calls[0][2].optionsRaw, {
    attackMs: 24,
    offsetMs: -8,
    dubEcho: 0.3,
    reverbSend: 0.44,
    pitch: 12,
    chordIntervals: [0, 7],
    pressure: 0.35,
    durationSteps: 3,
    pianoRoll: 1
  });
});

test("scheduled editable rows route through the editable track note renderer", () => {
  const engine = new RhythmEngine();
  const calls = [];
  engine.context = { currentTime: 3 };
  engine.activeStepDurationSeconds = 0.25;
  engine.config.generatedRowsEditable = 1;
  engine.playEditableGeneratedTrackNote = (...args) => calls.push(args);

  engine.scheduleEditableGeneratedRows({
    pluck: [[6, 0.5, { pitch: 7, pianoRoll: 1 }]]
  }, 6, 10, 2, "jazz");

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "pluck");
  assert.equal(calls[0][1], 10);
  assert.deepEqual(calls[0][2], {
    step: 6,
    phraseBar: 2,
    style: "jazz",
    velocity: 0.5,
    optionsRaw: { pitch: 7, pianoRoll: 1 }
  });
});

test("editable bass rows route through the editable track note renderer", () => {
  const engine = new RhythmEngine();
  const calls = [];
  engine.context = { currentTime: 3 };
  engine.activeStepDurationSeconds = 0.25;
  engine.config.generatedRowsEditable = 1;
  engine.playEditableGeneratedTrackNote = (...args) => calls.push(args);

  engine.scheduleSequencedBassStep({
    bass: [[6, 0.5, { pitch: 7, pianoRoll: 1 }]]
  }, 6, 10, 2, "jazz");

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "bass");
  assert.equal(calls[0][1], 10);
  assert.deepEqual(calls[0][2], {
    step: 6,
    phraseBar: 2,
    style: "jazz",
    velocity: 0.5,
    optionsRaw: { pitch: 7, pianoRoll: 1 }
  });
});

test("plugin instrument rows are not also played by the generic sample loop", () => {
  const pluginTrack = "plugin__vl1-emulator";
  const engine = new RhythmEngine();
  let instrumentCalls = 0;
  let sampleCalls = 0;
  engine.context = { currentTime: 3 };
  engine.activePatternStyle = "jazz";
  engine.activeStepDurationSeconds = 0.25;
  engine.config.generatedRowsEditable = 1;
  engine.patterns = {
    jazz: {
      swing: 0,
      bars: [{
        [pluginTrack]: [[0, 0.5, { pitch: 7, pianoRoll: 1 }]]
      }]
    }
  };
  engine.scheduleMetronomeStep = () => {};
  engine.scheduleSynthStep = () => {};
  engine.playEditableGeneratedTrackNote = () => { instrumentCalls += 1; };
  engine.playHit = () => { sampleCalls += 1; };

  engine.scheduleStep(0, 10);

  assert.equal(instrumentCalls, 1);
  assert.equal(sampleCalls, 0);
});

test("plugin fallback profiles use plugin ids even before catalog hydration", () => {
  const engine = new RhythmEngine();

  assert.equal(engine.pluginFallbackProfile("plugin__so-404"), "bass");
  assert.equal(engine.pluginFallbackProfile("plugin__mda_dx10"), "fm");
  assert.equal(engine.pluginFallbackProfile("plugin__mda_epiano"), "piano");
  assert.equal(engine.pluginFallbackProfile("plugin__geonkick"), "kick");
  assert.equal(engine.pluginFallbackProfile("plugin__vl1-emulator"), "weird");
});

test("plugin fallback profiles use hydrated catalog names when available", () => {
  const engine = new RhythmEngine({
    config: {
      trackPluginSources: {
        plugin__custom_organ: {
          id: "wadspa:custom",
          slug: "custom",
          name: "ADLplug Organ Model",
          kind: "instrument"
        }
      }
    }
  });

  assert.equal(engine.pluginFallbackProfile("plugin__custom_organ"), "organ");
});
