/**
 * Config-sync controller.
 *
 * Manages syncing editor state back to DOM after any config mutation:
 * - `[data-config]` sliders + value labels
 * - transport BPM widget
 * - JSON output textarea
 * - `applyConfig()` — the single entry point that orchestrates all of the above
 *
 * Also owns `getPathValue` / `setPathValue` (thin wrappers over object-path).
 *
 * @param {object} deps - injected dependencies (see factory call in main file)
 */
export function createConfigSync(deps) {
  const {
    $,
    state,
    jsonOutput,
    getConfigPath,
    setConfigPath,
    normalizeEditorConfig,
    previewConfig,
    syncSelectedPitchDisplay,
    syncSelectedBusSendDisplay
  } = deps;

  function getPathValue(path) {
    return getConfigPath(state.config, path);
  }

  function setPathValue(path, value) {
    setConfigPath(state.config, path, Number(value));
    applyConfig();
  }

  function syncSliders() {
    document.querySelectorAll("[data-config]").forEach((input) => {
      const value = getPathValue(input.dataset.config);
      input.value = String(value);
      const suffix = input.dataset.config.includes("OffsetMs") ? "ms" : "";
      input.nextElementSibling.textContent =
        input.dataset.config === "autoEchoEnabled" || input.dataset.config === "eightOhEightChoke"
          ? Number(value) >= 0.5 ? "on" : "off"
          : `${Number(value).toFixed(input.step.includes(".") ? 2 : 0)}${suffix}`;
    });
    const bpm = state.config.patterns.jazz.bpm;
    const transportBpmNumber = $("#transport-bpm-number");
    if (transportBpmNumber) transportBpmNumber.value = String(bpm);
    const intensity = $("#intensity");
    const intensityValue = $("#intensity-value");
    if (intensity) intensity.value = String(state.intensity);
    if (intensityValue) intensityValue.textContent = state.intensity.toFixed(2);
  }

  function syncJson() {
    jsonOutput.value = JSON.stringify(state.config, null, 2);
  }

  function applyConfig() {
    state.config = normalizeEditorConfig(state.config);
    state.engine.setConfig(previewConfig());
    syncSliders();
    syncJson();
    if (state.selected) {
      syncSelectedPitchDisplay(state.activeBar);
      syncSelectedBusSendDisplay();
    }
  }

  return { getPathValue, setPathValue, syncSliders, syncJson, applyConfig };
}
