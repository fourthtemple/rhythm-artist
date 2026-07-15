import test from "node:test";
import assert from "node:assert/strict";

import { normalizeRhythmConfig } from "../src/audio/rhythm-config.js";
import {
  baseTrackId,
  getTrackDef,
  isPluginTrackId,
  pluginTrackIdFor
} from "../src/audio/rhythm-track-registry.js";

test("plugin instrument ids resolve as editable generated tracks", () => {
  const trackId = pluginTrackIdFor({ id: "wadspa:amsynth", name: "amsynth" });
  const def = getTrackDef(trackId);

  assert.equal(trackId, "plugin__amsynth");
  assert.equal(isPluginTrackId(trackId), true);
  assert.equal(baseTrackId(trackId), trackId);
  assert.equal(def?.group, "plugins");
  assert.equal(def?.voice, "plugin");
  assert.equal(def?.kind, "generated");
});

test("normalization keeps plugin piano-roll lanes and labels", () => {
  const trackId = pluginTrackIdFor({ id: "wadspa:adlplug", name: "ADLplug" });
  const config = normalizeRhythmConfig({
    patterns: {
      jazz: {
        bpm: 118,
        bars: [
          { [trackId]: [{ step: 2, velocity: 0.5, options: { pianoRoll: 1, pitch: 7 } }] },
          { [trackId]: [] }
        ]
      }
    },
    trackViewTrackIds: [trackId],
    pianoRollTracks: [trackId],
    editorLaneOrder: [`piano:${trackId}`],
    trackPluginSources: {
      [trackId]: {
        id: "wadspa:adlplug",
        slug: "adlplug",
        label: "ADLplug",
        name: "ADLplug",
        kind: "instrument",
        assetPath: "plugins/adlplug",
        processorFile: "processor.js",
        wasmFile: "ADLplug.wasm",
        midiInputs: 1,
        audioOutputs: 2,
        controlInputs: 12,
        parameters: [
          { index: 3, symbol: "gain", name: "Gain", min: 0, max: 1, default: 0.5 },
          { index: 4, symbol: "wave", name: "Wave", min: 0, max: 4, default: 2, integer: true, enumeration: true, scalePoints: [
            { label: "Sine", value: 0 },
            { label: "Saw", value: 1 }
          ] },
          { index: 5, symbol: "attack", name: "Attack", min: 0.001, max: 15, default: 0.1, logarithmic: true }
        ]
      }
    },
    trackPluginParams: {
      [trackId]: { gain: 0.75, wave: 9 }
    }
  });

  assert.deepEqual(config.trackViewTrackIds, [trackId]);
  assert.deepEqual(config.pianoRollTracks, [trackId]);
  assert.deepEqual(config.editorLaneOrder, [`piano:${trackId}`]);
  assert.equal(config.trackPluginSources[trackId].assetPath, "plugins/adlplug");
  assert.equal(config.trackPluginSources[trackId].processorFile, "processor.js");
  assert.equal(config.trackPluginSources[trackId].wasmFile, "ADLplug.wasm");
  assert.equal(config.trackPluginSources[trackId].name, "ADLplug");
  assert.equal(config.trackPluginSources[trackId].parameters.length, 3);
  assert.equal(config.trackPluginSources[trackId].parameters[0].index, 3);
  assert.deepEqual(config.trackPluginSources[trackId].parameters[1].scalePoints, [
    { label: "Sine", value: 0 },
    { label: "Saw", value: 1 }
  ]);
  assert.equal(config.trackPluginSources[trackId].parameters[2].logarithmic, true);
  assert.equal(config.trackPluginParams[trackId].gain, 0.75);
  assert.equal(config.trackPluginParams[trackId].wave, 4);
  assert.equal(config.patterns.jazz.bars[0][trackId][0][2].pianoRoll, 1);
});
