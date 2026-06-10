# MIDI UI Modules

This directory owns browser MIDI input and normalized controller events.

- `web-midi-input.js` talks to the Web MIDI API, tracks connected inputs, and
  converts raw MIDI bytes into note, pressure, control, pitch-bend, and program
  events.
- `midi-note-map.js` owns the default drum-pad mapping. Note 36 maps to the
  first visible grid row, note 37 to the second row, and so on.
- `midi-map-panel.js` renders the Track View MIDI Map drawer and owns MIDI
  learn/apply behavior for right-click mapped controls.
- Piano roll, grid, wave edit, and future performance-mode modules should
  consume those normalized events instead of calling `navigator.requestMIDIAccess`
  directly.
