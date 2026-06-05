// Track panels controller.
//
import {
  SAMPLE_SOURCE_BUNDLED,
  SAMPLE_SOURCE_BROWSER_HANDLE,
  SAMPLE_SOURCE_LOCAL_FILE,
  resolveFileHandleSample
} from "./sample-assets.js";

// Owns the right-side track UI cluster:
//   • Registry-driven grid-track management (add/remove voices & instances,
//     ordering, reconciliation after load).
//   • The "Add Track" dialog (grouped chips with add/remove/duplicate).
//   • The Track Explorer (grouped, selectable track list with solo + sample dot).
//   • The Track Inspector (one independent panel per selected track: sample row,
//     Level/Pan/Delay/Verb, optional 808 shape, duplicate/delete/deselect).
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
 * @param {(hit: string, event?: any) => void} deps.selectRowWithModifiers
 * @param {(ids: Iterable<string>) => string[]} deps.orderBySelectedGrid
 * @param {(track: string) => void} deps.toggleSolo
 * @param {() => any} deps.previewConfig
 * @param {() => any} deps.getEngine
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
    selectRowWithModifiers,
    orderBySelectedGrid,
    toggleSolo,
    previewConfig,
    getEngine
  } = deps;

  const registryIds = () => TRACK_REGISTRY.map((t) => t.id);
  const DEFAULT_TRACK_STEPS_PER_BAR = 16;
  const normalizeTrackStepCount = (value) => {
    const number = Number(value);
    const requested = Math.round(Number.isFinite(number) ? number : DEFAULT_TRACK_STEPS_PER_BAR);
    return Math.max(1, Math.min(128, requested));
  };
  const collapsedVoiceGroups = new Set();
  let activeSampleGroupId = null;

  const sampleGroups = () => {
    if (!Array.isArray(state.config.sampleGroups)) state.config.sampleGroups = [];
    return state.config.sampleGroups;
  };

  function sampleGroupIdForLabel(label) {
    const base = String(label || "Sample Group")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      || "sample-group";
    const used = new Set(sampleGroups().map((group) => group.id));
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    return id;
  }

  function addSampleGroup(labelInput) {
    const label = String(labelInput || "").trim();
    if (!label) return null;
    const group = { id: sampleGroupIdForLabel(label), label, collapsed: false };
    state.config.sampleGroups = [...sampleGroups(), group];
    activeSampleGroupId = group.id;
    renderTrackExplorer();
    syncJson();
    setStatus(`Added sample group "${group.label}"`);
    return group;
  }

  function addSampleGroupFromPrompt() {
    const label = window.prompt("Sample group name", "Drums");
    return addSampleGroup(label);
  }

  function toggleSampleGroupCollapsed(groupId) {
    state.config.sampleGroups = sampleGroups().map((group) => (
      group.id === groupId ? { ...group, collapsed: !group.collapsed } : group
    ));
    renderTrackExplorer();
    syncJson();
  }

  function setActiveSampleGroup(groupId) {
    activeSampleGroupId = groupId;
    renderTrackExplorer();
    document.querySelector("#sample-browser-section")?.scrollIntoView({ block: "nearest" });
    const group = sampleGroups().find((entry) => entry.id === groupId);
    setStatus(group ? `Sample Browser target: ${group.label}` : "Sample Browser target cleared");
  }

  function openAddTrackDialog(groupId = null) {
    renderAddTrackDialog(groupId);
    /** @type {HTMLDialogElement} */ ($("#add-track-dialog"))?.showModal();
  }

  const visibleTrackGroups = () => TRACK_GROUPS.filter((group) => group.id !== "sampler");

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
      isInstanceId,
      getTrackDef,
      baseTrackId
    });
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
  function addGridTrack(trackId) {
    if (!getTrackDef(trackId)) return;
    if (state.gridTrackIds.includes(trackId)) return;
    // Insert in registry order so groups stay together visually.
    state.gridTrackIds = orderGridTrackIds([...state.gridTrackIds, trackId]);
    ensureTrackColumn(trackId);
    buildStepGrid();
    renderTrackExplorer();
    syncJson();
    setStatus(`Added ${TRACK_LABELS[trackId] || trackId} track`);
  }

  /**
   * Add a fresh *instance* of an instanceable base voice (e.g. another 808 Clap).
   * The instance starts with the base voice's sends/level/pan defaults and no
   * shape override (so it inherits the global 808 shape until the user dials it
   * in). Returns the new instance id, or null if the base isn't instanceable.
   */
  function addTrackInstance(baseId, { select = true } = {}) {
    const base = TRACK_BY_ID[baseTrackId(baseId)];
    if (!base || !base.instanceable) return null;
    const instanceId = makeInstanceId(base.id);
    state.gridTrackIds = orderGridTrackIds([...state.gridTrackIds, instanceId]);
    ensureTrackColumn(instanceId);
    // Seed per-track config maps from the base defaults so the engine has sane
    // values immediately (normalizeEditorConfig also backfills, but this keeps
    // the inspector controls populated right away).
    state.config.trackBusSends = { ...(state.config.trackBusSends || {}), [instanceId]: base.busSend ?? 0.25 };
    state.config.trackReverbSends = { ...(state.config.trackReverbSends || {}), [instanceId]: base.reverbSend ?? 0.2 };
    state.config.trackLevels = { ...(state.config.trackLevels || {}), [instanceId]: base.level ?? 1 };
    state.config.trackPans = { ...(state.config.trackPans || {}), [instanceId]: base.pan ?? 0 };
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
      selectRow(instanceId);
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

  /** Remove a registry track from the grid (core tracks can't be removed). */
  function removeGridTrack(trackId) {
    const def = getTrackDef(trackId);
    if (!def || !def.removable) return;
    state.gridTrackIds = state.gridTrackIds.filter((id) => id !== trackId);
    if (state.selected?.hit === trackId) resetSelectedPanel();
    state.soloTracks.delete(trackId);
    // Drop the removed track's per-track config so it doesn't linger in saved
    // JSON or get resurfaced by reconcileGridTracks on the next load.
    state.config = removeTrackFromConfigMaps(state.config, trackId);
    // For instances, also strip their note columns from every bar.
    if (isInstanceId(trackId)) {
      state.config.patterns.jazz.bars.forEach((bar) => {
        if (bar && trackId in bar) delete bar[trackId];
      });
    }
    getEngine().setConfig(previewConfig());
    buildStepGrid();
    renderTrackExplorer();
    renderTrackInspector();
    syncJson();
    setStatus(`Removed ${def.label} track`);
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
        item.disabled = onGrid && !track.removable;
        item.title = onGrid
          ? (track.removable ? `Remove ${track.label}` : `${track.label} is always on`)
          : `Add ${track.label}`;
        item.addEventListener("click", () => {
          if (state.gridTrackIds.includes(track.id)) {
            if (track.removable) removeGridTrack(track.id);
          } else {
            addGridTrack(track.id);
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
            if (!state.gridTrackIds.includes(track.id)) addGridTrack(track.id);
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

    if (!focusGroupId) {
      // Sample tracks are organized through + Sample Group and the Sample Browser,
      // not through a separate registry voice family.
      const sampleSection = document.createElement("div");
      sampleSection.className = "add-track-group";
      const sampleHeading = document.createElement("div");
      sampleHeading.className = "add-track-group-heading";
      sampleHeading.style.setProperty("--group-accent", "#c084fc");
      sampleHeading.textContent = "Sample Groups";
      sampleSection.appendChild(sampleHeading);

      const sampleDesc = document.createElement("p");
      sampleDesc.className = "add-track-hint";
      sampleDesc.style.cssText = "margin: 0 0 8px; font-size: 11px; color: #9eacb6;";
      sampleDesc.textContent = "Use + Sample Group in the Tracks panel, then add audio from the Sample Browser.";
      sampleSection.appendChild(sampleDesc);
      host.appendChild(sampleSection);
    }
  }

  // ── Track Explorer (right-side track list) ──────────────────

  /** Re-render the grouped track list in the right-side Track Explorer. */
  function renderTrackExplorer() {
    if (!trackExplorerList) return;
    trackExplorerList.innerHTML = "";
    const selectedSet = new Set(state.selectedTracks.length ? state.selectedTracks : (state.selected?.hit ? [state.selected.hit] : []));
    visibleTrackGroups().forEach((group) => {
      const groupTrackIds = state.gridTrackIds.filter((id) => getTrackDef(id)?.group === group.id);
      const registryGroup = TRACK_REGISTRY.filter((track) => track.group === group.id);
      if (groupTrackIds.length === 0 && registryGroup.length === 0) return;
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
        registryGroup.forEach((track) => {
          const ids = trackIdsForBase(track.id);
          const count = ids.length;
          const primaryId = ids[0] || track.id;
          const active = ids.some((id) => selectedSet.has(id));
          const row = document.createElement("div");
          row.className = `track-explorer-row ${active ? "is-selected" : ""} ${count === 0 ? "is-empty" : ""}`;
          row.dataset.trackId = primaryId;

          const name = document.createElement("button");
          name.type = "button";
          name.className = "track-explorer-name";
          const trackLabel = track.label || track.id;
          name.textContent = trackLabel;
          name.title = count > 0
            ? `${trackLabel} — Click to select · Shift-click to add a range · ⌘/Ctrl-click to toggle`
            : `${trackLabel} is not on the grid`;
          name.disabled = count === 0;
          const hasSample = ids.some((id) => Boolean(state.config.trackSamples?.[id]));
          if (hasSample) {
            const dot = document.createElement("span");
            dot.className = "track-explorer-sample-dot";
            dot.title = "Custom sample assigned";
            name.appendChild(dot);
          }
          name.addEventListener("click", (event) => {
            if (count === 0) return;
            selectRowWithModifiers(primaryId, event);
            renderStepGrid();
          });

          const countInput = document.createElement("input");
          countInput.type = "number";
          countInput.className = "track-explorer-count";
          countInput.min = track.removable ? "0" : "1";
          countInput.max = track.instanceable ? "32" : "1";
          countInput.step = "1";
          countInput.value = String(count);
          countInput.title = `${trackLabel} count`;
          countInput.disabled = !track.removable && !track.instanceable;
          const commitCount = () => setTrackVoiceCount(track, countInput.value);
          countInput.addEventListener("click", (event) => event.stopPropagation());
          countInput.addEventListener("change", commitCount);
          countInput.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commitCount();
            countInput.blur();
          });

          const soloBtn = document.createElement("button");
          soloBtn.type = "button";
          soloBtn.className = `track-explorer-solo ${ids.some((id) => state.soloTracks.has(id)) ? "is-active" : ""}`;
          soloBtn.textContent = "S";
          soloBtn.disabled = count === 0;
          soloBtn.title = `Solo ${trackLabel}`;
          soloBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            if (count === 0) return;
            toggleSolo(primaryId);
            renderTrackExplorer();
          });

          row.append(name, countInput, soloBtn);
          groupEl.appendChild(row);
        });
        if (registryGroup.length === 0) {
          const empty = document.createElement("p");
          empty.className = "track-explorer-empty";
          empty.textContent = "No tracks in this group.";
          groupEl.appendChild(empty);
        }
      }
      trackExplorerList.appendChild(groupEl);
    });

    const groups = sampleGroups();
    if (activeSampleGroupId && !groups.some((group) => group.id === activeSampleGroupId)) {
      activeSampleGroupId = null;
    }
    if (groups.length) {
      const section = document.createElement("div");
      section.className = "track-explorer-sample-groups";
      const sectionLabel = document.createElement("div");
      sectionLabel.className = "track-explorer-subheading";
      sectionLabel.textContent = "Sample Groups";
      section.appendChild(sectionLabel);
      groups.forEach((group) => {
        const collapsed = Boolean(group.collapsed);
        const groupEl = document.createElement("div");
        groupEl.className = `track-explorer-group track-explorer-group--sample ${activeSampleGroupId === group.id ? "is-active-target" : ""}`;
        const heading = document.createElement("div");
        heading.className = "track-explorer-group-heading";
        heading.style.setProperty("--group-accent", "#fcd34d");
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "track-explorer-group-toggle";
        toggle.textContent = collapsed ? "+" : "-";
        toggle.title = `${collapsed ? "Expand" : "Collapse"} ${group.label}`;
        toggle.addEventListener("click", () => toggleSampleGroupCollapsed(group.id));
        const label = document.createElement("button");
        label.type = "button";
        label.className = "track-explorer-group-label track-explorer-group-target";
        label.textContent = group.label;
        label.title = `Send Sample Browser adds to ${group.label}`;
        label.addEventListener("click", () => setActiveSampleGroup(group.id));
        heading.append(toggle, label);
        groupEl.appendChild(heading);
        if (!collapsed) {
          const hint = document.createElement("p");
          hint.className = "track-explorer-empty";
          hint.textContent = activeSampleGroupId === group.id
            ? "Sample Browser adds go here."
            : "Click the group name, then choose samples in Sample Browser.";
          groupEl.appendChild(hint);
        }
        section.appendChild(groupEl);
      });
      trackExplorerList.appendChild(section);
    }
    if (!trackExplorerList.children.length) {
      const empty = document.createElement("p");
      empty.className = "track-explorer-empty";
      empty.textContent = "No tracks yet. Use “+ Sample Group” or add a voice group track.";
      trackExplorerList.appendChild(empty);
    }
  }

  // ── Per-track 808 shape (state-aware wrappers + DOM renderer) ─────────

  /** Is this track id an 808-kit voice (base or instance) that supports shaping? */
  function trackSupportsShape(hit) {
    return getTrackDef(hit)?.group === "eightOhEight";
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

  function setTrackVoiceCount(track, value) {
    if (!track) return;
    const max = track.instanceable ? 32 : 1;
    const min = track.removable ? 0 : 1;
    let target = Math.round(Number(value));
    if (!Number.isFinite(target)) target = trackIdsForBase(track.id).length;
    target = Math.max(min, Math.min(max, target));

    let ids = trackIdsForBase(track.id);
    if (!track.instanceable) {
      if (target === 0 && ids.length) removeGridTrack(track.id);
      if (target === 1 && !ids.length) addGridTrack(track.id);
      renderTrackExplorer();
      return;
    }

    if (target > 0 && !state.gridTrackIds.includes(track.id)) {
      addGridTrack(track.id);
    }
    ids = trackIdsForBase(track.id);
    while (ids.length < target) {
      addTrackInstance(track.id, { select: false });
      ids = trackIdsForBase(track.id);
    }
    while (ids.length > target) {
      const removableId = [...ids].reverse().find((id) => id !== track.id) || (track.removable ? track.id : null);
      if (!removableId) break;
      removeGridTrack(removableId);
      ids = trackIdsForBase(track.id);
    }
    renderTrackExplorer();
  }

  /**
   * Build one inspector panel (cloned from the template) for a single track id,
   * wiring its sample row, Level/Pan/Delay/Verb controls, optional 808 shape, and
   * Duplicate/Delete actions. Each panel is fully independent so several can be
   * shown at once for a multi-track selection.
   */
  function buildTrackInspectorPanel(hit) {
    const def = getTrackDef(hit);
    const frag = trackInspectorTemplate.content.cloneNode(true);
    const panel = frag.querySelector("[data-track-panel]");
    panel.dataset.trackId = hit;

    const nameEl = panel.querySelector('[data-field="name"]');
    if (nameEl) nameEl.textContent = isInstanceId(hit) ? instanceLabel(hit) : (def?.label || hit);

    const sampleEl = panel.querySelector('[data-field="sample"]');
    if (sampleEl) {
      const assigned = state.config.trackSamples?.[hit];
      sampleEl.textContent = assigned ? assigned.label : "— built-in —";
      sampleEl.classList.toggle("is-custom", Boolean(assigned));
    }

    const densityInput = panel.querySelector('[data-control="stepsPerBar"]');
    const densityOutput = panel.querySelector('[data-output="stepsPerBar"]');
    if (densityInput) {
      const currentSteps = trackStepCount(hit);
      densityInput.value = String(currentSteps);
      if (densityOutput) densityOutput.textContent = String(currentSteps);
      const commitDensity = () => setTrackStepCount(hit, densityInput.value);
      densityInput.addEventListener("change", commitDensity);
      densityInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commitDensity();
        densityInput.blur();
      });
    }

    // Paired range + number controls for Level / Pan / Delay / Verb.
    const wireParam = (key, getValue, setValue, format, min, max, step) => {
      const range = panel.querySelector(`[data-control="${key}"]`);
      const number = panel.querySelector(`[data-number="${key}"]`);
      const output = panel.querySelector(`[data-output="${key}"]`);
      if (!range || !number || !output) return;
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
    wireParam("level", mix.getLevel, mix.setLevel, (v) => Number(v).toFixed(2), 0, 2, 0.01);
    wireParam("pan", mix.getPan, mix.setPan, formatPan, -1, 1, 0.01);
    wireParam("busSend", mix.getBusSend, mix.setBusSend, (v) => Number(v).toFixed(2), 0, 1, 0.01);
    wireParam("reverbSend", mix.getReverbSend, mix.setReverbSend, (v) => Number(v).toFixed(2), 0, 1, 0.01);

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
      // Insert after the Verb (reverbSend) label — find it by data-control.
      const verbLabel = panel.querySelector('[data-control="reverbSend"]')?.closest("label");
      verbLabel ? verbLabel.after(extraWrap) : panel.querySelector("[data-track-panel]")?.appendChild(extraWrap);
    }

    // Per-track 808 shape (only for 808-kit voices).
    const shapeWrap = panel.querySelector('[data-field="shape"]');
    const supportsShape = trackSupportsShape(hit);
    if (shapeWrap) {
      shapeWrap.hidden = !supportsShape;
      if (supportsShape) {
        renderTrackShapeControls(hit, panel.querySelector('[data-field="shape-controls"]'));
      }
    }

    // Action buttons (delegated handlers via data-action + the panel's data-track-id).
    const dupBtn = panel.querySelector('[data-action="duplicate"]');
    if (dupBtn) {
      const canDuplicate = Boolean(def?.instanceable);
      dupBtn.hidden = !canDuplicate;
      dupBtn.title = canDuplicate ? `Add another ${TRACK_LABELS[baseTrackId(hit)] || def.label} instance` : "";
    }
    const delBtn = panel.querySelector('[data-action="delete"]');
    if (delBtn) {
      const removable = Boolean(def?.removable);
      delBtn.disabled = !removable;
      delBtn.title = removable ? `Remove ${def.label}` : "Core kit tracks can't be removed";
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
      case "duplicate":
        addTrackInstance(baseTrackId(hit), { select: true });
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
      selectRow(next[0], { keepTracks: true });
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
    const tracks = orderBySelectedGrid(
      (state.selectedTracks.length ? state.selectedTracks : (state.selected?.hit ? [state.selected.hit] : []))
        .filter((id) => state.gridTrackIds.includes(id))
    );
    trackInspectorPanels.innerHTML = "";
    if (trackInspectorName) {
      trackInspectorName.textContent = tracks.length === 0
        ? "No track selected"
        : tracks.length === 1
          ? (isInstanceId(tracks[0]) ? instanceLabel(tracks[0]) : (getTrackDef(tracks[0])?.label || tracks[0]))
          : `${tracks.length} tracks`;
    }
    if (trackInspectorMultiHint) {
      trackInspectorMultiHint.hidden = tracks.length > 1;
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
  async function assignSampleToTrack(hit, sample) {
    if (!hit) return;
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
    const ok = await getEngine().setTrackSample(hit, playbackUrl);
    if (!ok) {
      setStatus(`Could not load ${sample.label}`);
      return;
    }
    renderTrackInspector();
    renderTrackExplorer();
    syncJson();
    setStatus(`Loaded ${sample.label} into ${TRACK_LABELS[hit] || hit}`);
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
    removeGridTrack,
    instanceLabel,
    renderAddTrackDialog,
    openAddTrackDialog,
    addSampleGroupFromPrompt,
    activeSampleGroupId: () => activeSampleGroupId,
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
