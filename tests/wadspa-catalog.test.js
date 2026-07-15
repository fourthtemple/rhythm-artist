import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyWadspaPlugin,
  compactParameters,
  extractMetaObject
} from "../scripts/generate-wadspa-catalog.mjs";

test("extracts WADSPA plugin metadata from generated bundle source", () => {
  const meta = extractMetaObject(`
    export { default } from "./Plugin.js";
    export const meta = {
      "uri": "urn:test",
      "label": "test",
      "name": "Test Plugin",
      "ports": [
        { "symbol": "midi_in", "dir": "input", "type": "midi" },
        { "symbol": "out", "dir": "output", "type": "audio" }
      ]
    };
    export const wasmUrl = new URL("./Plugin.wasm", import.meta.url).href;
  `);

  assert.equal(meta.name, "Test Plugin");
  assert.equal(meta.ports.length, 2);
});

test("classifies MIDI audio-output WADSPA plugins as instruments", () => {
  const classification = classifyWadspaPlugin({
    ports: [
      { dir: "input", type: "midi" },
      { dir: "output", type: "audio" },
      { dir: "output", type: "audio" },
      { dir: "input", type: "control" }
    ]
  });

  assert.equal(classification.kind, "instrument");
  assert.equal(classification.midiInputs, 1);
  assert.equal(classification.audioOutputs, 2);
});

test("classifies audio in/out WADSPA plugins as effects", () => {
  const classification = classifyWadspaPlugin({
    ports: [
      { dir: "input", type: "audio" },
      { dir: "output", type: "audio" },
      { dir: "input", type: "control" }
    ]
  });

  assert.equal(classification.kind, "effect");
  assert.equal(classification.audioInputs, 1);
  assert.equal(classification.controlInputs, 1);
});

test("catalog keeps all control parameters and WADSPA scale points", () => {
  const meta = {
    ports: [
      { symbol: "midi_in", dir: "input", type: "midi" },
      { symbol: "out", dir: "output", type: "audio" },
      { symbol: "MODE", name: "Mode", dir: "input", type: "control", min: 0, max: 2, default: 1, integer: true, enumeration: true, scalePoints: [
        { label: "Sine", value: 0 },
        { label: "Saw", value: 1 },
        { label: "Square", value: 2 }
      ] },
      { symbol: "ENV_A", name: "Attack", dir: "input", type: "control", min: 0.001, max: 15, default: 0.1, logarithmic: true },
      ...Array.from({ length: 12 }, (_, index) => ({
        symbol: `P${index}`,
        dir: "input",
        type: "control",
        min: 0,
        max: 1,
        default: 0
      }))
    ]
  };

  const parameters = compactParameters(meta);

  assert.equal(parameters.length, 14);
  assert.deepEqual(parameters[0].scalePoints, [
    { label: "Sine", value: 0 },
    { label: "Saw", value: 1 },
    { label: "Square", value: 2 }
  ]);
  assert.equal(parameters[1].logarithmic, true);
});
