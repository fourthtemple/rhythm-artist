import assert from "node:assert/strict";
import test from "node:test";

import { parseMidiMessageData } from "../src/ui/midi/web-midi-input.js";

test("parseMidiMessageData normalizes note on velocity", () => {
  const message = parseMidiMessageData([0x90, 60, 127], { manufacturer: "Akai", name: "MPK" });
  assert.equal(message.kind, "noteon");
  assert.equal(message.channel, 1);
  assert.equal(message.noteNumber, 60);
  assert.equal(message.velocityRaw, 127);
  assert.equal(message.velocity, 0.9);
  assert.equal(message.inputName, "Akai MPK");
});

test("parseMidiMessageData treats zero velocity note on as note off", () => {
  const message = parseMidiMessageData([0x91, 61, 0]);
  assert.equal(message.kind, "noteoff");
  assert.equal(message.channel, 2);
  assert.equal(message.noteNumber, 61);
  assert.equal(message.velocity, 0);
});

test("parseMidiMessageData normalizes note off", () => {
  const message = parseMidiMessageData([0x82, 62, 64]);
  assert.equal(message.kind, "noteoff");
  assert.equal(message.channel, 3);
  assert.equal(message.noteNumber, 62);
});

test("parseMidiMessageData normalizes control changes", () => {
  const message = parseMidiMessageData([0xb0, 74, 64]);
  assert.equal(message.kind, "controlchange");
  assert.equal(message.controller, 74);
  assert.equal(message.valueRaw, 64);
  assert.equal(message.value, 64 / 127);
});

test("parseMidiMessageData normalizes pressure messages", () => {
  const poly = parseMidiMessageData([0xa0, 60, 32]);
  assert.equal(poly.kind, "polypressure");
  assert.equal(poly.scoped, "note");
  assert.equal(poly.noteNumber, 60);
  assert.equal(poly.pressure, 32 / 127);

  const channel = parseMidiMessageData([0xd3, 100]);
  assert.equal(channel.kind, "channelpressure");
  assert.equal(channel.channel, 4);
  assert.equal(channel.scoped, "channel");
  assert.equal(channel.pressure, 100 / 127);
});

test("parseMidiMessageData normalizes pitch bend around center", () => {
  const center = parseMidiMessageData([0xe0, 0x00, 0x40]);
  assert.equal(center.kind, "pitchbend");
  assert.equal(center.valueRaw, 8192);
  assert.equal(center.value, 0);

  const low = parseMidiMessageData([0xe0, 0x00, 0x00]);
  assert.equal(low.value, -1);
});
