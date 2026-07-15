import test from "node:test";
import assert from "node:assert/strict";

import { createHitData } from "../src/audio/hit-data.js";
import { commitHitEntry, readStoredHit } from "../src/audio/pattern-hits.js";

const clamp = (value, min, max, fallback = 0) => {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
};

const normalizeStepOptions = (options = {}) => ({ pitch: 0, pianoRoll: 0, ...options });

test("deferred hit writes patch the engine without full editor apply", () => {
  const state = {
    activeBar: 0,
    intensity: 0.5,
    config: {
      generatedRowsEditable: 1,
      patterns: {
        jazz: {
          bars: [{ kick: [] }]
        }
      }
    }
  };
  let applyCount = 0;
  let historyCount = 0;
  let enginePatch = null;
  const hitData = createHitData({
    state,
    PATTERN_ROW_IDS: new Set(["kick"]),
    ROW_LABELS: {},
    clamp,
    normalizeStepOptions,
    readStoredHit,
    commitHitEntry,
    generatedSynthEventsForStep: () => [],
    applyConfig: () => { applyCount += 1; },
    applyHitToEngine: (patch) => { enginePatch = patch; },
    pushEditHistory: () => { historyCount += 1; }
  });

  hitData.setHitData("kick", 3, {
    velocity: 0.72,
    options: { pitch: 9, pianoRoll: 1 },
    deferApply: true,
    skipHistory: true
  }, 0);

  assert.equal(applyCount, 0);
  assert.equal(historyCount, 0);
  assert.equal(state.config.patterns.jazz.bars[0].kick.length, 1);
  assert.deepEqual(enginePatch, {
    hit: "kick",
    step: 3,
    barIndex: 0,
    entry: {
      step: 3,
      velocity: 0.72,
      options: { pitch: 9, pianoRoll: 1 },
      generated: false,
      label: ""
    }
  });
});
