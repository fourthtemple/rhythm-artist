import test from "node:test";
import assert from "node:assert/strict";

import {
  createBlankRhythmConfig,
  DEFAULT_GRID_TRACK_IDS
} from "../src/audio/rhythm-config.js";
import {
  createHostedBlankRhythmConfig,
  shouldStartWithBlankProject
} from "../src/ui/config-file.js";

test("hosted Rhythm Artist starts with a blank project", () => {
  assert.equal(shouldStartWithBlankProject({
    protocol: "https:",
    hostname: "fourthtemple.github.io",
    pathname: "/rhythm-artist/"
  }), true);
});

test("local development keeps its configured startup project", () => {
  assert.equal(shouldStartWithBlankProject({
    protocol: "http:",
    hostname: "127.0.0.1",
    pathname: "/"
  }), false);
});

test("hosted blank project has no visible default tracks", () => {
  const config = createHostedBlankRhythmConfig();

  assert.deepEqual(config.trackViewTrackIds, []);
  assert.deepEqual(config.pianoRollTracks, []);
  assert.deepEqual(config.loopTracks, []);
  assert.deepEqual(config.hiddenGridTrackIds, DEFAULT_GRID_TRACK_IDS);
});

test("new blank projects have no visible default tracks", () => {
  const config = createBlankRhythmConfig();

  assert.deepEqual(config.trackViewTrackIds, []);
  assert.deepEqual(config.pianoRollTracks, []);
  assert.deepEqual(config.loopTracks, []);
  assert.deepEqual(config.hiddenGridTrackIds, DEFAULT_GRID_TRACK_IDS);
});
