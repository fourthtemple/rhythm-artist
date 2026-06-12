// Track panels controller.
//
import {
  SAMPLE_SOURCE_BUNDLED,
  SAMPLE_SOURCE_BROWSER_HANDLE,
  SAMPLE_SOURCE_LOCAL_FILE,
  resolveFileHandleSample
} from "./sample-assets.js";
import {
  STEP_OPTION_DEFAULTS,
  normalizeTrackOptionDefaults,
  trackOptionDefaultsFor
} from "../audio/rhythm-config.js";

const SAMPLER_TRACK_DEFAULT_CONTROLS = [
  { key: "offsetMs", label: "Offset", min: -180, max: 180, step: 1, format: (v) => `${Math.round(v)}ms` },
  { key: "attackMs", label: "Attack", min: 0, max: 260, step: 1, format: (v) => `${Math.round(v)}ms` },
  { key: "wobble", label: "LFO", min: 0, max: 4, step: 0.01, format: (v) => Number(v).toFixed(2) }
];

// Owns the right-side track UI cluster:
//   • Registry-driven grid-track management (add/remove voices & instances,
//     ordering, reconciliation after load).
//   • The "Add Track" dialog (grouped chips with add/remove controls).
//   • The Track Explorer (grouped, selectable track list with solo + sample dot).
//   • The Track Inspector (one independent panel per selected track: sample row,
//     instrument parameters, optional 808 shape, delete/deselect).
//   • Per-track custom sample assignment/clear/reapply.
//
// It reaches the rest of the app through injected dependencies plus the shared
// `state` object, so the editor keeps only thin wrappers around this API.

/**
 * @param {object} deps
 * @param {(sel: string) => any} deps.$ DOM query helper.
 * @param {object} deps.state Shared editor state (mutated in place).
 * @param {Element|null} deps.trackExplorerList
 * @param {Element|null} deps.trackInspectorPanels
 * @param {HTMLTemplateElement|null} deps.trackInspectorTemplate
 * @param {Element|null} deps.trackInspectorName
 * @param {Element|null} deps.trackInspectorMultiHint
 * @param {boolean} deps.runningFromFile
 * @param {(value: any, min: number, max: number, fallback?: number) => number} deps.clamp
 * @param {(value: number) => string} deps.formatPan
 * Registry helpers:
 * @param {Array<any>} deps.TRACK_REGISTRY
 * @param {Array<{id: string, label: string, accent?: string}>} deps.TRACK_GROUPS
 * @param {Record<string, any>} deps.TRACK_BY_ID
 * @param {Record<string, string>} deps.TRACK_LABELS
 * @param {string[]} deps.DEFAULT_GRID_TRACK_IDS
 * @param {(id: string) => any} deps.getTrackDef
 * @param {(id: string) => boolean} deps.isInstanceId
 * @param {(id: string) => string} deps.baseTrackId
 * @param {(id: string) => string} deps.makeInstanceId
 * @param {() => Array<{group: any, tracks: any[]}>} deps.tracksByGroup
 * grid-tracks pure helpers:
 * @param {Function} deps.orderGridTrackIdsBase
 * @param {Function} deps.reconcileGridTrackIdsBase
 * @param {Function} deps.instanceLabelFor
 * @param {Function} deps.removeTrackFromConfigMaps
 * @param {Function} deps.replaceTrackIdInConfig
 * track-shape pure helpers:
 * @param {Array<any>} deps.TRACK_SHAPE_FIELDS
 * @param {Function} deps.globalShapeValueBase
 * @param {Function} deps.resolvedShapeValueBase
 * @param {Function} deps.formatShapeValue
 * @param {Function} deps.setTrackShapeFieldBase
 * @param {Function} deps.clearTrackShape
 * @param {Function} deps.wireNumberControl
 * Per-track mix getters/setters (keyed by track id):
 * @param {object} deps.mix
 * Editor callbacks:
 * @param {() => void} deps.applyConfig
 * @param {() => void} deps.buildStepGrid
 * @param {() => void} deps.renderStepGrid
 * @param {() => void} deps.syncJson
 * @param {(msg: string) => void} deps.setStatus
 * @param {() => void} deps.resetSelectedPanel
 * @param {(hit: string, opts?: {keepTracks?: boolean}) => void} deps.selectRow
 * @param {(hit: string) => void} deps.previewRowSelectionControls
 * @param {(hit: string, event?: any) => void} deps.selectRowWithModifiers
 * @param {(ids: Iterable<string>) => string[]} deps.orderBySelectedGrid
 * @param {(track: string) => void} deps.toggleSolo
 * @param {(track: string) => void} deps.toggleMute
 * @param {() => any} deps.previewConfig
 * @param {() => any} deps.getEngine
 * @param {(event: MouseEvent, items: any[]) => void} [deps.showContextMenu]
 * @param {(kind: string, id: string) => void} [deps.onEditorLaneOpen]
 * @param {() => void} [deps.onTrackIdReplaced]
 * @param {() => void} [deps.onTrackEditorModeChange]
 * @param {(trackCount: number) => void} [deps.onTrackInspectorSelectionChange]
 * @param {() => {instrument:string, velocity:number, options:any}} [deps.defaultNoteState]
 * @param {(instrument:string) => void} [deps.setDefaultNoteInstrument]
 */
export function createTrackPanels(deps) {
  const {
    $,
    state,
    trackExplorerList,
    trackInspectorPanels,
    trackInspectorTemplate,
    trackInspectorName,
    trackInspectorMultiHint,
    runningFromFile,
    clamp,
    formatPan,
    TRACK_REGISTRY,
    TRACK_GROUPS,
    TRACK_BY_ID,
    TRACK_LABELS,
    DEFAULT_GRID_TRACK_IDS,
    getTrackDef,
    isInstanceId,
    baseTrackId,
    makeInstanceId,
    tracksByGroup,
    orderGridTrackIdsBase,
    reconcileGridTrackIdsBase,
    instanceLabelFor,
    removeTrackFromConfigMaps,
    replaceTrackIdInConfig,
    TRACK_SHAPE_FIELDS,
    globalShapeValueBase,
    resolvedShapeValueBase,
    formatShapeValue,
    setTrackShapeFieldBase,
    clearTrackShape,
    wireNumberControl,
    mix,
    applyConfig,
    buildStepGrid,
    renderStepGrid,
    syncJson,
    setStatus,
    resetSelectedPanel,
    selectRow,
    previewRowSelectionControls,
    selectRowWithModifiers,
    orderBySelectedGrid,
    toggleSolo,
    toggleMute,
    previewConfig,
    getEngine,
    showContextMenu = null,
    onEditorLaneOpen = null,
    onTrackIdReplaced = () => {},
    onTrackEditorModeChange = () => {},
    onTrackInspectorSelectionChange = () => {},
    defaultNoteState = null,
    setDefaultNoteInstrument = null
  } = deps;

  const registryIds = () => TRACK_REGISTRY.map((t) => t.id);
  const DEFAULT_TRACK_STEPS_PER_BAR = 16;
  const normalizeTrackStepCount = (value) => {
    const number = Number(value);
    const requested = Math.round(Number.isFinite(number) ? number : DEFAULT_TRACK_STEPS_PER_BAR);
    return Math.max(1, Math.min(128, requested));
  };

  function afterNextPaint(callback) {
    if (typeof window === "undefined") {
      callback();
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(callback);
    });
  }

  function validTrackViewIds(ids = []) {
    return orderGridTrackIds([...new Set(ids
      .map((id) => typeof id === "string" ? id : "")
      .filter((id) => id && getTrackDef(id)))]);
  }

  function trackViewTrackIds() {
    const explicit = Array.isArray(state.config.trackViewTrackIds)
      ? state.config.trackViewTrackIds
      : [];
    const hidden = new Set(hiddenGridTrackIds());
    const implicit = [
      ...Object.keys(state.config.trackSamples || {}),
      ...(Array.isArray(state.config.pianoRollTracks) ? state.config.pianoRollTracks : [])
    ];
    const ids = validTrackViewIds([...explicit, ...implicit])
      .filter((id) => (state.gridTrackIds.includes(id) || getTrackDef(id)) && !hidden.has(id));
    state.config.trackViewTrackIds = validTrackViewIds(explicit);
    return ids;
  }

  function trackExplorerIdsForMode() {
    if (state.trackEditorMode === "pianoRoll") {
      return validTrackViewIds(pianoRollTrackIds())
        .filter((id) => state.gridTrackIds.includes(id));
    }
    if (state.trackEditorMode === "wave") return [];
    const hidden = new Set(hiddenGridTrackIds());
    return orderGridTrackIds(state.gridTrackIds.filter((id) => getTrackDef(id) && !hidden.has(id)));
  }

  function emptyTrackExplorerMessage() {
    if (state.trackEditorMode === "pianoRoll") return "No piano roll tracks added.";
    if (state.trackEditorMode === "wave") return "No wave tracks added.";
    return "No grid tracks added.";
  }

  function addProjectTrack(trackId, { render = true } = {}) {
    if (!getTrackDef(trackId)) return null;
    unhideGridTrack(trackId);
    state.config.trackViewTrackIds = validTrackViewIds([
      ...(Array.isArray(state.config.trackViewTrackIds) ? state.config.trackViewTrackIds : []),
      trackId
    ]);
    if (render) {
      renderTrackExplorer();
      syncJson();
    }
    return trackId;
  }

  function removeProjectTrack(trackId) {
    if (!Array.isArray(state.config.trackViewTrackIds)) return;
    state.config.trackViewTrackIds = state.config.trackViewTrackIds.filter((id) => id !== trackId);
  }

  function hiddenGridTrackIds() {
    return Array.isArray(state.config.hiddenGridTrackIds) ? state.config.hiddenGridTrackIds : [];
  }

  function hideGridTrack(trackId) {
    state.config.hiddenGridTrackIds = validTrackViewIds([...hiddenGridTrackIds(), trackId]);
  }

  function unhideGridTrack(trackId) {
    state.config.hiddenGridTrackIds = hiddenGridTrackIds().filter((id) => id !== trackId);
  }

  function updateTrackExplorerSelectionNow() {
    if (!trackExplorerList) return;
    const selectedSet = new Set(state.selectedTracks.length ? state.selectedTracks : (state.selected?.hit ? [state.selected.hit] : []));
    trackExplorerList.querySelectorAll(".track-explorer-row[data-track-id]").forEach((row) => {
      const id = row.dataset.trackId;
      const ids = row.dataset.trackAggregate === "base" ? trackIdsForBase(baseTrackId(id)) : [id];
      row.classList.toggle("is-selected", ids.some((trackId) => selectedSet.has(trackId)) || selectedSet.has(id));
    });
  }

  function previewTrackSelectionNow(trackId, event = {}) {
    const shift = Boolean(event.shiftKey);
    const meta = Boolean(event.metaKey || event.ctrlKey);
    const trackOnlySelected = !state.selected && state.selectedTracks.length === 1 && state.selectedTracks[0] === trackId;
    let selected = [trackId];
    if (!shift && !meta && trackOnlySelected) {
      selected = [];
    } else if (shift && state.trackAnchor && state.gridTrackIds.includes(state.trackAnchor)) {
      const a = state.gridTrackIds.indexOf(state.trackAnchor);
      const b = state.gridTrackIds.indexOf(trackId);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        selected = state.gridTrackIds.slice(lo, hi + 1);
      }
    } else if (meta) {
      const set = new Set(state.selectedTracks);
      if (set.has(trackId) && set.size > 1) set.delete(trackId);
      else set.add(trackId);
      selected = orderBySelectedGrid(set);
    }
    const selectedSet = new Set(selected);
    trackExplorerList?.querySelectorAll(".track-explorer-row[data-track-id]").forEach((row) => {
      const id = row.dataset.trackId;
      const ids = row.dataset.trackAggregate === "base" ? trackIdsForBase(baseTrackId(id)) : [id];
      row.classList.toggle("is-selected", ids.some((candidate) => selectedSet.has(candidate)) || selectedSet.has(id));
    });
    document.querySelectorAll(".track-label").forEach((label) => {
      label.classList.toggle("is-selected-row", selectedSet.has(label.dataset.hit));
    });
  }

  function selectExplorerTrackNow(trackId, event = {}) {
    const selectionEvent = {
      shiftKey: Boolean(event.shiftKey),
      metaKey: Boolean(event.metaKey),
      ctrlKey: Boolean(event.ctrlKey)
    };
    previewTrackSelectionNow(trackId, selectionEvent);
    afterNextPaint(() => {
      selectRowWithModifiers(trackId, selectionEvent, { deferTrackPanels: true, bottomTab: "track" });
      updateTrackExplorerSelectionNow();
      renderStepGrid();
    });
  }
  const collapsedVoiceGroups = new Set();

  function openAddTrackDialog(groupId = null) {
    renderAddTrackDialog(groupId);
    /** @type {HTMLDialogElement} */ ($("#add-track-dialog"))?.showModal();
  }

  const isSamplerTrack = (hit) => baseTrackId(hit) === "sampler";

  function assignedSampleLabel(hit) {
    const label = state.config.trackSamples?.[hit]?.label;
    return typeof label === "string" ? label.trim() : "";
  }

  function trackDisplayLabel(hit) {
    if (isSamplerTrack(hit)) {
      const sampleLabel = assignedSampleLabel(hit);
      if (sampleLabel) return sampleLabel;
    }
    const def = getTrackDef(hit);
    return isInstanceId(hit) ? instanceLabel(hit) : (def?.label || hit);
  }

  function syncTrackEditorModeButtons() {
    const gridMode = state.trackEditorMode !== "pianoRoll" && state.trackEditorMode !== "wave";
    const pianoMode = state.trackEditorMode === "pianoRoll";
    const waveMode = state.trackEditorMode === "wave";
    const gridModeBtn = $("#track-mode-grid");
    const pianoRollModeBtn = $("#track-mode-piano-roll");
    const waveModeBtn = $("#track-mode-wave");
    gridModeBtn?.classList.toggle("is-active", gridMode);
    pianoRollModeBtn?.classList.toggle("is-active", pianoMode);
    waveModeBtn?.classList.toggle("is-active", waveMode);
    gridModeBtn?.setAttribute("aria-pressed", String(gridMode));
    pianoRollModeBtn?.setAttribute("aria-pressed", String(pianoMode));
    waveModeBtn?.setAttribute("aria-pressed", String(waveMode));
  }

  function setTrackEditorMode(mode, { rebuild = true } = {}) {
    state.trackEditorMode = mode === "pianoRoll" ? "pianoRoll" : mode === "wave" ? "wave" : "grid";
    if (state.trackEditorMode === "wave") $("#sample-add-mode-loop")?.click?.();
    syncTrackEditorModeButtons();
    onTrackEditorModeChange();
    if (!rebuild) return;
    buildStepGrid();
    renderTrackExplorer();
    renderTrackInspector();
  }

  function trackLabelForId(trackId, fallback = trackId) {
    return trackDisplayLabel(trackId) || getTrackDef(trackId)?.label || fallback;
  }

  function openTrackGridView(trackId, event = {}) {
    if (!trackId) return;
    setTrackEditorMode("grid", { rebuild: false });
    if (!state.gridTrackIds.includes(trackId)) addGridTrack(trackId, { expose: true });
    selectExplorerTrackNow(trackId, event);
    buildStepGrid();
    renderTrackExplorer();
    setStatus(`${trackLabelForId(trackId)} grid view`);
  }

  function openTrackPianoRoll(trackId, options = {}) {
    const def = getTrackDef(trackId);
    if (!def) return;
    setPianoRollTrackOpen({ ...def, id: trackId, label: trackLabelForId(trackId, def.label || trackId) }, 1, options);
  }

  function openTrackWaveEdit(trackId, event = {}) {
    if (!trackId) return;
    previewTrackSelectionNow(trackId, {
      shiftKey: Boolean(event.shiftKey),
      metaKey: Boolean(event.metaKey),
      ctrlKey: Boolean(event.ctrlKey)
    });
    selectRow(trackId, { deferTrackPanels: true, bottomTab: "track" });
    updateTrackExplorerSelectionNow();
    renderStepGrid();
    $("#sample-add-mode-loop")?.click?.();
    renderTrackExplorer();
    setStatus(`${trackLabelForId(trackId)} wave edit mode`);
  }

  function openExplorerTrackMenu(event, trackId, label) {
    if (!showContextMenu || !trackId) return;
    event.preventDefault();
    event.stopPropagation();
    showContextMenu(event, [
      {
        label: `Delete ${label || trackLabelForId(trackId)}`,
        action: () => removeGridTrack(trackId)
      }
    ]);
  }

  // ── Registry-driven grid track management ───────────────────

  /** Ensure every bar carries an array for the given track id (for new tracks). */
  function ensureTrackColumn(trackId) {
    state.config.patterns.jazz.bars.forEach((bar) => {
      if (!Array.isArray(bar[trackId])) bar[trackId] = [];
    });
  }

  /**
   * After loading a project, show the default tracks plus any registry track that
   * actually has notes in the loaded bars (so saved projects with extra tracks
   * come back with those rows visible), in registry order.
   */
  function reconcileGridTracks() {
    state.gridTrackIds = reconcileGridTrackIdsBase(state.config, {
      registryIds: registryIds(),
      defaultIds: DEFAULT_GRID_TRACK_IDS,
      hiddenIds: hiddenGridTrackIds(),
      isInstanceId,
      getTrackDef,
      baseTrackId
    });
    state.gridTrackIds = orderGridTrackIds([
      ...state.gridTrackIds,
      ...trackViewTrackIds(),
      ...pianoRollTrackIds()
    ]);
  }

  /**
   * Order grid track ids by registry order, keeping each instance directly after
   * its base voice (and after earlier instances of the same base). Unknown ids
   * sink to the end.
   */
  function orderGridTrackIds(ids) {
    return orderGridTrackIdsBase(ids, {
      registryIds: registryIds(),
      baseTrackId,
      isInstanceId
    });
  }

  /** Add a registry track to the grid (if not already present). */
  function addGridTrack(trackId, { expose = false, hidden = false } = {}) {
    if (!getTrackDef(trackId)) return;
    if (hidden) hideGridTrack(trackId);
    else unhideGridTrack(trackId);
    if (expose) addProjectTrack(trackId, { render: false });
    if (state.gridTrackIds.includes(trackId)) {
      if (!hidden) onEditorLaneOpen?.("grid", trackId);
      if (expose) {
        renderTrackExplorer();
        syncJson();
      }
      return trackId;
    }
    state.gridTrackIds = [...state.gridTrackIds, trackId];
    if (!hidden) onEditorLaneOpen?.("grid", trackId);
    ensureTrackColumn(trackId);
    buildStepGrid();
    renderTrackExplorer();
    syncJson();
    setStatus(`Added ${TRACK_LABELS[trackId] || trackId} track`);
    return trackId;
  }

  /**
   * Add a fresh *instance* of an instanceable base voice (e.g. another 808 Clap).
   * The instance starts with the base voice's sends/level/pan defaults and no
   * shape override (so it inherits the global 808 shape until the user dials it
   * in). Returns the new instance id, or null if the base isn't instanceable.
   */
  function addTrackInstance(baseId, { select = true, expose = true } = {}) {
    const base = TRACK_BY_ID[baseTrackId(baseId)];
    if (!base || !base.instanceable) return null;
    const instanceId = makeInstanceId(base.id);
    state.gridTrackIds = [...state.gridTrackIds, instanceId];
    if (base.kind === "generated" || base.group === "synth") state.config.generatedRowsEditable = 1;
    if (expose) {
      addProjectTrack(instanceId, { render: false });
      onEditorLaneOpen?.("grid", instanceId);
    } else {
      hideGridTrack(instanceId);
      removeProjectTrack(instanceId);
    }
    ensureTrackColumn(instanceId);
    // Seed per-track config maps from the base defaults so the engine has sane
    // values immediately (normalizeEditorConfig also backfills, but this keeps
    // the inspector controls populated right away).
    state.config.trackBusSends = { ...(state.config.trackBusSends || {}), [instanceId]: base.busSend ?? 0.25 };
    state.config.trackReverbSends = { ...(state.config.trackReverbSends || {}), [instanceId]: base.reverbSend ?? 0.2 };
    state.config.trackLevels = { ...(state.config.trackLevels || {}), [instanceId]: base.level ?? 1 };
    state.config.trackPans = { ...(state.config.trackPans || {}), [instanceId]: base.pan ?? 0 };
    if (state.config.trackOptionDefaults?.[base.id]) {
      state.config.trackOptionDefaults = {
        ...(state.config.trackOptionDefaults || {}),
        [instanceId]: normalizeTrackOptionDefaults(state.config.trackOptionDefaults[base.id])
      };
    }
    if (state.config.trackStepCounts?.[base.id]) {
      state.config.trackStepCounts = {
        ...(state.config.trackStepCounts || {}),
        [instanceId]: normalizeTrackStepCount(state.config.trackStepCounts[base.id])
      };
    }
    applyConfig();
    buildStepGrid();
    renderTrackExplorer();
    if (select) {
      selectRow(instanceId, { bottomTab: "track" });
      renderStepGrid();
    } else {
      renderTrackInspector();
    }
    setStatus(`Added ${instanceLabel(instanceId)}`);
    return instanceId;
  }

  /** A display label for an instance: base label + a short numeric suffix. */
  function instanceLabel(id) {
    return instanceLabelFor(id, state.gridTrackIds, {
      trackLabels: TRACK_LABELS,
      baseTrackId,
      isInstanceId
    });
  }

  function replaceIdInUniqueList(list, oldId, newId) {
    const out = [];
    const seen = new Set();
    (Array.isArray(list) ? list : []).forEach((id) => {
      const nextId = id === oldId ? newId : id;
      if (!nextId || seen.has(nextId)) return;
      seen.add(nextId);
      out.push(nextId);
    });
    return out;
  }

  function replaceIdInSet(set, oldId, newId) {
    const next = new Set();
    set?.forEach?.((id) => {
      next.add(id === oldId ? newId : id);
    });
    return next;
  }

  function instrumentIdForTrack(hit) {
    const def = getTrackDef(hit);
    const base = baseTrackId(hit);
    if (def?.voice === "sample" || base === "sampler") return "sampler";
    if (def?.group === "eightOhEight") return "eightOhEight";
    return base;
  }

  function instrumentChoicesFor(hit) {
    const current = instrumentIdForTrack(hit);
    const choices = [
      { id: "sampler", label: "Sampler" },
      ...TRACK_REGISTRY
        .filter((track) => track.group === "synth" || track.group === "spaceVoices")
        .map((track) => ({ id: track.id, label: track.label || track.id })),
      { id: "eightOhEight", label: "808" }
    ];
    const currentDef = TRACK_BY_ID[current];
    if (currentDef && !choices.some((choice) => choice.id === currentDef.id)) {
      choices.push({ id: currentDef.id, label: currentDef.label || currentDef.id });
    }
    return choices;
  }

  function targetBaseForInstrument(hit, targetInstrumentId) {
    if (targetInstrumentId === "sampler") return "sampler";
    if (targetInstrumentId === "eightOhEight") return "eightOhEightKick";
    return targetInstrumentId;
  }

  function instrumentChangeTargetId(hit, targetInstrumentId) {
    if (instrumentIdForTrack(hit) === targetInstrumentId) return hit;
    const targetBaseId = targetBaseForInstrument(hit, targetInstrumentId);
    const targetDef = TRACK_BY_ID[targetBaseId];
    if (!targetDef) return null;
    if (!state.gridTrackIds.includes(targetBaseId)) return targetBaseId;
    return targetDef.instanceable ? makeInstanceId(targetBaseId) : null;
  }

  function changeTrackInstrument(hit, targetInstrumentId) {
    const sourceDef = getTrackDef(hit);
    const targetBaseId = targetBaseForInstrument(hit, targetInstrumentId);
    const targetDef = TRACK_BY_ID[targetBaseId];
    if (!sourceDef || !targetDef) return null;
    const targetId = instrumentChangeTargetId(hit, targetInstrumentId);
    if (!targetId) {
      setStatus(`${targetDef.label || targetBaseId} already has a row`);
      renderTrackInspector();
      return null;
    }
    if (targetId === hit) return hit;

    const sourceLabel = trackLabelForId(hit, sourceDef.label || hit);
    const engine = getEngine();
    const customSampleUrl = engine.trackSampleUrl?.(hit) || null;

    state.gridTrackIds = replaceIdInUniqueList(state.gridTrackIds, hit, targetId);
    state.config = replaceTrackIdInConfig(state.config, hit, targetId);
    if (targetDef.kind === "generated" || targetDef.group === "synth") state.config.generatedRowsEditable = 1;
    ensureTrackColumn(targetId);
    onTrackIdReplaced();

    state.selectedTracks = replaceIdInUniqueList(state.selectedTracks, hit, targetId);
    if (state.selected?.hit === hit) state.selected.hit = targetId;
    if (state.trackAnchor === hit) state.trackAnchor = targetId;
    if (state.pianoRollTargetTrack === hit) state.pianoRollTargetTrack = targetId;
    if (state.midiLearnTarget === hit) state.midiLearnTarget = targetId;
    state.soloTracks = replaceIdInSet(state.soloTracks, hit, targetId);
    state.mutedTracks = replaceIdInSet(state.mutedTracks, hit, targetId);
    state.config.soloTracks = Array.from(state.soloTracks);
    state.config.mutedTracks = Array.from(state.mutedTracks);

    if (customSampleUrl) {
      engine.clearTrackSample(hit);
      void engine.setTrackSample(targetId, customSampleUrl);
    }

    applyConfig();
    buildStepGrid();
    renderTrackExplorer();
    renderTrackInspector();
    renderStepGrid();
    syncJson();
    setStatus(`${sourceLabel} instrument changed to ${trackLabelForId(targetId, targetDef.label || targetId)}`);
    return targetId;
  }

  function defaultSampleLabel(hit) {
    const def = getTrackDef(hit);
    if (def?.voice === "sample" && def.sample) return `built-in ${def.sample}`;
    if (baseTrackId(hit) === "sampler") return "choose sample";
    return "—";
  }

  function renderSamplerParameter(hit, panel) {
    const sampleWrap = panel.querySelector(".track-inspector-sample");
    if (sampleWrap) {
      sampleWrap.classList.add("track-inspector-parameter", "track-inspector-parameter--sample");
      sampleWrap.classList.remove("track-inspector-parameter--hit-type");
    }
    const sampleEl = panel.querySelector('[data-field="sample"]');
    if (!sampleEl) return;
    const assigned = state.config.trackSamples?.[hit];
    sampleEl.textContent = assigned ? assigned.label : defaultSampleLabel(hit);
    sampleEl.classList.toggle("is-custom", Boolean(assigned));
  }

  function setSamplerTrackDefault(hit, key, value) {
    const current = state.config.trackOptionDefaults?.[hit] || {};
    const nextDefaults = normalizeTrackOptionDefaults({ ...current, [key]: value });
    const nextMap = { ...(state.config.trackOptionDefaults || {}) };
    if (Object.keys(nextDefaults).length) nextMap[hit] = nextDefaults;
    else delete nextMap[hit];
    state.config.trackOptionDefaults = nextMap;
    applyConfig();
  }

  function renderSamplerDefaultControls(hit, panel) {
    const defaults = trackOptionDefaultsFor(state.config, hit);
    const wrap = document.createElement("div");
    wrap.className = "track-inspector-extra-config track-inspector-sampler-defaults";
    SAMPLER_TRACK_DEFAULT_CONTROLS.forEach(({ key, label, min, max, step, format }) => {
      const current = defaults[key] ?? STEP_OPTION_DEFAULTS[key];
      const lbl = document.createElement("label");
      const span = document.createElement("span");
      span.textContent = label;
      const range = document.createElement("input");
      range.type = "range";
      range.min = String(min);
      range.max = String(max);
      range.step = String(step);
      range.value = String(current);
      range.dataset.midiParam = `track.${hit}.default.${key}`;
      range.dataset.midiLabel = `${instanceLabel(hit)} ${label} default`;
      range.dataset.midiAction = "value";
      const out = document.createElement("output");
      out.textContent = format(current);
      const number = document.createElement("input");
      number.className = "selected-number";
      number.type = "number";
      number.min = String(min);
      number.max = String(max);
      number.step = String(step);
      number.value = String(current);
      const commit = (raw) => {
        const value = clamp(raw, min, max, current);
        range.value = number.value = String(value);
        out.textContent = format(value);
        setSamplerTrackDefault(hit, key, value);
      };
      range.addEventListener("input", () => commit(range.value));
      range.addEventListener("change", syncJson);
      wireNumberControl(number, (value) => {
        commit(value);
        syncJson();
      });
      lbl.append(span, range, out, number);
      wrap.appendChild(lbl);
    });
    const sampleWrap = panel.querySelector(".track-inspector-sample");
    sampleWrap ? sampleWrap.after(wrap) : panel.querySelector("[data-track-panel]")?.appendChild(wrap);
  }

  function renderEightOhEightParameter(hit, panel) {
    const sampleWrap = panel.querySelector(".track-inspector-sample");
    const row = panel.querySelector(".track-inspector-sample-row");
    if (!sampleWrap || !row) return;
    sampleWrap.classList.add("track-inspector-parameter", "track-inspector-parameter--hit-type");
    sampleWrap.classList.remove("track-inspector-parameter--sample");
    const label = sampleWrap.querySelector(".track-inspector-sublabel");
    if (label) label.textContent = "Hit Type";
    row.innerHTML = "";
    const select = document.createElement("select");
    select.className = "track-param-select";
    select.setAttribute("aria-label", "808 hit type");
    TRACK_REGISTRY
      .filter((track) => track.group === "eightOhEight")
      .forEach((track) => {
        const option = document.createElement("option");
        option.value = track.id;
        option.textContent = track.label.replace(/^808\s+/i, "") || track.label || track.id;
        select.appendChild(option);
      });
    select.value = baseTrackId(hit);
    select.addEventListener("change", () => {
      const next = changeTrackInstrument(hit, select.value);
      if (!next) select.value = baseTrackId(hit);
      else setStatus(`808 hit type set to ${TRACK_LABELS[baseTrackId(next)] || baseTrackId(next)}`);
    });
    row.appendChild(select);
  }

  function renderDefaultEightOhEightParameter(panel) {
    const sampleWrap = panel.querySelector(".track-inspector-sample");
    const row = panel.querySelector(".track-inspector-sample-row");
    if (!sampleWrap || !row || typeof defaultNoteState !== "function" || typeof setDefaultNoteInstrument !== "function") return;
    sampleWrap.classList.add("track-inspector-parameter", "track-inspector-parameter--hit-type");
    sampleWrap.classList.remove("track-inspector-parameter--sample");
    const label = sampleWrap.querySelector(".track-inspector-sublabel");
    if (label) label.textContent = "Hit Type";
    row.innerHTML = "";
    const select = document.createElement("select");
    select.className = "track-param-select";
    select.setAttribute("aria-label", "Default 808 hit type");
    TRACK_REGISTRY
      .filter((track) => track.group === "eightOhEight")
      .forEach((track) => {
        const option = document.createElement("option");
        option.value = track.id;
        option.textContent = track.label.replace(/^808\s+/i, "") || track.label || track.id;
        select.appendChild(option);
      });
    select.value = baseTrackId(defaultNoteState().instrument || "eightOhEightKick");
    select.addEventListener("change", () => {
      setDefaultNoteInstrument(select.value);
      setStatus(`Default 808 hit type ${TRACK_LABELS[select.value] || select.value}`);
    });
    row.appendChild(select);
  }

  function buildDefaultNoteInspectorPanel() {
    if (!trackInspectorTemplate || typeof defaultNoteState !== "function" || typeof setDefaultNoteInstrument !== "function") return null;
    const defaults = defaultNoteState();
    const instrument = defaults.instrument || "eightOhEightKick";
    const frag = trackInspectorTemplate.content.cloneNode(true);
    const panel = frag.querySelector("[data-track-panel]");
    if (!panel) return null;
    panel.classList.add("track-inspector-default-note");
    panel.dataset.trackId = instrument;

    const instrumentSelect = panel.querySelector('[data-control="instrument"]');
    if (instrumentSelect) {
      const currentInstrument = instrumentIdForTrack(instrument);
      instrumentChoicesFor(instrument).forEach((choice) => {
        const option = document.createElement("option");
        option.value = choice.id;
        option.textContent = choice.label || choice.id;
        instrumentSelect.appendChild(option);
      });
      instrumentSelect.value = currentInstrument;
      instrumentSelect.title = "Default instrument for new notes";
      instrumentSelect.addEventListener("change", () => {
        const next = targetBaseForInstrument(instrument, instrumentSelect.value);
        setDefaultNoteInstrument(next);
      });
    }

    const closeButton = panel.querySelector('[data-action="deselect"]');
    if (closeButton) closeButton.remove();
    const gridLayout = panel.querySelector(".track-inspector-layout");
    if (gridLayout) {
      gridLayout.hidden = true;
      gridLayout.style.display = "none";
    }
    ["level", "pan", "busSend", "reverbSend"].forEach((key) => {
      const label = panel.querySelector(`[data-control="${key}"]`)?.closest("label");
      if (label) label.remove();
    });
    const shapeWrap = panel.querySelector('[data-field="shape"]');
    if (shapeWrap) shapeWrap.remove();

    if (instrumentIdForTrack(instrument) === "eightOhEight") {
      renderDefaultEightOhEightParameter(panel);
    } else {
      const sampleWrap = panel.querySelector(".track-inspector-sample");
      if (sampleWrap) sampleWrap.remove();
    }
    return panel;
  }

  /** Remove a registry track from the grid. */
  function removeGridTrack(trackId) {
    const def = getTrackDef(trackId);
    if (!def) return;
    const label = trackLabelForId(trackId, def.label || trackId);
    state.gridTrackIds = state.gridTrackIds.filter((id) => id !== trackId);
    hideGridTrack(trackId);
    removeProjectTrack(trackId);
    if (Array.isArray(state.config.pianoRollTracks)) {
      state.config.pianoRollTracks = state.config.pianoRollTracks.filter((id) => id !== trackId);
    }
    if (state.pianoRollTargetTrack === trackId) {
      state.pianoRollTargetTrack = pianoRollTrackIds()[0] || null;
    }
    if (state.selected?.hit === trackId) resetSelectedPanel();
    state.soloTracks.delete(trackId);
    state.mutedTracks?.delete?.(trackId);
    // Drop the removed track's per-track config so it doesn't linger in saved
    // JSON or get resurfaced by reconcileGridTracks on the next load.
    state.config = removeTrackFromConfigMaps(state.config, trackId);
    state.config.patterns.jazz.bars.forEach((bar) => {
      if (bar && trackId in bar) delete bar[trackId];
    });
    getEngine().setConfig(previewConfig());
    buildStepGrid();
    renderTrackExplorer();
    renderTrackInspector();
    syncJson();
    setStatus(`Removed ${label} track`);
  }

  /** Build the grouped checkbox list inside the Add Track dialog. */
  function renderAddTrackDialog(focusGroupId = null) {
    const host = $("#add-track-groups");
    if (!host) return;
    host.innerHTML = "";
    const dialog = $("#add-track-dialog");
    const title = dialog?.querySelector("h2");
    const hint = dialog?.querySelector(".add-track-hint");
    const groups = tracksByGroup()
      .filter(({ group }) => group.id !== "sampler")
      .filter(({ group }) => !focusGroupId || group.id === focusGroupId);
    const focusedGroup = groups[0]?.group || null;
    if (title) title.textContent = focusedGroup ? `Add ${focusedGroup.label}` : "Add Track";
    if (hint) {
      hint.textContent = focusedGroup
        ? `Pick instruments for ${focusedGroup.label}. Use ++ to add multiple independent instances of a voice.`
        : "Pick instruments to add to the grid. Use ++ to add multiple independent instances of a voice.";
    }
    groups.forEach(({ group, tracks }) => {
      const section = document.createElement("div");
      section.className = "add-track-group";
      const heading = document.createElement("div");
      heading.className = "add-track-group-heading";
      heading.textContent = group.label;
      if (group.accent) heading.style.setProperty("--group-accent", group.accent);
      section.appendChild(heading);

      const list = document.createElement("div");
      list.className = "add-track-group-list";
      tracks.forEach((track) => {
        const onGrid = state.gridTrackIds.includes(track.id);
        const instanceCount = track.instanceable
          ? state.gridTrackIds.filter((id) => isInstanceId(id) && baseTrackId(id) === track.id).length
          : 0;

        const chipWrap = document.createElement("div");
        chipWrap.className = "add-track-chip-wrap";

        const item = document.createElement("button");
        item.type = "button";
        item.className = `add-track-chip ${onGrid ? "is-on-grid" : ""}`;
        const countLabel = instanceCount > 0 ? ` ·${1 + instanceCount}` : "";
        item.textContent = onGrid ? `✓ ${track.label}${countLabel}` : `+ ${track.label}`;
        item.title = onGrid ? `Remove ${track.label}` : `Add ${track.label}`;
        item.addEventListener("click", () => {
          if (state.gridTrackIds.includes(track.id)) {
            removeGridTrack(track.id);
          } else {
            addGridTrack(track.id, { expose: true });
          }
          renderAddTrackDialog();
        });
        chipWrap.appendChild(item);

        // Instanceable voices get a "++" button to add an independent instance
        // (e.g. a second 808 Clap with its own shape/sends/level/pan).
        if (track.instanceable) {
          const dupe = document.createElement("button");
          dupe.type = "button";
          dupe.className = "add-track-chip-dupe";
          dupe.textContent = "++";
          dupe.title = `Add another ${track.label} (independent shape & mix)`;
          dupe.addEventListener("click", () => {
            // Adding an instance implies the base voice should be present too, so
            // the group renders; if the base isn't on the grid, add it first.
            if (!state.gridTrackIds.includes(track.id)) addGridTrack(track.id, { expose: true });
            addTrackInstance(track.id, { select: false });
            renderAddTrackDialog();
          });
          chipWrap.appendChild(dupe);
        }

        list.appendChild(chipWrap);
      });
      section.appendChild(list);
      host.appendChild(section);
    });

  }

  // ── Track Explorer (right-side track list) ──────────────────

  /** Re-render the grouped track list in the right-side Track Explorer. */
  function renderTrackExplorer() {
    if (!trackExplorerList) return;
    trackExplorerList.innerHTML = "";
    const selectedSet = new Set(state.selectedTracks.length ? state.selectedTracks : (state.selected?.hit ? [state.selected.hit] : []));
    const projectIds = trackExplorerIdsForMode();
    const projectIdSet = new Set(projectIds);
    TRACK_GROUPS.filter((group) => projectIds.some((id) => getTrackDef(id)?.group === group.id)).forEach((group) => {
      const groupTrackIds = projectIds.filter((id) => getTrackDef(id)?.group === group.id);
      const registryGroup = TRACK_REGISTRY.filter((track) => track.group === group.id);
      if (groupTrackIds.length === 0) return;
      const collapsed = collapsedVoiceGroups.has(group.id);
      const groupEl = document.createElement("div");
      groupEl.className = `track-explorer-group ${collapsed ? "is-collapsed" : ""}`;
      const heading = document.createElement("div");
      heading.className = "track-explorer-group-heading";
      if (group.accent) heading.style.setProperty("--group-accent", group.accent);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "track-explorer-group-toggle";
      toggle.textContent = collapsed ? "+" : "-";
      toggle.title = `${collapsed ? "Expand" : "Collapse"} ${group.label}`;
      toggle.addEventListener("click", () => {
        if (collapsedVoiceGroups.has(group.id)) collapsedVoiceGroups.delete(group.id);
        else collapsedVoiceGroups.add(group.id);
        renderTrackExplorer();
      });
      const label = document.createElement("span");
      label.className = "track-explorer-group-label";
      label.textContent = group.label;
      heading.append(toggle, label);
      groupEl.appendChild(heading);

      if (!collapsed) {
        if (group.id === "sampler") {
          groupTrackIds.forEach((hit) => {
            const active = selectedSet.has(hit);
            const assigned = state.config.trackSamples?.[hit];
            const labelText = trackDisplayLabel(hit);
            const row = document.createElement("div");
            row.className = `track-explorer-row track-explorer-row--sampler ${active ? "is-selected" : ""}`;
            row.dataset.trackId = hit;

            const name = document.createElement("button");
            name.type = "button";
            name.className = "track-explorer-name";
            name.textContent = labelText;
            const instanceName = instanceLabel(hit);
            name.title = assigned
              ? `${labelText} — ${instanceName} · Click to select · Shift-click to add a range · ⌘/Ctrl-click to toggle`
              : `${instanceName} — Click to select · Shift-click to add a range · ⌘/Ctrl-click to toggle`;
            if (assigned) {
              const dot = document.createElement("span");
              dot.className = "track-explorer-sample-dot";
              dot.title = "Custom sample assigned";
              name.appendChild(dot);
            }
            let skipNameClick = false;
            name.addEventListener("pointerdown", (event) => {
              if (event.button !== 0) return;
              skipNameClick = true;
              event.preventDefault();
              selectExplorerTrackNow(hit, event);
            });
            name.addEventListener("click", (event) => {
              if (skipNameClick) {
                skipNameClick = false;
                return;
              }
              selectExplorerTrackNow(hit, event);
            });

            row.addEventListener("contextmenu", (event) => openExplorerTrackMenu(event, hit, labelText));
            row.append(name);
            groupEl.appendChild(row);
          });
          if (groupTrackIds.length === 0) {
            const empty = document.createElement("p");
            empty.className = "track-explorer-empty";
            empty.textContent = "No pasted sampler tracks.";
            groupEl.appendChild(empty);
          }
          trackExplorerList.appendChild(groupEl);
          return;
        }
        const addedTracks = registryGroup.filter((track) => projectIds.some((id) => baseTrackId(id) === track.id));
        addedTracks.forEach((track) => {
          const ids = trackIdsForBase(track.id).filter((id) => projectIdSet.has(id));
          const count = ids.length;
          const pianoRollMode = state.trackEditorMode === "pianoRoll";
          const pianoRollOpen = pianoRollMode && pianoRollTrackIds().includes(track.id);
          const primaryId = ids[0] || track.id;
          const active = ids.some((id) => selectedSet.has(id));
          const row = document.createElement("div");
          row.className = `track-explorer-row ${active || (pianoRollOpen && state.pianoRollTargetTrack === track.id) ? "is-selected" : ""} ${count === 0 && !pianoRollMode ? "is-empty" : ""}`;
          row.dataset.trackId = primaryId;
          row.dataset.trackAggregate = "base";

          const name = document.createElement("button");
          name.type = "button";
          name.className = "track-explorer-name";
          const trackLabel = track.label || track.id;
          name.textContent = trackLabel;
          name.title = pianoRollMode
            ? `${trackLabel} — Click to open/select this piano roll`
            : count > 0
            ? `${trackLabel} — Click to select · Shift-click to add a range · ⌘/Ctrl-click to toggle`
            : `${trackLabel} is not on the grid`;
          name.disabled = !pianoRollMode && count === 0;
          const hasSample = ids.some((id) => Boolean(state.config.trackSamples?.[id]));
          if (hasSample) {
            const dot = document.createElement("span");
            dot.className = "track-explorer-sample-dot";
            dot.title = "Custom sample assigned";
            name.appendChild(dot);
          }
          const selectExplorerRowNow = (event) => {
            if (pianoRollMode) {
              if (!pianoRollTrackIds().includes(track.id)) {
                setPianoRollTrackOpen(track, 1);
                return;
              }
              state.pianoRollTargetTrack = track.id;
            } else if (count === 0) return;
            selectExplorerTrackNow(primaryId, event);
          };
          let skipNameClick = false;
          name.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || (!pianoRollMode && count === 0)) return;
            skipNameClick = true;
            event.preventDefault();
            selectExplorerRowNow(event);
          });
          name.addEventListener("click", (event) => {
            if (skipNameClick) {
              skipNameClick = false;
              return;
            }
            selectExplorerRowNow(event);
          });

          row.addEventListener("contextmenu", (event) => openExplorerTrackMenu(event, primaryId, trackLabel));
          row.append(name);
          groupEl.appendChild(row);
        });
        if (addedTracks.length === 0) {
          const empty = document.createElement("p");
          empty.className = "track-explorer-empty";
          empty.textContent = "No tracks added.";
          groupEl.appendChild(empty);
        }
      }
      trackExplorerList.appendChild(groupEl);
    });

    if (!trackExplorerList.children.length) {
      const empty = document.createElement("p");
      empty.className = "track-explorer-empty";
      empty.textContent = emptyTrackExplorerMessage();
      trackExplorerList.appendChild(empty);
    }
    if (typeof window !== "undefined") window.rhythmEditorRenderTrackPalettes?.();
  }

  // ── Per-track 808 shape (state-aware wrappers + DOM renderer) ─────────

  /** Is this track id an 808-kit voice (base or instance) that supports shaping? */
  function trackSupportsShape(hit) {
    return baseTrackId(hit).startsWith("eightOhEight") && getTrackDef(hit)?.group === "eightOhEight";
  }

  /** Global default for a shape field, read from the Mix-panel 808 knobs. */
  function globalShapeValue(field) {
    return globalShapeValueBase(state.config, field);
  }

  /** Resolve a field's effective value + whether it's a per-track override. */
  function resolvedShapeValue(hit, field) {
    return resolvedShapeValueBase(state.config, hit, field);
  }

  /** Write (or clear) a per-track shape field and apply it live. */
  function setTrackShapeField(hit, key, value) {
    if (setTrackShapeFieldBase(state.config, hit, key, value)) {
      applyConfig();
    }
  }

  /** Remove all per-track shape overrides for a track (revert to global). */
  function resetTrackShape(hit) {
    if (!hit) return;
    if (clearTrackShape(state.config, hit)) {
      applyConfig();
    }
    renderTrackInspector();
    setStatus(`${instanceLabel(hit)} shape reset to global`);
  }

  /** Build the per-track 808 shape slider rows inside a panel's container. */
  function renderTrackShapeControls(hit, container) {
    if (!container) return;
    container.innerHTML = "";
    if (!hit || !trackSupportsShape(hit)) return;
    TRACK_SHAPE_FIELDS.forEach((field) => {
      const { value, overridden } = resolvedShapeValue(hit, field);
      const label = document.createElement("label");
      label.className = `track-shape-row ${overridden ? "is-overridden" : "is-inherited"}`;

      const name = document.createElement("span");
      name.className = "track-shape-name";
      name.textContent = field.label;
      if (!overridden) name.title = "Inherited from the global 808 default";

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = String(field.min);
      slider.max = String(field.max);
      slider.step = String(field.step);
      slider.value = String(value);
      slider.dataset.midiParam = `track.${hit}.shape.${field.key}`;
      slider.dataset.midiLabel = `${instanceLabel(hit)} ${field.label}`;
      slider.dataset.midiAction = "value";

      const out = document.createElement("output");
      out.className = "track-shape-value";
      out.textContent = formatShapeValue(field, value);

      slider.addEventListener("input", () => {
        setTrackShapeField(hit, field.key, slider.value);
        out.textContent = formatShapeValue(field, Number(slider.value));
        label.classList.remove("is-inherited");
        label.classList.add("is-overridden");
      });

      label.append(name, slider, out);
      container.appendChild(label);
    });
  }

  // ── Track Inspector ──────────────────────────────────────────

  function trackStepCount(hit) {
    return normalizeTrackStepCount(state.config.trackStepCounts?.[hit] ?? DEFAULT_TRACK_STEPS_PER_BAR);
  }

  function setTrackStepCount(hit, value) {
    const nextValue = normalizeTrackStepCount(value);
    const next = { ...(state.config.trackStepCounts || {}) };
    if (nextValue === DEFAULT_TRACK_STEPS_PER_BAR) delete next[hit];
    else next[hit] = nextValue;
    state.config.trackStepCounts = next;
    applyConfig();
    buildStepGrid();
    renderTrackExplorer();
    renderTrackInspector();
    syncJson();
    setStatus(`${instanceLabel(hit)} grid set to ${nextValue} steps/bar`);
  }

  function trackIdsForBase(baseId) {
    return state.gridTrackIds.filter((id) => baseTrackId(id) === baseId);
  }

  function pianoRollTrackIds() {
    if (!Array.isArray(state.config.pianoRollTracks)) state.config.pianoRollTracks = [];
    return state.config.pianoRollTracks;
  }

  function sortedPianoRollTrackIds(ids) {
    const order = new Map(TRACK_REGISTRY.map((track, index) => [track.id, index]));
    return [...new Set(ids)]
      .filter((id) => typeof id === "string" && getTrackDef(id))
      .sort((a, b) => (order.get(baseTrackId(a)) ?? 9999) - (order.get(baseTrackId(b)) ?? 9999));
  }

  function ensureTrackPatternRows(trackId) {
    const bars = state.config.patterns?.jazz?.bars || [];
    bars.forEach((bar) => {
      if (bar && !Array.isArray(bar[trackId])) bar[trackId] = [];
    });
  }

  function setPianoRollTrackOpen(track, value, { exposeGrid = true } = {}) {
    if (!track) return;
    const target = Math.round(Number(value)) >= 1 ? 1 : 0;
    const next = new Set(pianoRollTrackIds());
    if (target) {
      next.add(track.id);
      if (!state.gridTrackIds.includes(track.id)) addGridTrack(track.id, { expose: exposeGrid, hidden: !exposeGrid });
      else if (exposeGrid) addProjectTrack(track.id, { render: false });
      else {
        hideGridTrack(track.id);
        removeProjectTrack(track.id);
      }
      onEditorLaneOpen?.("piano", track.id);
      ensureTrackPatternRows(track.id);
      state.config.generatedRowsEditable = 1;
      state.pianoRollTargetTrack = track.id;
      selectRow(track.id, { deferTrackPanels: true, bottomTab: "track" });
      setStatus(`Opened ${track.label || track.id} piano roll`);
    } else {
      next.delete(track.id);
      if (state.pianoRollTargetTrack === track.id) {
        state.pianoRollTargetTrack = sortedPianoRollTrackIds(next)[0] || null;
      }
      setStatus(`Closed ${track.label || track.id} piano roll`);
    }
    state.config.pianoRollTracks = sortedPianoRollTrackIds(next);
    applyConfig();
    buildStepGrid();
    renderTrackExplorer();
    renderTrackInspector();
    syncJson();
  }

  function setTrackVoiceCount(track, value) {
    if (!track) return;
    const max = track.instanceable ? 32 : 1;
    const min = 0;
    let target = Math.round(Number(value));
    if (!Number.isFinite(target)) target = trackIdsForBase(track.id).length;
    target = Math.max(min, Math.min(max, target));

    let ids = trackIdsForBase(track.id);
    if (!track.instanceable) {
      if (target === 0 && ids.length) removeGridTrack(track.id);
      if (target === 1 && !ids.length) addGridTrack(track.id, { expose: true });
      renderTrackExplorer();
      return;
    }

    if (target > 0 && !state.gridTrackIds.includes(track.id)) {
      addGridTrack(track.id, { expose: true });
    }
    ids = trackIdsForBase(track.id);
    while (ids.length < target) {
      addTrackInstance(track.id, { select: false });
      ids = trackIdsForBase(track.id);
    }
    while (ids.length > target) {
      const removableId = [...ids].reverse()[0] || null;
      if (!removableId) break;
      removeGridTrack(removableId);
      ids = trackIdsForBase(track.id);
    }
    renderTrackExplorer();
  }

  /**
   * Build one inspector panel (cloned from the template) for a single track id,
   * wiring its sample row, instrument controls, optional 808 shape, and
   * Delete actions. Each panel is fully independent so several can be
   * shown at once for a multi-track selection.
   */
  function buildTrackInspectorPanel(hit) {
    const def = getTrackDef(hit);
    const frag = trackInspectorTemplate.content.cloneNode(true);
    const panel = frag.querySelector("[data-track-panel]");
    panel.dataset.trackId = hit;

    const nameEl = panel.querySelector('[data-field="name"]');
    if (nameEl) nameEl.textContent = trackDisplayLabel(hit);

    const instrumentSelect = panel.querySelector('[data-control="instrument"]');
    if (instrumentSelect) {
      const currentInstrument = instrumentIdForTrack(hit);
      instrumentChoicesFor(hit).forEach((instrument) => {
        const option = document.createElement("option");
        option.value = instrument.id;
        option.textContent = instrument.label || instrument.id;
        instrumentSelect.appendChild(option);
      });
      instrumentSelect.value = currentInstrument;
      instrumentSelect.title = `Instrument: ${trackDisplayLabel(hit)}`;
      instrumentSelect.addEventListener("change", () => {
        const next = changeTrackInstrument(hit, instrumentSelect.value);
        if (!next) instrumentSelect.value = currentInstrument;
      });
    }

    const sampleWrap = panel.querySelector(".track-inspector-sample");
    const instrumentKind = instrumentIdForTrack(hit);
    if (instrumentKind === "eightOhEight") {
      renderEightOhEightParameter(hit, panel);
    } else if (instrumentKind === "sampler") {
      renderSamplerParameter(hit, panel);
      renderSamplerDefaultControls(hit, panel);
    } else if (sampleWrap) {
      sampleWrap.hidden = true;
      sampleWrap.style.display = "none";
    }

    const gridLayout = panel.querySelector(".track-inspector-layout");
    if (gridLayout) {
      gridLayout.hidden = true;
      gridLayout.style.display = "none";
    }

    // Paired range + number controls for track defaults. Level/Pan/Delay/Reverb
    // are surfaced in the Effects tab so the Instrument panel stays instrument-only.
    const wireParam = (key, label, getValue, setValue, format, min, max, step) => {
      const range = panel.querySelector(`[data-control="${key}"]`);
      const number = panel.querySelector(`[data-number="${key}"]`);
      const output = panel.querySelector(`[data-output="${key}"]`);
      if (!range || !number || !output) return;
      range.dataset.midiParam = `track.${hit}.${key}`;
      range.dataset.midiLabel = `${instanceLabel(hit)} ${label}`;
      range.dataset.midiAction = "value";
      range.min = number.min = String(min);
      range.max = number.max = String(max);
      range.step = number.step = String(step);
      const value = getValue(hit);
      range.value = number.value = String(value);
      output.textContent = format(value);
      const commit = (raw) => {
        const v = clamp(raw, min, max, value);
        range.value = number.value = String(v);
        output.textContent = format(v);
        setValue(hit, v);
      };
      range.addEventListener("input", () => commit(range.value));
      wireNumberControl(number, commit);
    };
    wireParam("level", "Level", mix.getLevel, mix.setLevel, (v) => Number(v).toFixed(2), 0, 2, 0.01);
    wireParam("pan", "Pan", mix.getPan, mix.setPan, formatPan, -1, 1, 0.01);
    wireParam("busSend", "Note Delay", mix.getBusSend, mix.setBusSend, (v) => Number(v).toFixed(2), 0, 1, 0.01);
    wireParam("reverbSend", "Reverb", mix.getReverbSend, mix.setReverbSend, (v) => Number(v).toFixed(2), 0, 1, 0.01);
    ["level", "pan", "busSend", "reverbSend"].forEach((key) => {
      const label = panel.querySelector(`[data-control="${key}"]`)?.closest("label");
      if (!label) return;
      label.hidden = true;
      label.style.display = "none";
    });

    // Extra voice-specific config sliders declared in the track registry.
    const baseDef = TRACK_BY_ID[baseTrackId(hit)];
    if (baseDef?.extraConfig?.length) {
      const extraWrap = document.createElement("div");
      extraWrap.className = "track-inspector-extra-config";
      baseDef.extraConfig.forEach(({ label, key, min, max, step }) => {
        const current = state.config[key] ?? ((min + max) / 2);
        const lbl = document.createElement("label");
        const span = document.createElement("span");
        span.textContent = label;
        const range = document.createElement("input");
        range.type = "range";
        range.min = String(min); range.max = String(max); range.step = String(step);
        range.value = String(current);
        range.dataset.midiParam = `config.${key}`;
        range.dataset.midiLabel = `${instanceLabel(hit)} ${label}`;
        range.dataset.midiAction = "value";
        const out = document.createElement("output");
        out.textContent = Number(current).toFixed(step < 1 ? 2 : 0);
        range.addEventListener("input", () => {
          state.config[key] = Number(range.value);
          out.textContent = Number(range.value).toFixed(step < 1 ? 2 : 0);
          applyConfig();
        });
        lbl.append(span, range, out);
        extraWrap.appendChild(lbl);
      });
      const sampleWrap = panel.querySelector(".track-inspector-sample:not([hidden])");
      sampleWrap ? sampleWrap.after(extraWrap) : panel.querySelector("[data-track-panel]")?.appendChild(extraWrap);
    }

    // Per-track 808 shape (only for 808-kit voices).
    const shapeWrap = panel.querySelector('[data-field="shape"]');
    const supportsShape = trackSupportsShape(hit);
    if (shapeWrap) {
      shapeWrap.hidden = !supportsShape;
      shapeWrap.style.display = supportsShape ? "" : "none";
      if (supportsShape) {
        renderTrackShapeControls(hit, panel.querySelector('[data-field="shape-controls"]'));
      }
    }

    // Action buttons (delegated handlers via data-action + the panel's data-track-id).
    const delBtn = panel.querySelector('[data-action="delete"]');
    if (delBtn) {
      delBtn.disabled = false;
      delBtn.title = `Remove ${trackDisplayLabel(hit)}`;
    }
    const actions = panel.querySelector(".track-inspector-actions");
    if (actions && Array.from(actions.children).every((btn) => btn.hidden)) {
      actions.remove();
    }

    // Wire panel-scoped action buttons.
    panel.querySelectorAll("[data-action]").forEach((btn) => {
      const action = btn.dataset.action;
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        handleInspectorAction(action, hit);
      });
    });

    return panel;
  }

  /** Dispatch a per-panel inspector action for a given track id. */
  function handleInspectorAction(action, hit) {
    switch (action) {
      case "audition":
        void auditionTrackById(hit);
        break;
      case "clear-sample":
        clearTrackSample(hit);
        break;
      case "reset-shape":
        resetTrackShape(hit);
        break;
      case "delete":
        removeGridTrack(hit);
        break;
      case "deselect":
        deselectInspectorTrack(hit);
        break;
      default:
        break;
    }
  }

  /** Remove one track from the multi-track inspector selection. */
  function deselectInspectorTrack(hit) {
    const next = state.selectedTracks.filter((id) => id !== hit);
    if (next.length === 0) {
      resetSelectedPanel();
      renderStepGrid();
      return;
    }
    state.selectedTracks = next;
    if (state.trackAnchor === hit) state.trackAnchor = next[next.length - 1];
    if (state.selected?.hit === hit) {
      selectRow(next[0], { keepTracks: true, bottomTab: "track" });
    }
    renderTrackInspector();
    renderTrackExplorer();
    renderStepGrid();
  }

  /**
   * Render the Track Inspector. Builds one panel per selected track (in grid
   * order) so a shift-click multi-selection shows several independent panels.
   */
  function renderTrackInspector() {
    if (!trackInspectorPanels || !trackInspectorTemplate) return;
    const selectedIds = state.selectedTracks.length
      ? state.selectedTracks
      : (state.selected?.hit ? [state.selected.hit] : []);
    let tracks = orderBySelectedGrid(selectedIds.filter((id) => state.gridTrackIds.includes(id)));
    if (state.trackEditorMode === "pianoRoll") {
      const openPianoRollTracks = new Set(pianoRollTrackIds());
      tracks = tracks.filter((id) => openPianoRollTracks.has(id));
    }
    onTrackInspectorSelectionChange(tracks.length);
    trackInspectorPanels.innerHTML = "";
    if (trackInspectorName) {
      trackInspectorName.textContent = tracks.length === 0
        ? "No track selected"
        : tracks.length === 1
          ? trackDisplayLabel(tracks[0])
          : `${tracks.length} tracks`;
    }
    if (trackInspectorMultiHint) {
      trackInspectorMultiHint.hidden = tracks.length > 1;
    }
    if (!tracks.length) {
      const defaultPanel = buildDefaultNoteInspectorPanel();
      if (defaultPanel) {
        if (trackInspectorName) trackInspectorName.textContent = "Default Note";
        if (trackInspectorMultiHint) trackInspectorMultiHint.hidden = true;
        trackInspectorPanels.appendChild(defaultPanel);
      }
      return;
    }
    tracks.forEach((hit) => {
      trackInspectorPanels.appendChild(buildTrackInspectorPanel(hit));
    });
  }

  /** Audition any track by id (used by per-panel ▶ buttons). */
  async function auditionTrackById(hit) {
    if (!hit) return;
    if (runningFromFile) {
      setStatus("Open the localhost version for audio");
      return;
    }
    await getEngine().auditionTrack(hit, { gain: 0.7 });
    setStatus(`Auditioned ${instanceLabel(hit)}`);
  }

  // ── Per-track custom samples ─────────────────────────────────

  /** Apply a custom sample to a track (config + engine) and refresh UI. */
  async function assignSampleToTrack(hit, sample, { expose = true } = {}) {
    if (!hit) return;
    if (expose) addProjectTrack(hit, { render: false });
    else {
      hideGridTrack(hit);
      removeProjectTrack(hit);
    }
    const source = sample.source || (sample.handleId ? SAMPLE_SOURCE_BROWSER_HANDLE : sample.url ? SAMPLE_SOURCE_BUNDLED : SAMPLE_SOURCE_LOCAL_FILE);
    const stored = {
      source,
      label: sample.label,
      root: sample.root ?? null,
      path: sample.path ?? null,
      handleId: sample.handleId ?? null,
      relinkRequired: Boolean(sample.relinkRequired)
    };
    if (sample.url && source === SAMPLE_SOURCE_BUNDLED) stored.url = sample.url;
    state.config.trackSamples = {
      ...(state.config.trackSamples || {}),
      [hit]: stored
    };
    const resolved = !sample.url && sample.handleId
      ? await resolveFileHandleSample(sample.handleId, { requestPermission: false }).catch(() => null)
      : null;
    const playbackUrl = sample.url || resolved?.url || null;
    if (!playbackUrl) {
      renderTrackInspector();
      renderTrackExplorer();
      syncJson();
      setStatus(`${sample.label} will need relinking after reload`);
      return;
    }
    renderTrackInspector();
    renderTrackExplorer();
    syncJson();
    setStatus(`Loading ${sample.label} into ${instanceLabel(hit)}`);
    const ok = await getEngine().setTrackSample(hit, playbackUrl);
    if (!ok) {
      setStatus(`Could not load ${sample.label}`);
      return;
    }
    renderTrackInspector();
    renderTrackExplorer();
    syncJson();
    setStatus(`Loaded ${sample.label} into ${instanceLabel(hit)}`);
  }

  /** Clear a track's custom sample, reverting to the built-in voice. */
  function clearTrackSample(hit) {
    if (!hit) return;
    if (state.config.trackSamples?.[hit]) {
      const next = { ...state.config.trackSamples };
      delete next[hit];
      state.config.trackSamples = next;
    }
    getEngine().clearTrackSample(hit);
    renderTrackInspector();
    renderTrackExplorer();
    syncJson();
    setStatus(`${TRACK_LABELS[hit] || hit} reset to built-in voice`);
  }

  /** Re-apply all saved custom samples to the engine (after load). */
  async function reapplyTrackSamples() {
    const engine = getEngine();
    const samples = state.config.trackSamples || {};
    // Drop any engine samples that the loaded config no longer references.
    (engine.customSampleUrls ? Array.from(engine.customSampleUrls.keys()) : [])
      .filter((hit) => !samples[hit])
      .forEach((hit) => engine.clearTrackSample(hit));
    await Promise.all(Object.entries(samples).map(async ([hit, entry]) => {
      let url = entry.url && !entry.url.startsWith("blob:") ? entry.url : null;
      if (!url && entry.handleId) {
        const resolved = await resolveFileHandleSample(entry.handleId, { requestPermission: false }).catch(() => null);
        url = resolved?.url || null;
      }
      if (!url) return false;
      return engine.setTrackSample(hit, url).catch(() => false);
    }));
  }

  return {
    // grid-track management
    reconcileGridTracks,
    orderGridTrackIds,
    addGridTrack,
    addTrackInstance,
    addProjectTrack,
    openTrackPianoRoll,
    removeGridTrack,
    instanceLabel,
    renderAddTrackDialog,
    openAddTrackDialog,
    // explorer + inspector
    renderTrackExplorer,
    renderTrackInspector,
    // 808 shape (also injected into the global mix panel)
    trackSupportsShape,
    globalShapeValue,
    resolvedShapeValue,
    setTrackShapeField,
    resetTrackShape,
    renderTrackShapeControls,
    // samples
    assignSampleToTrack,
    clearTrackSample,
    reapplyTrackSamples,
    trackStepCount,
    setTrackStepCount,
    // misc
    auditionTrackById
  };
}
