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
 * @param {(config: any) => void} [deps.onConfigLoaded]
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
    onConfigLoaded = () => {},
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

  function sequencedHitCount(config) {
    const bars = config?.patterns?.jazz?.bars;
    if (!Array.isArray(bars) || !bars.length) return 0;
    return bars.reduce((sum, bar) => (
      sum + Object.values(bar || {}).reduce((barSum, row) => (
        barSum + (Array.isArray(row) ? row.length : 0)
      ), 0)
    ), 0);
  }

  function sequencedHitCountInBars(bars = []) {
    return bars.reduce((sum, bar) => (
      sum + Object.values(bar || {}).reduce((barSum, row) => (
        barSum + (Array.isArray(row) ? row.length : 0)
      ), 0)
    ), 0);
  }

  function assertUsableDefaultConfig(config, source = "default-project") {
    const bars = config?.patterns?.jazz?.bars;
    const loopTracks = Array.isArray(config?.loopTracks) ? config.loopTracks : [];
    if (!Array.isArray(bars) || !bars.length) {
      throw new Error(`${source}-has-no-bars`);
    }
    if (sequencedHitCount(config) <= 0 && loopTracks.length <= 0) {
      throw new Error(`${source}-has-no-pattern-content`);
    }
    if (sequencedHitCountInBars(bars.slice(0, Math.min(2, bars.length))) <= 0 && loopTracks.length <= 0) {
      throw new Error(`${source}-has-empty-start`);
    }
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
    onConfigLoaded(state.config);
    state.soloTracks = new Set(state.config.soloTracks || []);
    state.mutedTracks = new Set(state.config.mutedTracks || []);
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
        const config = configFromPayload(payload);
        assertUsableDefaultConfig(config, "browser-default-project");
        applyLoadedConfig(config);
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
        : payload?.name ? `Loaded bundled ${payload.name}` : "Loaded bundled default project");
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
