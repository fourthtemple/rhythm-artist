/**
 * Config-sync controller.
 *
 * Manages syncing editor state back to DOM after any config mutation:
 * - `[data-config]` sliders + value labels
 * - transport BPM widget
 * - intensity slider
 * - zoom buttons + step-grid CSS class
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
    stepGrid,
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
    const transportBpm = $("#transport-bpm");
    const transportBpmNumber = $("#transport-bpm-number");
    const transportBpmValue = $("#transport-bpm-value");
    if (transportBpm) transportBpm.value = String(bpm);
    if (transportBpmNumber) transportBpmNumber.value = String(bpm);
    if (transportBpmValue) transportBpmValue.textContent = String(Math.round(bpm));
    $("#intensity").value = String(state.intensity);
    $("#intensity-value").textContent = state.intensity.toFixed(2);
  }

  function applyZoom(level) {
    state.zoomLevel = level;
    stepGrid.classList.remove("step-grid--zoom-2", "step-grid--zoom-4", "step-grid--zoom-8");
    if (level > 1) stepGrid.classList.add(`step-grid--zoom-${level}`);
    document.querySelectorAll(".zoom-btn").forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.zoom) === level);
    });
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

  return { getPathValue, setPathValue, syncSliders, applyZoom, syncJson, applyConfig };
}
