export const MIDI_DRUM_ROOT_NOTE = 36;

const integer = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
};

export function midiNoteToGridIndex(noteNumber, { rootNote = MIDI_DRUM_ROOT_NOTE } = {}) {
  const index = integer(noteNumber, rootNote) - integer(rootNote, MIDI_DRUM_ROOT_NOTE);
  return index >= 0 ? index : -1;
}

export function normalizeMidiTrackNoteMap(trackNoteMap = {}, validTrackIds = []) {
  if (!trackNoteMap || typeof trackNoteMap !== "object") return {};
  const valid = new Set(validTrackIds.filter((trackId) => typeof trackId === "string" && trackId));
  return Object.fromEntries(
    Object.entries(trackNoteMap)
      .map(([trackId, noteNumber]) => [trackId, integer(noteNumber, -1)])
      .filter(([trackId, noteNumber]) =>
        typeof trackId === "string"
        && trackId
        && (!valid.size || valid.has(trackId))
        && noteNumber >= 0
        && noteNumber <= 127)
  );
}

export function assignMidiTrackNote(
  trackNoteMap = {},
  trackId,
  noteNumber,
  { defaultNote = null, exclusive = true, validTrackIds = [] } = {}
) {
  if (!trackId) return normalizeMidiTrackNoteMap(trackNoteMap, validTrackIds);
  const note = integer(noteNumber, -1);
  const next = normalizeMidiTrackNoteMap(trackNoteMap, validTrackIds);
  delete next[trackId];
  if (note < 0 || note > 127 || note === defaultNote) return next;
  if (exclusive) {
    Object.entries(next).forEach(([otherTrack, otherNote]) => {
      if (otherTrack !== trackId && otherNote === note) delete next[otherTrack];
    });
  }
  next[trackId] = note;
  return next;
}

export function midiNoteToGridTrack(noteNumber, gridTrackIds = [], options = {}) {
  const mapped = normalizeMidiTrackNoteMap(options.trackNoteMap, gridTrackIds);
  const explicitTrack = gridTrackIds.find((trackId) => mapped[trackId] === integer(noteNumber, -1));
  if (explicitTrack) return explicitTrack;
  const index = midiNoteToGridIndex(noteNumber, options);
  if (index < 0 || index >= gridTrackIds.length) return null;
  return gridTrackIds[index] || null;
}

export function gridTrackToMidiNote(trackId, gridTrackIds = [], { rootNote = MIDI_DRUM_ROOT_NOTE, trackNoteMap = {} } = {}) {
  const mapped = normalizeMidiTrackNoteMap(trackNoteMap, gridTrackIds);
  if (mapped[trackId] != null) return mapped[trackId];
  const index = gridTrackIds.indexOf(trackId);
  return index >= 0 ? integer(rootNote, MIDI_DRUM_ROOT_NOTE) + index : null;
}
