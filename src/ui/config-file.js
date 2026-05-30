// Config file load/save controller.
//
// Owns the "Save File" (download / project-save) and "Load File" flows plus
// the auto-load of the saved game rhythm. `applyLoadedConfig` is the shared
// "swap in a fresh config and rebuild every dependent view" routine.
//
// It reaches the rest of the editor through the shared `state` object and a set
// of injected primitives. The editor keeps thin hoisted wrappers so existing
// call sites (Save/Load buttons, bootstrap) are unchanged.

/**
 * @param {object} deps
 * @param {object} deps.state Shared editor state (mutated in place).
 * @param {(msg: string) => void} deps.setStatus Status-line setter.
 * @param {boolean} deps.runningFromFile
 * @param {string} deps.SAVED_RHYTHM_URL
 * @param {(config?: any) => any} deps.normalizeEditorConfig
 * @param {() => void} deps.syncJson
 * @param {() => void} deps.applyConfig
 * @param {(content: string, name: string) => void} deps.downloadJsonFile
 * @param {(name: string, content: string) => Promise<any>} deps.saveGameAsset
 * @param {(url: string) => Promise<any>} deps.fetchSavedConfig
 * @param {() => void} deps.reconcileGridTracks
 * @param {() => void} deps.resetSelectedPanel
 * @param {() => void} deps.buildLoopTabs
 * @param {() => void} deps.buildBarTabs
 * @param {() => void} deps.buildStepGrid
 * @param {() => void} deps.renderTrackExplorer
 * @param {() => void} deps.renderTrackInspector
 * @param {() => (void|Promise<any>)} deps.reapplyTrackSamples
 * @param {() => void} deps.updateTwoBarClipboardButtons
 * @param {() => void} deps.updateTrackClipboardButtons
 */
export function createConfigFile(deps) {
  const {
    state,
    setStatus,
    runningFromFile,
    SAVED_RHYTHM_URL,
    normalizeEditorConfig,
    syncJson,
    applyConfig,
    downloadJsonFile,
    saveGameAsset,
    fetchSavedConfig,
    reconcileGridTracks,
    resetSelectedPanel,
    buildLoopTabs,
    buildBarTabs,
    buildStepGrid,
    renderTrackExplorer,
    renderTrackInspector,
    reapplyTrackSamples,
    updateTwoBarClipboardButtons,
    updateTrackClipboardButtons
  } = deps;

  function downloadConfigFallback(content) {
    downloadJsonFile(content, "kamorebi-rhythm-sequence.json");
  }

  async function downloadConfig() {
    state.config = normalizeEditorConfig(state.config);
    syncJson();
    const content = JSON.stringify(state.config, null, 2) + "\n";
    if (runningFromFile) {
      downloadConfigFallback(content);
      setStatus("Downloaded rhythm JSON; open the localhost version to save into the game");
      return;
    }
    try {
      const result = await saveGameAsset("rhythm-sequence.json", content);
      setStatus(result.backupPath
        ? `Saved game rhythm and backup ${result.backupPath}`
        : "Saved game rhythm");
    } catch (error) {
      console.error("Rhythm save failed", error);
      downloadConfigFallback(content);
      setStatus("Project save failed; downloaded JSON fallback");
    }
  }

  // Swap in a freshly loaded config and rebuild every dependent view. Shared by
  // the "Load File" flow and the auto-load of the saved game rhythm.
  function applyLoadedConfig(nextConfig) {
    state.config = normalizeEditorConfig(nextConfig);
    state.activeBar = 0;
    state.activeLoopIndex = 0;
    state.twoBarClipboard = null;
    state.trackClipboard = null;
    reconcileGridTracks();
    resetSelectedPanel();
    applyConfig();
    buildLoopTabs();
    buildBarTabs();
    buildStepGrid();
    renderTrackExplorer();
    renderTrackInspector();
    void reapplyTrackSamples();
    updateTwoBarClipboardButtons();
    updateTrackClipboardButtons();
  }

  async function loadConfigFile(file) {
    const text = await file.text();
    applyLoadedConfig(JSON.parse(text));
    setStatus(`Loaded ${file.name}`);
  }

  async function loadSavedRhythmConfig() {
    if (runningFromFile) return;
    try {
      applyLoadedConfig(await fetchSavedConfig(SAVED_RHYTHM_URL));
      setStatus("Loaded game rhythm");
    } catch (error) {
      console.warn("Using sequencer defaults", error);
    }
  }

  return {
    downloadConfig,
    applyLoadedConfig,
    loadConfigFile,
    loadSavedRhythmConfig
  };
}
