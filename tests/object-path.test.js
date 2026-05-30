// Unit tests for the pure object-path helpers. `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import { getPathValue, setPathValue } from "../src/lib/object-path.js";

test("getPathValue reads a nested value", () => {
  const root = { patterns: { jazz: { bpm: 120 } } };
  assert.equal(getPathValue(root, "patterns.jazz.bpm"), 120);
});

test("getPathValue returns undefined for a missing segment", () => {
  assert.equal(getPathValue({ a: {} }, "a.b.c"), undefined);
});

test("setPathValue mutates the nested value in place", () => {
  const root = { patterns: { jazz: { bpm: 120 } } };
  const result = setPathValue(root, "patterns.jazz.bpm", 90);
  assert.equal(root.patterns.jazz.bpm, 90);
  assert.equal(result, root);
});
