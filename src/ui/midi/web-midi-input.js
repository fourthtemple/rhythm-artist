const MIDI_STATUS = {
  IDLE: "idle",
  PENDING: "pending",
  READY: "ready",
  UNSUPPORTED: "unsupported",
  DENIED: "denied"
};

const clampNumber = (value, min, max, fallback = 0) => {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
};

const inputKeyFor = (input) => input?.id || input?.name || input?.manufacturer || "midi-input";

const inputLabelFor = (input) => {
  const parts = [input?.manufacturer, input?.name]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  return parts.length ? [...new Set(parts)].join(" ") : "MIDI Input";
};

const commandName = (command) => ({
  0x80: "noteoff",
  0x90: "noteon",
  0xa0: "polypressure",
  0xb0: "controlchange",
  0xc0: "programchange",
  0xd0: "channelpressure",
  0xe0: "pitchbend"
})[command] || "unknown";

export function parseMidiMessageData(rawData, input = null) {
  const data = Array.from(rawData || []);
  if (data.length < 1) return null;
  const statusByte = data[0] || 0;
  const command = statusByte & 0xf0;
  const channel = (statusByte & 0x0f) + 1;
  const message = {
    channel,
    command,
    kind: commandName(command),
    input,
    inputName: inputLabelFor(input),
    raw: data
  };

  if (command === 0x90 || command === 0x80) {
    const noteNumber = Math.round(Number(data[1]) || 0);
    const velocityRaw = clampNumber(data[2], 0, 127, 0);
    const noteOff = command === 0x80 || velocityRaw <= 0;
    return {
      ...message,
      kind: noteOff ? "noteoff" : "noteon",
      noteNumber,
      velocityRaw: noteOff ? 0 : velocityRaw,
      velocity: noteOff ? 0 : clampNumber((velocityRaw / 127) * 0.9, 0.02, 0.9, 0.42)
    };
  }

  if (command === 0xa0) {
    const noteNumber = Math.round(Number(data[1]) || 0);
    const pressureRaw = clampNumber(data[2], 0, 127, 0);
    return {
      ...message,
      noteNumber,
      pressureRaw,
      pressure: pressureRaw / 127,
      scoped: "note"
    };
  }

  if (command === 0xb0) {
    const controller = Math.round(Number(data[1]) || 0);
    const valueRaw = clampNumber(data[2], 0, 127, 0);
    return {
      ...message,
      controller,
      valueRaw,
      value: valueRaw / 127
    };
  }

  if (command === 0xc0) {
    return {
      ...message,
      program: Math.round(Number(data[1]) || 0)
    };
  }

  if (command === 0xd0) {
    const pressureRaw = clampNumber(data[1], 0, 127, 0);
    return {
      ...message,
      pressureRaw,
      pressure: pressureRaw / 127,
      scoped: "channel"
    };
  }

  if (command === 0xe0) {
    const value14 = ((Math.round(Number(data[2]) || 0) & 0x7f) << 7)
      | (Math.round(Number(data[1]) || 0) & 0x7f);
    return {
      ...message,
      valueRaw: value14,
      value: clampNumber((value14 - 8192) / 8192, -1, 1, 0)
    };
  }

  return message;
}

export function createWebMidiInput({
  setStatus = () => {},
  isEnabled = () => false,
  onNoteOn = () => {},
  onNoteOff = () => {},
  onPressure = () => {},
  onControlChange = () => {},
  onPitchBend = () => {},
  onProgramChange = () => {}
} = {}) {
  let midiAccess = null;
  let status = MIDI_STATUS.IDLE;
  let lastError = "";
  const inputs = new Map();

  const isSupported = () =>
    typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";

  const inputNames = () => Array.from(inputs.values()).map(inputLabelFor);

  function summary() {
    if (status === MIDI_STATUS.PENDING) return "MIDI permission...";
    if (status === MIDI_STATUS.UNSUPPORTED) return "Hardware MIDI needs Chrome or Edge; Safari does not support Web MIDI";
    if (status === MIDI_STATUS.DENIED) return lastError || "MIDI blocked";
    if (status === MIDI_STATUS.READY) {
      const names = inputNames();
      return names.length ? `MIDI: ${names.join(", ")}` : "No MIDI devices";
    }
    return "MIDI not requested";
  }

  function emitStatus(prefix = "MIDI") {
    setStatus(`${prefix} · ${summary()}`);
  }

  function handleMidiMessage(event) {
    if (!isEnabled()) return;
    const input = event?.target || event?.currentTarget || null;
    const message = parseMidiMessageData(event?.data, input);
    if (!message) return;

    if (message.kind === "noteon") {
      onNoteOn(message);
      return;
    }

    if (message.kind === "noteoff") {
      onNoteOff(message);
      return;
    }

    if (message.kind === "polypressure" || message.kind === "channelpressure") {
      onPressure(message);
      return;
    }

    if (message.kind === "controlchange") {
      onControlChange(message);
      return;
    }

    if (message.kind === "programchange") {
      onProgramChange(message);
      return;
    }

    if (message.kind === "pitchbend") onPitchBend(message);
  }

  function detachInputs() {
    inputs.forEach((input) => {
      if (input?.onmidimessage === handleMidiMessage) input.onmidimessage = null;
    });
  }

  function refreshInputs({ announce = false } = {}) {
    detachInputs();
    inputs.clear();
    midiAccess?.inputs?.forEach?.((input) => {
      if (!input || input.state === "disconnected") return;
      inputs.set(inputKeyFor(input), input);
      if (isEnabled()) input.onmidimessage = handleMidiMessage;
    });
    if (announce && isEnabled()) emitStatus();
    return inputNames();
  }

  async function requestAccess({ announce = true } = {}) {
    if (!isSupported()) {
      status = MIDI_STATUS.UNSUPPORTED;
      lastError = "Hardware MIDI needs Chrome or Edge; Safari does not support Web MIDI";
      if (announce && isEnabled()) emitStatus();
      return false;
    }
    if (midiAccess) {
      status = MIDI_STATUS.READY;
      refreshInputs({ announce });
      return true;
    }
    if (status === MIDI_STATUS.PENDING) return false;
    status = MIDI_STATUS.PENDING;
    if (announce && isEnabled()) emitStatus();
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      status = MIDI_STATUS.READY;
      lastError = "";
      midiAccess.onstatechange = () => {
        refreshInputs({ announce: isEnabled() });
      };
      refreshInputs({ announce });
      return true;
    } catch (error) {
      status = MIDI_STATUS.DENIED;
      lastError = "MIDI blocked";
      console.warn("MIDI access failed", error);
      if (announce && isEnabled()) emitStatus();
      return false;
    }
  }

  function setEnabled(enabled, { announce = true, request = false } = {}) {
    if (!enabled) {
      detachInputs();
      if (announce) setStatus("Keyboard off");
      return;
    }
    if (midiAccess) {
      refreshInputs({ announce });
      return;
    }
    if (request) void requestAccess({ announce });
  }

  function sync() {
    if (midiAccess) refreshInputs();
  }

  return {
    inputNames,
    isSupported,
    requestAccess,
    setEnabled,
    status: () => status,
    summary,
    sync
  };
}
