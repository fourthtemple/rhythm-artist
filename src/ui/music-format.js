// ════════════════════════════════════════════════════════════════════════
// Pure music/formatting helpers for the sequencer UI. No DOM, no shared state —
// just value → display-string (and a little scale math) so they're trivially
// testable and reusable.
// ════════════════════════════════════════════════════════════════════════

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const BLACK_NOTE_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);
/** MIDI note number that pitch offset 0 maps to (A1). */
export const A1_MIDI_NOTE = 33;

/** Format a signed pitch offset, e.g. 3 → "+3", -2 → "-2". */
export function formatPitch(value) {
  const rounded = Math.round(Number(value) || 0);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

/** Resolve a pitch offset to a note name + octave, e.g. 0 → "A1". */
export function noteNameForPitch(value) {
  const rounded = Math.round(Number(value) || 0);
  const midiNote = A1_MIDI_NOTE + rounded;
  const pitchClass = ((midiNote % 12) + 12) % 12;
  const octave = Math.floor(midiNote / 12) - 1;
  return `${NOTE_NAMES[pitchClass]}${octave}`;
}

/** True if a pitch offset lands on a black key (for piano-roll styling). */
export function isBlackPitch(value) {
  const midiNote = A1_MIDI_NOTE + (Math.round(Number(value) || 0));
  return BLACK_NOTE_PITCH_CLASSES.has(((midiNote % 12) + 12) % 12);
}

/** Map a scale step index into a semitone offset, given a scale (array of semitones). */
export function scaleSemitoneForIndex(scaleIndex, scale) {
  const index = Math.round(Number(scaleIndex) || 0);
  const wrapped = ((index % scale.length) + scale.length) % scale.length;
  const octaveOffset = Math.floor(index / scale.length);
  return scale[wrapped] + octaveOffset * 12;
}

/** Format a pan value (-1..1) as L/C/R with magnitude, e.g. -0.5 → "L50". */
export function formatPan(value) {
  const pan = Math.max(-1, Math.min(1, Number(value) || 0));
  if (Math.abs(pan) < 0.005) return "C";
  const side = pan < 0 ? "L" : "R";
  return `${side}${Math.round(Math.abs(pan) * 100)}`;
}

/**
 * Convert a stored pitch *offset* into the pitch shown in the UI. For pitched
 * tracks (`basePitch` non-null, e.g. the sequenced bass line) the displayed
 * value is the absolute pitch `basePitch + offset`; for everything else the
 * stored value is itself the displayed offset. Pure: the caller supplies the
 * base pitch so this needs no sequencer state.
 */
export function displayedPitch(offset, basePitch = null) {
  const value = Number(offset) || 0;
  return basePitch === null ? value : basePitch + value;
}

/**
 * Inverse of `displayedPitch`: turn a value shown in the UI back into the
 * stored offset. For pitched tracks the stored offset is the trim relative to
 * `basePitch`; otherwise the displayed value is stored verbatim.
 */
export function storedPitch(displayedValue, basePitch = null) {
  const value = Number(displayedValue) || 0;
  return basePitch === null ? value : value - basePitch;
}

