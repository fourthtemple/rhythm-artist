export const AUTOMATION_PARAMETERS = [
  {
    id: "velocity",
    label: "Velocity",
    target: "velocity",
    min: 0,
    max: 0.9,
    fallback: 0.5,
    display: (value) => Number(value).toFixed(2)
  },
  {
    id: "offsetMs",
    label: "Offset",
    target: "option",
    optionKey: "offsetMs",
    min: -120,
    max: 120,
    fallback: 0,
    display: (value) => `${Math.round(Number(value) || 0)}ms`
  },
  {
    id: "attackMs",
    label: "Attack",
    target: "option",
    optionKey: "attackMs",
    min: 0,
    max: 180,
    fallback: 0,
    display: (value) => `${Math.round(Number(value) || 0)}ms`
  },
  {
    id: "wobble",
    label: "LFO",
    target: "option",
    optionKey: "wobble",
    min: 0,
    max: 1,
    fallback: 0,
    display: (value) => Number(value).toFixed(2)
  },
  {
    id: "dubEcho",
    label: "Dub Echo",
    target: "option",
    optionKey: "dubEcho",
    min: 0,
    max: 1,
    fallback: 0,
    display: (value) => Number(value).toFixed(2)
  },
  {
    id: "delaySend",
    label: "Note Delay",
    target: "option",
    optionKey: "delaySend",
    min: 0,
    max: 1,
    fallback: 0,
    display: (value) => Number(value).toFixed(2)
  },
  {
    id: "reverbSend",
    label: "Reverb",
    target: "option",
    optionKey: "reverbSend",
    min: 0,
    max: 1,
    fallback: 0,
    display: (value) => Number(value).toFixed(2)
  }
];

export function automationParameterById(id) {
  return AUTOMATION_PARAMETERS.find((param) => param.id === id) || AUTOMATION_PARAMETERS[0];
}

export function clampAutomationValue(param, value) {
  const number = Number(value);
  const fallback = Number(param.fallback) || 0;
  return Math.max(param.min, Math.min(param.max, Number.isFinite(number) ? number : fallback));
}

export function readAutomationValue(note, param) {
  if (param.target === "velocity") return clampAutomationValue(param, note.velocity);
  return clampAutomationValue(param, note.options?.[param.optionKey] ?? param.fallback);
}

export function automationLevel(param, value) {
  const range = Math.max(0.0001, param.max - param.min);
  return Math.max(0, Math.min(1, (clampAutomationValue(param, value) - param.min) / range));
}
