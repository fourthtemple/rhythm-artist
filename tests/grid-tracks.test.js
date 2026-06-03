// Unit tests for the pure grid-track id logic. `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import {
  orderGridTrackIds,
  reconcileGridTrackIds,
  instanceLabelFor,
  removeTrackFromConfigMaps,
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
    other: { keep: true }
  };
  const next = removeTrackFromConfigMaps(config, "clap~a1");
  assert.notEqual(next, config);
  assert.equal(next.trackLevels["clap~a1"], undefined);
  assert.equal(next.trackPans["clap~a1"], undefined);
  assert.equal(next.trackLevels.kick, 1);
  // Original is untouched.
  assert.equal(config.trackLevels["clap~a1"], 0.5);
});

test("TRACK_CONFIG_MAP_KEYS lists the seven per-track maps", () => {
  assert.deepEqual(TRACK_CONFIG_MAP_KEYS, [
    "trackShapes",
    "trackBusSends",
    "trackReverbSends",
    "trackLevels",
    "trackPans",
    "trackSamples",
    "trackStepCounts"
  ]);
});
