import test from "node:test";
import assert from "node:assert/strict";
import { createRowSelection } from "../src/ui/row-selection.js";

function makeControl(value = "0") {
  return {
    disabled: false,
    max: "",
    min: "",
    value: String(value)
  };
}

function makeOutput(text = "") {
  return { textContent: text };
}

function makeHarness() {
  const controls = {
    selectedVelocity: makeControl("0.8"),
    selectedVelocityNumber: makeControl("0.8"),
    selectedVelocityValue: makeOutput("0.80"),
    selectedPitch: makeControl("7"),
    selectedPitchNumber: makeControl("7"),
    selectedPitchValue: makeOutput("+7"),
    selectedOffset: makeControl("4"),
    selectedOffsetNumber: makeControl("4"),
    selectedOffsetValue: makeOutput("4ms"),
    selectedAttack: makeControl("18"),
    selectedAttackNumber: makeControl("18"),
    selectedAttackValue: makeOutput("18ms"),
    selectedDelay: makeControl("0"),
    selectedDelayNumber: makeControl("0"),
    selectedDelayValue: makeOutput("0ms"),
    selectedWobble: makeControl("0"),
    selectedWobbleNumber: makeControl("0"),
    selectedWobbleValue: makeOutput("0.00"),
    selectedDubEcho: makeControl("0"),
    selectedDubEchoNumber: makeControl("0"),
    selectedDubEchoValue: makeOutput("0.00"),
    selectedNoteDelaySend: makeControl("0"),
    selectedNoteDelaySendNumber: makeControl("0"),
    selectedNoteDelaySendValue: makeOutput("0.00"),
    selectedNoteReverbSend: makeControl("0"),
    selectedNoteReverbSendNumber: makeControl("0"),
    selectedNoteReverbSendValue: makeOutput("0.00")
  };
  const selectedControls = Object.values(controls).filter((item) => "disabled" in item);
  const state = {
    activeBar: 0,
    config: {
      generatedRowsEditable: 1,
      patterns: { jazz: { bars: [{}] } }
    },
    engine: { getPlaybackState: () => ({ playing: false }) },
    gridTrackIds: ["kick", "snare", "hat"],
    intensity: 0.5,
    playheadStep: 0,
    playing: false,
    selected: { hit: "kick", step: 0, mode: "step", bar: 0 },
    selectedTracks: ["kick"],
    soloTracks: new Set(),
    trackAnchor: "kick"
  };
  let hitDataReads = 0;
  let inspectorRenders = 0;
  let explorerRenders = 0;
  let selectedPianoRenders = 0;
  const rowSelection = createRowSelection({
    state,
    $: () => null,
    status: makeOutput(""),
    selectedLabel: makeOutput("kick 01"),
    selectedControls,
    ...controls,
    PITCH_SLIDER_MIN: -24,
    PITCH_SLIDER_MAX: 48,
    STEP_OPTION_DEFAULTS: { attackMs: 18 },
    PATTERN_ROW_IDS: new Set(["kick", "snare", "hat"]),
    DEFAULT_VELOCITY: { kick: 0.8, snare: 0.6, hat: 0.5 },
    setPairedControl: (range, number, output, value, format = (next) => String(next)) => {
      const next = Number(value);
      range.value = String(next);
      number.value = String(next);
      output.textContent = format(next);
    },
    formatPitch: (value) => String(value),
    getHitData: () => {
      hitDataReads += 1;
      return {
        generated: false,
        options: {
          attackMs: 18,
          delayMs: 0,
          delaySend: 0,
          dubEcho: 0,
          offsetMs: 0,
          reverbSend: 0,
          wobble: 0
        },
        velocity: 0.7
      };
    },
    setHitVelocity: () => {},
    syncSelectedPitchDisplay: () => {},
    syncSelectedDubEchoDisplay: () => {},
    renderSelectedPiano: () => { selectedPianoRenders += 1; },
    soundingStepForRow: (_hit, step) => step,
    updateTrackClipboardButtons: () => {},
    renderTrackInspector: () => { inspectorRenders += 1; },
    renderTrackExplorer: () => { explorerRenders += 1; },
    renderStepGrid: () => {},
    previewConfig: () => ({}),
    defaultNoteState: () => {
      if (!state.selected && state.selectedTracks[0] === "snare") {
        return {
          instrument: "snare",
          velocity: 0.61,
          options: {
            pitch: -3,
            offsetMs: 9,
            attackMs: 31,
            delayMs: 0,
            wobble: 0.2,
            dubEcho: 0.11,
            delaySend: 0.22,
            reverbSend: 0.33
          }
        };
      }
      return {
        instrument: "eightOhEightKick",
        velocity: 0.42,
        options: {
          pitch: 7,
          offsetMs: -12,
          attackMs: 24,
          delayMs: 0,
          wobble: 0.5,
          dubEcho: 0.25,
          delaySend: 0.33,
          reverbSend: 0.44
        }
      };
    },
    trackName: (hit) => hit === "eightOhEightKick" ? "808 Kick" : hit
  });
  return {
    controls,
    explorerRenders: () => explorerRenders,
    hitDataReads: () => hitDataReads,
    inspectorRenders: () => inspectorRenders,
    rowSelection,
    selectedPianoRenders: () => selectedPianoRenders,
    state
  };
}

test("selectRow selects a track without selecting a drum hit", () => {
  const harness = makeHarness();
  harness.rowSelection.selectRow("snare");

  assert.equal(harness.hitDataReads(), 0);
  assert.equal(harness.state.selected, null);
  assert.deepEqual(harness.state.selectedTracks, ["snare"]);
  assert.equal(harness.state.trackAnchor, "snare");
  assert.equal(harness.controls.selectedVelocity.disabled, false);
  assert.equal(harness.controls.selectedVelocityValue.textContent, "0.61");
  assert.equal(harness.controls.selectedPitchValue.textContent, "-3");
  assert.equal(harness.controls.selectedOffsetValue.textContent, "9ms");
  assert.equal(harness.controls.selectedAttackValue.textContent, "31ms");
  assert.equal(harness.controls.selectedDubEchoValue.textContent, "0.11");
  assert.equal(harness.controls.selectedNoteDelaySendValue.textContent, "0.22");
  assert.equal(harness.controls.selectedNoteReverbSendValue.textContent, "0.33");
  assert.equal(harness.selectedPianoRenders(), 1);
  assert.equal(harness.inspectorRenders(), 1);
  assert.equal(harness.explorerRenders(), 1);
});

test("resetSelectedPanel shows editable default note controls", () => {
  const harness = makeHarness();
  harness.rowSelection.resetSelectedPanel();

  assert.equal(harness.state.selected, null);
  assert.deepEqual(harness.state.selectedTracks, []);
  assert.equal(harness.controls.selectedVelocity.disabled, false);
  assert.equal(harness.controls.selectedVelocityValue.textContent, "0.42");
  assert.equal(harness.controls.selectedPitchValue.textContent, "7");
  assert.equal(harness.controls.selectedOffsetValue.textContent, "-12ms");
  assert.equal(harness.controls.selectedAttackValue.textContent, "24ms");
  assert.equal(harness.controls.selectedDubEchoValue.textContent, "0.25");
  assert.equal(harness.controls.selectedNoteDelaySendValue.textContent, "0.33");
  assert.equal(harness.controls.selectedNoteReverbSendValue.textContent, "0.44");
});

test("selectRowToggle clears a track-only selection without touching hit data", () => {
  const harness = makeHarness();
  harness.rowSelection.selectRow("snare");
  harness.rowSelection.selectRowToggle("snare");

  assert.equal(harness.hitDataReads(), 0);
  assert.equal(harness.state.selected, null);
  assert.deepEqual(harness.state.selectedTracks, []);
  assert.equal(harness.state.trackAnchor, null);
});
