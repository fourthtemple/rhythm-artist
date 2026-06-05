// Config file load/save controller.
//
// Owns the "Save File" (browser-cache save) and "Load File" flows plus the
// auto-load of the default project. `applyLoadedConfig` is the shared
// "swap in a fresh config and rebuild every dependent view" routine.
//
// It reaches the rest of the editor through the shared `state` object and a set
// of injected primitives. The editor keeps thin hoisted wrappers so existing
// call sites (Save/Load buttons, bootstrap) are unchanged.

/**
 * @param {object} deps
 * @param {object} deps.state Shared editor state (mutated in place).
 * @param {(msg: string) => void} deps.setStatus Status-line setter.
 * @param {string} deps.SAVED_RHYTHM_URL
 * @param {(config?: any) => any} deps.normalizeEditorConfig
 * @param {() => any} [deps.getSerializableConfig]
 * @param {() => void} deps.syncJson
 * @param {() => void} deps.applyConfig
 * @param {(content: string, name: string) => void} deps.downloadJsonFile
 * @param {(project: any, name?: string) => Promise<any>} deps.saveDefaultProject
 * @param {() => Promise<any>} deps.loadDefaultProject
 * @param {() => Promise<any>} deps.getLocalServerMode
 * @param {(url: string) => Promise<any>} deps.fetchSavedConfig
 * @param {() => void} deps.reconcileGridTracks
 * @param {() => void} deps.resetSelectedPanel
 * @param {() => void} deps.buildLoopTabs
 * @param {() => void} deps.buildBarTabs
 * @param {() => void} deps.buildStepGrid
 * @param {() => void} deps.renderTrackExplorer
 * @param {() => void} deps.renderTrackInspector
 * @param {() => (void|Promise<any>)} deps.reapplyTrackSamples
 * @param {(tracks: any[]) => (void|Promise<any>)} [deps.restoreLoopTracks]
 * @param {() => void} deps.updateTwoBarClipboardButtons
 * @param {() => void} deps.updateTrackClipboardButtons
 */
export function createConfigFile(deps) {
  const {
    state,
    setStatus,
    SAVED_RHYTHM_URL,
    normalizeEditorConfig,
    getSerializableConfig = () => state.config,
    syncJson,
    applyConfig,
    downloadJsonFile,
    saveDefaultProject,
    loadDefaultProject,
    getLocalServerMode,
    fetchSavedConfig,
    reconcileGridTracks,
    resetSelectedPanel,
    buildLoopTabs,
    buildBarTabs,
    buildStepGrid,
    renderTrackExplorer,
    renderTrackInspector,
    reapplyTrackSamples,
    restoreLoopTracks = () => {},
    updateTwoBarClipboardButtons,
    updateTrackClipboardButtons
  } = deps;

  function wrapProject(config, name = "Default Project") {
    return {
      schema: "rhythm-artist/project@1",
      name,
      savedAt: new Date().toISOString(),
      samplePacks: ["default-pack"],
      config
    };
  }

  function downloadConfigFallback(project) {
    downloadJsonFile(JSON.stringify(project, null, 2) + "\n", "rhythm-artist-default-project.json");
  }

  function configFromPayload(payload) {
    return payload?.schema === "rhythm-artist/project@1" && payload.config
      ? payload.config
      : payload;
  }

  async function downloadConfig() {
    state.config = normalizeEditorConfig(getSerializableConfig());
    syncJson();
    const project = wrapProject(state.config);
    try {
      await saveDefaultProject(project, project.name);
      setStatus("Saved Default Project in this browser");
    } catch (error) {
      console.error("Browser project save failed", error);
      downloadConfigFallback(project);
      setStatus("Browser save failed; downloaded JSON fallback");
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
    void restoreLoopTracks(state.config.loopTracks || []);
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
    const localMode = await getLocalServerMode();
    let browserError = null;
    if (!localMode.preferBundledDefault) {
      try {
        const payload = await loadDefaultProject();
        if (!payload) throw new Error("default-project-cache-empty");
        applyLoadedConfig(configFromPayload(payload));
        setStatus(payload?.name ? `Loaded ${payload.name}` : "Loaded browser default project");
        return;
      } catch (error) {
        browserError = error;
      }
    }
    try {
      const payload = await fetchSavedConfig(SAVED_RHYTHM_URL);
      applyLoadedConfig(configFromPayload(payload));
      setStatus(localMode.preferBundledDefault
        ? "Loaded bundled Default Project for editing"
        : payload?.name ? `Loaded ${payload.name}` : "Loaded bundled default project");
    } catch (fallbackError) {
      try {
        applyLoadedConfig(await fetchSavedConfig("./assets/game/rhythm-sequence.json"));
        setStatus("Loaded legacy game rhythm");
      } catch (legacyError) {
        console.warn("Using sequencer defaults", browserError, fallbackError, legacyError);
      }
    }
  }

  return {
    downloadConfig,
    applyLoadedConfig,
    loadConfigFile,
    loadSavedRhythmConfig
  };
}
