// Unit tests for the pure grid-track id logic. `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import {
  orderGridTrackIds,
  reconcileGridTrackIds,
  instanceLabelFor,
  removeTrackFromConfigMaps,
  replaceTrackIdInConfig,
  TRACK_CONFIG_MAP_KEYS
} from "../src/audio/grid-tracks.js";

// A tiny synthetic registry: three base voices, one instanceable.
const registryIds = ["kick", "snare", "clap"];
const INSTANCE_SEP = "~";
const isInstanceId = (id) => id.includes(INSTANCE_SEP);
const baseTrackId = (id) => (isInstanceId(id) ? id.split(INSTANCE_SEP)[0] : id);
const defs = { kick: { id: "kick" }, snare: { id: "snare" }, clap: { id: "clap", instanceable: true } };
const getTrackDef = (id) => defs[baseTrackId(id)] ?? null;
const orderDeps = { registryIds, baseTrackId, isInstanceId };

test("orderGridTrackIds sorts by registry order", () => {
  assert.deepEqual(
    orderGridTrackIds(["clap", "kick", "snare"], orderDeps),
    ["kick", "snare", "clap"]
  );
});

test("orderGridTrackIds keeps instances right after their base", () => {
  const out = orderGridTrackIds(["clap~b2", "kick", "clap", "clap~a1"], orderDeps);
  assert.deepEqual(out, ["kick", "clap", "clap~a1", "clap~b2"]);
});

test("orderGridTrackIds sinks unknown ids to the end", () => {
  const out = orderGridTrackIds(["mystery", "kick"], orderDeps);
  assert.deepEqual(out, ["kick", "mystery"]);
});

test("orderGridTrackIds returns a new array (no mutation)", () => {
  const input = ["snare", "kick"];
  const out = orderGridTrackIds(input, orderDeps);
  assert.notEqual(out, input);
  assert.deepEqual(input, ["snare", "kick"]);
});

test("reconcileGridTrackIds keeps defaults plus tracks with notes", () => {
  const config = {
    patterns: { jazz: { bars: [{ kick: [{ step: 0 }], clap: [] }] } }
  };
  const out = reconcileGridTrackIds(config, {
    registryIds,
    defaultIds: ["kick", "snare"],
    isInstanceId,
    getTrackDef,
    baseTrackId
  });
  // clap has an empty array (no notes) so it is not surfaced.
  assert.deepEqual(out, ["kick", "snare"]);
});

test("reconcileGridTrackIds honors user-hidden default tracks", () => {
  const config = {
    patterns: { jazz: { bars: [{ kick: [{ step: 0 }], snare: [{ step: 4 }] }] } }
  };
  const out = reconcileGridTrackIds(config, {
    registryIds,
    defaultIds: ["kick", "snare"],
    hiddenIds: ["kick"],
    isInstanceId,
    getTrackDef,
    baseTrackId
  });
  assert.deepEqual(out, ["snare"]);
});

test("reconcileGridTrackIds surfaces instance tracks from bars and maps", () => {
  const config = {
    patterns: { jazz: { bars: [{ "clap~a1": [{ step: 1 }] }] } },
    trackLevels: { "clap~b2": 0.8 }
  };
  const out = reconcileGridTrackIds(config, {
    registryIds,
    defaultIds: ["kick"],
    isInstanceId,
    getTrackDef,
    baseTrackId
  });
  assert.deepEqual(out, ["kick", "clap~a1", "clap~b2"]);
});

test("instanceLabelFor returns the base label for non-instances", () => {
  const label = instanceLabelFor("clap", ["clap"], {
    trackLabels: { clap: "Clap" }, baseTrackId, isInstanceId
  });
  assert.equal(label, "Clap");
});

test("instanceLabelFor numbers instances by peer position", () => {
  const grid = ["clap", "clap~a1", "clap~b2"];
  const deps = { trackLabels: { clap: "Clap" }, baseTrackId, isInstanceId };
  assert.equal(instanceLabelFor("clap~a1", grid, deps), "Clap 2");
  assert.equal(instanceLabelFor("clap~b2", grid, deps), "Clap 3");
});

test("removeTrackFromConfigMaps drops the id from every map immutably", () => {
  const config = {
    trackLevels: { kick: 1, "clap~a1": 0.5 },
    trackPans: { "clap~a1": -0.3 },
    trackOptionDefaults: { "clap~a1": { offsetMs: 12 } },
    other: { keep: true }
  };
  const next = removeTrackFromConfigMaps(config, "clap~a1");
  assert.notEqual(next, config);
  assert.equal(next.trackLevels["clap~a1"], undefined);
  assert.equal(next.trackPans["clap~a1"], undefined);
  assert.equal(next.trackOptionDefaults["clap~a1"], undefined);
  assert.equal(next.trackLevels.kick, 1);
  // Original is untouched.
  assert.equal(config.trackLevels["clap~a1"], 0.5);
});

test("TRACK_CONFIG_MAP_KEYS lists the per-track maps", () => {
  assert.deepEqual(TRACK_CONFIG_MAP_KEYS, [
    "trackShapes",
    "trackBusSends",
    "trackReverbSends",
    "trackLevels",
    "trackPans",
    "trackOptionDefaults",
    "trackDefaultVelocities",
    "trackSamples",
    "trackStepCounts"
  ]);
});

test("replaceTrackIdInConfig moves track data and editor references", () => {
  const config = {
    patterns: { jazz: { bars: [
      { kick: [[0, 0.5]], "clap~a1": [[4, 0.2]] },
      { kick: [[8, 0.4]], snare: [] }
    ] } },
    trackLevels: { kick: 0.7 },
    trackPans: { kick: -0.2 },
    trackOptionDefaults: { kick: { offsetMs: 12, delaySend: 0.3 } },
    trackSamples: { kick: { label: "dusty kick" } },
    trackStepCounts: { kick: 12 },
    trackViewTrackIds: ["kick", "snare"],
    hiddenGridTrackIds: ["kick"],
    pianoRollTracks: ["kick"],
    editorLaneOrder: ["grid:kick", "piano:kick", "wave:loop_a"],
    pianoRollLaneHeights: { kick: 144 },
    pianoRollAutomationHeights: { kick: 48 },
    midiNoteMap: { kick: 36 },
    midiControlMap: {
      "track.kick.level": { kind: "cc", controller: 7 },
      "selected.velocity": { kind: "cc", controller: 74 }
    },
    soloTracks: ["kick"],
    mutedTracks: ["kick", "snare"]
  };

  const next = replaceTrackIdInConfig(config, "kick", "clap~a1");

  assert.notEqual(next, config);
  assert.deepEqual(next.patterns.jazz.bars[0]["clap~a1"], [[4, 0.2], [0, 0.5]]);
  assert.equal(next.patterns.jazz.bars[0].kick, undefined);
  assert.deepEqual(next.patterns.jazz.bars[1]["clap~a1"], [[8, 0.4]]);
  assert.equal(next.trackLevels["clap~a1"], 0.7);
  assert.equal(next.trackPans["clap~a1"], -0.2);
  assert.deepEqual(next.trackOptionDefaults["clap~a1"], { offsetMs: 12, delaySend: 0.3 });
  assert.deepEqual(next.trackSamples["clap~a1"], { label: "dusty kick" });
  assert.equal(next.trackStepCounts["clap~a1"], 12);
  assert.deepEqual(next.trackViewTrackIds, ["clap~a1", "snare"]);
  assert.deepEqual(next.hiddenGridTrackIds, ["clap~a1"]);
  assert.deepEqual(next.pianoRollTracks, ["clap~a1"]);
  assert.deepEqual(next.editorLaneOrder, ["grid:clap~a1", "piano:clap~a1", "wave:loop_a"]);
  assert.equal(next.pianoRollLaneHeights["clap~a1"], 144);
  assert.equal(next.pianoRollAutomationHeights["clap~a1"], 48);
  assert.equal(next.midiNoteMap["clap~a1"], 36);
  assert.equal(next.midiControlMap["track.clap~a1.level"].controller, 7);
  assert.equal(next.midiControlMap["selected.velocity"].controller, 74);
  assert.deepEqual(next.soloTracks, ["clap~a1"]);
  assert.deepEqual(next.mutedTracks, ["clap~a1", "snare"]);
  assert.equal(config.trackLevels.kick, 0.7);
});
