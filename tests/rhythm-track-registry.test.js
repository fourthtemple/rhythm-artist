import assert from "node:assert/strict";
import test from "node:test";
import { TRACK_BY_ID } from "../src/audio/rhythm-track-registry.js";

test("synth instruments can create independent instrument rows", () => {
  ["bass", "pluck", "funk", "pad", "whale"].forEach((id) => {
    assert.equal(TRACK_BY_ID[id]?.instanceable, true, `${id} should be instanceable`);
  });
});
