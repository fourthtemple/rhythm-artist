// Unit tests for camera-mode playback window anchoring. `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import { cameraAnchorForBar, cameraViewStartForPosition } from "../src/ui/transport.js";

test("cameraAnchorForBar centers the phrase bar when possible", () => {
  assert.equal(cameraAnchorForBar(10, 4, 32), 8);
  assert.equal(cameraAnchorForBar(10, 3, 32), 8);
});

test("cameraAnchorForBar clamps at song edges", () => {
  assert.equal(cameraAnchorForBar(0, 4, 32), 0);
  assert.equal(cameraAnchorForBar(31, 4, 32), 28);
});

test("cameraAnchorForBar respects the active loop range", () => {
  assert.equal(cameraAnchorForBar(14, 4, 32, 8, 8), 12);
  assert.equal(cameraAnchorForBar(20, 4, 32, 8, 8), null);
});

test("cameraAnchorForBar keeps end loops inside the song", () => {
  assert.equal(cameraAnchorForBar(31, 8, 32, 30, 2), 24);
});

test("cameraViewStartForPosition preserves fractional camera movement", () => {
  assert.equal(cameraViewStartForPosition(10.5, 4, 32), 8.5);
  assert.equal(cameraViewStartForPosition(10, 3, 32), 8.5);
  assert.equal(cameraAnchorForBar(10.5, 4, 32), 8);
});
