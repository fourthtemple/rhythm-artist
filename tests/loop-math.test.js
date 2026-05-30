// Unit tests for the pure loop/bar arithmetic. `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import {
  loopCountFor,
  localBarIndex,
  loopIndexForBar,
  loopStartBar,
  clampLoopStart,
  barLabel
} from "../src/audio/loop-math.js";

const LOOP = 8;
const MAX = 8;

test("loopCountFor is at least one and rounds up", () => {
  assert.equal(loopCountFor(0, LOOP), 1);
  assert.equal(loopCountFor(8, LOOP), 1);
  assert.equal(loopCountFor(9, LOOP), 2);
});

test("localBarIndex wraps within the loop", () => {
  assert.equal(localBarIndex(0, LOOP), 0);
  assert.equal(localBarIndex(9, LOOP), 1);
});

test("loopIndexForBar clamps to the legal range", () => {
  assert.equal(loopIndexForBar(0, LOOP, MAX), 0);
  assert.equal(loopIndexForBar(9, LOOP, MAX), 1);
  assert.equal(loopIndexForBar(9999, LOOP, MAX), MAX - 1);
});

test("loopStartBar respects the song length", () => {
  assert.equal(loopStartBar(0, 16, LOOP), 0);
  assert.equal(loopStartBar(1, 16, LOOP), 8);
  assert.equal(loopStartBar(5, 16, LOOP), 8); // only two loops exist
});

test("clampLoopStart keeps a window inside the song", () => {
  assert.equal(clampLoopStart(0, 2, 16), 0);
  assert.equal(clampLoopStart(15, 2, 16), 14);
  assert.equal(clampLoopStart(-3, 1, 16), 0);
});

test("barLabel formats loop.bar with zero padding", () => {
  assert.equal(barLabel(0, LOOP, MAX), "1.01");
  assert.equal(barLabel(9, LOOP, MAX), "2.02");
});
