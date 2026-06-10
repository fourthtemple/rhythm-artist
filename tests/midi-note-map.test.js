import assert from "node:assert/strict";
import test from "node:test";

import {
  MIDI_DRUM_ROOT_NOTE,
  assignMidiTrackNote,
  gridTrackToMidiNote,
  midiNoteToGridIndex,
  midiNoteToGridTrack,
  normalizeMidiTrackNoteMap
} from "../src/ui/midi/midi-note-map.js";

test("midiNoteToGridIndex starts drum mapping at note 36", () => {
  assert.equal(MIDI_DRUM_ROOT_NOTE, 36);
  assert.equal(midiNoteToGridIndex(36), 0);
  assert.equal(midiNoteToGridIndex(37), 1);
  assert.equal(midiNoteToGridIndex(35), -1);
});

test("midiNoteToGridTrack maps notes to visible grid track order", () => {
  const tracks = ["kick", "snare", "hat"];
  assert.equal(midiNoteToGridTrack(36, tracks), "kick");
  assert.equal(midiNoteToGridTrack(37, tracks), "snare");
  assert.equal(midiNoteToGridTrack(38, tracks), "hat");
  assert.equal(midiNoteToGridTrack(39, tracks), null);
});

test("gridTrackToMidiNote returns the note for a grid track", () => {
  const tracks = ["kick", "snare", "hat"];
  assert.equal(gridTrackToMidiNote("kick", tracks), 36);
  assert.equal(gridTrackToMidiNote("hat", tracks), 38);
  assert.equal(gridTrackToMidiNote("rim", tracks), null);
});

test("midiNoteToGridTrack supports custom root notes", () => {
  const tracks = ["kick", "snare"];
  assert.equal(midiNoteToGridTrack(48, tracks, { rootNote: 48 }), "kick");
  assert.equal(gridTrackToMidiNote("snare", tracks, { rootNote: 48 }), 49);
});

test("explicit MIDI track notes override row order", () => {
  const tracks = ["kick", "snare", "sampler~one"];
  const map = { "sampler~one": 36 };
  assert.equal(midiNoteToGridTrack(36, tracks, { trackNoteMap: map }), "sampler~one");
  assert.equal(gridTrackToMidiNote("sampler~one", tracks, { trackNoteMap: map }), 36);
  assert.equal(gridTrackToMidiNote("snare", tracks, { trackNoteMap: map }), 37);
});

test("assignMidiTrackNote stores only explicit non-default notes", () => {
  const tracks = ["kick", "snare"];
  const mapped = assignMidiTrackNote({}, "snare", 48, { defaultNote: 37, validTrackIds: tracks });
  assert.deepEqual(mapped, { snare: 48 });
  assert.deepEqual(assignMidiTrackNote(mapped, "snare", 37, { defaultNote: 37, validTrackIds: tracks }), {});
});

test("assignMidiTrackNote keeps note assignments exclusive", () => {
  const tracks = ["kick", "snare"];
  const mapped = assignMidiTrackNote({ kick: 48 }, "snare", 48, { validTrackIds: tracks });
  assert.deepEqual(mapped, { snare: 48 });
});

test("normalizeMidiTrackNoteMap drops invalid notes and tracks", () => {
  assert.deepEqual(normalizeMidiTrackNoteMap({
    kick: 36,
    missing: 38,
    snare: 999
  }, ["kick", "snare"]), { kick: 36 });
});
