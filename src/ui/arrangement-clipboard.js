// Arrangement clipboard controller.
//
// Owns all song-arrangement editing that operates on bars/loops/tracks:
//   • Two-bar copy / paste / fill (whole bars and single-track rows).
//   • Shift-select multi-selection for loops and bars.
//   • Loop & bar clipboards (copy selected → paste at target, growing the song).
//   • Right-click context menus for loops, bars, and track rows.
//   • Loop-count editing: set count, duplicate, delete current loop.
//
// It reaches the rest of the editor through the shared `state` object plus a
// set of injected primitives (bar/loop math, render hooks, status line). The
// editor keeps thin hoisted wrappers so existing call sites are unchanged.

/**
 * @param {object} deps
 * @param {(sel: string) => any} deps.$ DOM query helper.
 * @param {object} deps.state Shared editor state (mutated in place).
 * @param {<T>(value: T) => T} deps.clone Deep clone helper.
 * @param {(msg: string) => void} deps.setStatus Status-line setter.
 * @param {() => number} deps.loopBarCount Bars per loop.
 * @param {() => number} deps.maxLoopCount Maximum loop count.
 * @param {() => any[]} deps.bars Returns the live bars array.
 * @param {(start?: number, length?: number) => number} deps.clampLoopStart
 * @param {() => number} deps.activeLoopLength
 * @param {(start?: number, length?: number) => string} deps.loopRangeLabel
 * @param {(loopIndex?: number) => any[]} deps.loopBarSlice
 * @param {(loopIndex?: number) => number} deps.loopStartBar
 * @param {(barIndex?: number) => number} deps.localBarIndex
 * @param {() => void} deps.clampActiveBar
 * @param {() => number} deps.loopCount
 * @param {() => void} deps.applyConfig
 * @param {() => void} deps.buildLoopTabs
 * @param {() => void} deps.buildBarTabs
 * @param {() => void} deps.buildStepGrid
 * @param {() => void} deps.renderStepGrid
 * @param {() => void} deps.refreshLoopBarButton
 * @param {(hit: string, step: number, mode?: string, barIndex?: number) => void} deps.selectStep
 * @param {(barIndex: number) => void|Promise<void>} deps.playFromBar
 * @param {(barIndex: number, length?: number) => void|Promise<void>} deps.loopFromBar
 * @param {() => boolean|void} [deps.clearBeatLoop]
 * @param {(event: any, items: any[]) => void} deps.showContextMenu
 * @param {() => void} deps.resetSelectedPanel
 * @param {(hit: string) => string} deps.trackName
 * @param {(kind: string, id: string, label?: string) => void} [deps.moveTrackLane]
 * @param {(hit: string) => void} [deps.removeGridTrack]
 * @param {(hit: string) => void} [deps.startTrackMidiLearn]
 * @param {(hit: string) => void} [deps.resetTrackMidiTrigger]
 * @param {(hit: string) => string} [deps.midiTriggerLabel]
 * @param {(hit: string) => boolean} [deps.hasCustomMidiTrigger]
 * @param {() => any[]} [deps.getWaveTracks]
 */
export function createArrangementClipboard(deps) {
  const {
    $,
    state,
    clone,
    setStatus,
    loopBarCount = () => 32,
    maxLoopCount = () => 8,
    bars,
    clampLoopStart,
    activeLoopLength,
    loopRangeLabel,
    loopBarSlice,
    loopStartBar,
    localBarIndex,
    clampActiveBar,
    loopCount,
    applyConfig,
    buildLoopTabs,
    buildBarTabs,
    buildStepGrid,
    renderStepGrid,
    refreshLoopBarButton,
    selectStep,
    playFromBar,
    loopFromBar,
    clearBeatLoop = null,
    showContextMenu,
    resetSelectedPanel,
    trackName,
    moveTrackLane = null,
    removeGridTrack = () => {},
    startTrackMidiLearn = null,
    resetTrackMidiTrigger = null,
    midiTriggerLabel = null,
    hasCustomMidiTrigger = null,
    getWaveTracks = () => []
  } = deps;

  // ── Two-bar source helpers ──────────────────────────────────

  function twoBarStart() {
    return activeLoopLength() === 2
      ? clampLoopStart(state.loopBarIndex, 2)
      : clampLoopStart(state.activeBar, 2);
  }

  function twoBarPair(start = twoBarStart()) {
    const safeStart = clampLoopStart(start, 2);
    const source = bars();
    return [
      clone(source[safeStart] || {}),
      clone(source[safeStart + 1] || source[safeStart] || {})
    ];
  }

  function updateTwoBarClipboardButtons() {
    const pasteButton = $("#paste-two-bars");
    if (pasteButton) pasteButton.disabled = !state.twoBarClipboard;
  }

  function selectedTrack() {
    return state.selectedTracks?.[0] || state.selected?.hit || null;
  }

  function updateTrackClipboardButtons() {
    const hasTrack = Boolean(selectedTrack());
    const canPaste = hasTrack && Boolean(state.trackClipboard);
    const copyButton = $("#copy-track-two-bars");
    const pasteButton = $("#paste-track-two-bars");
    const fillButton = $("#fill-rest-track");
    if (copyButton) copyButton.disabled = !hasTrack;
    if (pasteButton) pasteButton.disabled = !canPaste;
    if (fillButton) fillButton.disabled = !canPaste;
  }

  function selectedBarIsVisible() {
    if (!state.selected) return false;
    const bar = Math.max(0, Math.round(Number(state.selected.bar ?? state.activeBar) || 0));
    const start = Math.max(0, Math.round(Number(state.activeBar) || 0));
    const segments = Math.max(1, Math.round(Number(state.segmentsCount) || 1));
    return bar >= start && bar < start + segments;
  }

  function syncAfterArrangementEdit() {
    clampActiveBar();
    applyConfig();
    buildLoopTabs();
    buildBarTabs();
    renderStepGrid();
    refreshLoopBarButton();
    if (state.selected?.mode === "row") {
      selectStep(state.selected.hit, state.selected.step, "row", state.activeBar);
    } else if (selectedBarIsVisible()) {
      selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step", state.selected.bar ?? state.activeBar);
    } else if (state.selected) {
      resetSelectedPanel();
    }
    updateTwoBarClipboardButtons();
    updateTrackClipboardButtons();
  }

  // ── Two-bar copy / paste / fill (whole bars) ─────────────────

  function copyTwoBars() {
    const start = twoBarStart();
    state.twoBarClipboard = {
      start,
      bars: twoBarPair(start)
    };
    updateTwoBarClipboardButtons();
    setStatus(`Copied bars ${loopRangeLabel(start, 2)}`);
  }

  function pasteTwoBars() {
    if (!state.twoBarClipboard) {
      copyTwoBars();
      return;
    }
    const start = clampLoopStart(state.activeBar, 2);
    const target = bars();
    target[start] = clone(state.twoBarClipboard.bars[0]);
    target[start + 1] = clone(state.twoBarClipboard.bars[1]);
    state.activeBar = start;
    if (activeLoopLength()) state.loopBarIndex = clampLoopStart(start, activeLoopLength());
    syncAfterArrangementEdit();
    setStatus(`Pasted 2 bars at ${loopRangeLabel(start, 2)}`);
  }

  function fillRestWithTwoBars() {
    const start = twoBarStart();
    const pair = state.twoBarClipboard?.bars || twoBarPair(start);
    if (!state.twoBarClipboard) {
      state.twoBarClipboard = { start, bars: pair.map(clone) };
    }
    const target = bars();
    for (let index = start; index < target.length; index += 1) {
      target[index] = clone(pair[(index - start) % 2]);
    }
    state.activeBar = start;
    if (activeLoopLength()) state.loopBarIndex = clampLoopStart(start, activeLoopLength());
    syncAfterArrangementEdit();
    setStatus(`Filled bars ${start + 1}-${target.length} from ${loopRangeLabel(start, 2)}`);
  }

  // ── Two-bar copy / paste / fill (single track row) ───────────

  function copyTrackTwoBars() {
    const hit = selectedTrack();
    if (!hit) {
      setStatus("Select a track row first");
      return;
    }
    const start = twoBarStart();
    const source = bars();
    state.trackClipboard = {
      hit,
      start,
      bars: [
        clone(source[start]?.[hit] || []),
        clone(source[start + 1]?.[hit] || [])
      ]
    };
    updateTrackClipboardButtons();
    setStatus(`Copied ${trackName(hit)} track ${loopRangeLabel(start, 2)}`);
  }

  function pasteTrackTwoBars() {
    const hit = selectedTrack();
    if (!hit) {
      setStatus("Select a target track row first");
      return;
    }
    if (!state.trackClipboard) {
      copyTrackTwoBars();
      return;
    }
    const start = clampLoopStart(state.activeBar, 2);
    const target = bars();
    target[start] = target[start] || {};
    target[start + 1] = target[start + 1] || {};
    target[start][hit] = clone(state.trackClipboard.bars[0] || []);
    target[start + 1][hit] = clone(state.trackClipboard.bars[1] || []);
    state.activeBar = start;
    if (activeLoopLength()) state.loopBarIndex = clampLoopStart(start, activeLoopLength());
    syncAfterArrangementEdit();
    setStatus(`Pasted ${trackName(state.trackClipboard.hit)} into ${trackName(hit)} at ${loopRangeLabel(start, 2)}`);
  }

  function fillRestWithTrackTwoBars() {
    const hit = selectedTrack();
    if (!hit) {
      setStatus("Select a target track row first");
      return;
    }
    if (!state.trackClipboard) {
      copyTrackTwoBars();
      return;
    }
    const start = clampLoopStart(state.activeBar, 2);
    const target = bars();
    for (let index = start; index < target.length; index += 1) {
      target[index] = target[index] || {};
      target[index][hit] = clone(state.trackClipboard.bars[(index - start) % 2] || []);
    }
    state.activeBar = start;
    if (activeLoopLength()) state.loopBarIndex = clampLoopStart(start, activeLoopLength());
    syncAfterArrangementEdit();
    setStatus(`Filled ${trackName(hit)} from ${loopRangeLabel(start, 2)} to the end`);
  }

  // ── Shift-select multi-selection + copy/paste (loops & bars) ──

  /** Range-aware multi-select toggle for loops (shift = range, cmd/ctrl = toggle). */
  function toggleLoopMultiSelect(index, event = {}) {
    const shift = Boolean(event.shiftKey);
    state.selectedBars = [];
    state.barAnchor = null;
    if (shift && state.loopAnchor != null) {
      const [lo, hi] = state.loopAnchor <= index ? [state.loopAnchor, index] : [index, state.loopAnchor];
      const range = [];
      for (let i = lo; i <= hi; i += 1) range.push(i);
      state.selectedLoops = range;
    } else {
      const set = new Set(state.selectedLoops);
      if (set.has(index)) set.delete(index);
      else set.add(index);
      state.selectedLoops = [...set].sort((a, b) => a - b);
      state.loopAnchor = index;
    }
    buildLoopTabs();
    setStatus(state.selectedLoops.length
      ? `Selected loops ${state.selectedLoops.map((i) => i + 1).join(", ")}`
      : "Loop selection cleared");
  }

  /** Range-aware multi-select toggle for bars (shift = range, cmd/ctrl = toggle). */
  function toggleBarMultiSelect(index, event = {}) {
    const shift = Boolean(event.shiftKey);
    const previousSelectedBars = Array.isArray(state.selectedBars) ? state.selectedBars.slice() : [];
    const selectionLoopWasActive = selectedBarsMatchActiveBeatLoop(previousSelectedBars);
    state.selectedLoops = [];
    state.loopAnchor = null;
    state.cameraBeatSelection = null;
    if (shift && state.barAnchor != null) {
      const [lo, hi] = state.barAnchor <= index ? [state.barAnchor, index] : [index, state.barAnchor];
      const range = [];
      for (let i = lo; i <= hi; i += 1) range.push(i);
      const set = new Set(state.selectedBars);
      const removeRange = range.every((bar) => set.has(bar));
      range.forEach((bar) => {
        if (removeRange) set.delete(bar);
        else set.add(bar);
      });
      state.selectedBars = [...set].sort((a, b) => a - b);
    } else {
      const set = new Set(state.selectedBars);
      if (set.has(index)) set.delete(index);
      else set.add(index);
      state.selectedBars = [...set].sort((a, b) => a - b);
      state.barAnchor = index;
    }
    if (!state.selectedBars.length && selectionLoopWasActive) clearBeatLoop?.();
    buildBarTabs();
    renderStepGrid();
    setStatus(state.selectedBars.length
      ? `Selected ${state.selectedBars.length} bar(s)`
      : "Bar selection cleared");
  }

  /** Grab a deep copy of every bar belonging to a loop index. */
  function loopBarsForIndex(loopIndex) {
    const barsPerLoop = loopBarCount();
    const start = loopIndex * barsPerLoop;
    const source = bars();
    return Array.from({ length: barsPerLoop }, (_, i) => clone(source[start + i] || {}));
  }

  /** Copy the currently shift-selected loops to the loop clipboard. */
  function copySelectedLoops() {
    const loops = state.selectedLoops.length
      ? state.selectedLoops
      : [state.activeLoopIndex];
    state.loopClipboard = loops.map((idx) => ({ index: idx, bars: loopBarsForIndex(idx) }));
    setStatus(`Copied ${loops.length} loop(s)`);
  }

  /**
   * Paste copied loops starting at a target loop index, growing the song if
   * needed so every pasted loop has room.
   */
  function pasteLoopsAt(targetIndex) {
    if (!state.loopClipboard?.length) {
      setStatus("Nothing copied — right-click a loop and Copy first");
      return;
    }
    const needLoops = targetIndex + state.loopClipboard.length;
    if (needLoops > maxLoopCount()) {
      setStatus(`Can only hold ${maxLoopCount()} loops`);
      return;
    }
    // Grow the bars array so the target loops exist.
    const barsPerLoop = loopBarCount();
    const neededBars = needLoops * barsPerLoop;
    const target = bars();
    while (target.length < neededBars) target.push({});
    state.loopClipboard.forEach((entry, i) => {
      const start = (targetIndex + i) * barsPerLoop;
      entry.bars.forEach((bar, b) => {
        target[start + b] = clone(bar);
      });
    });
    state.selectedLoops = [];
    state.activeLoopIndex = targetIndex;
    state.activeBar = targetIndex * barsPerLoop;
    clampActiveBar();
    applyConfig();
    buildLoopTabs();
    buildBarTabs();
    buildStepGrid();
    setStatus(`Pasted ${state.loopClipboard.length} loop(s) at loop ${targetIndex + 1}`);
  }

  /**
   * Copy the shift-selected bars. If a set of tracks is selected in the
   * inspector, only those track rows are captured; otherwise the whole bar.
   */
  function copySelectedBars({ tracksOnly = false } = {}) {
    const barIdxs = state.selectedBars.length ? state.selectedBars : [state.activeBar];
    const source = bars();
    const tracks = tracksOnly && state.selectedTracks.length ? state.selectedTracks.slice() : null;
    state.barClipboard = {
      tracks,
      bars: barIdxs.map((idx) => {
        const bar = source[idx] || {};
        if (tracks) {
          const slim = {};
          tracks.forEach((t) => { slim[t] = clone(bar[t] || []); });
          return slim;
        }
        return clone(bar);
      })
    };
    setStatus(tracks
      ? `Copied ${tracks.length} track(s) across ${barIdxs.length} bar(s)`
      : `Copied ${barIdxs.length} bar(s)`);
  }

  /** Paste copied bars starting at a target bar index. */
  function pasteBarsAt(targetIndex) {
    if (!state.barClipboard?.bars?.length) {
      setStatus("Nothing copied — right-click a bar and Copy first");
      return;
    }
    const target = bars();
    const { tracks, bars: clip } = state.barClipboard;
    clip.forEach((bar, i) => {
      const dest = targetIndex + i;
      if (dest >= target.length) return;
      if (tracks) {
        // Merge only the copied track rows, leaving other tracks intact.
        target[dest] = target[dest] || {};
        tracks.forEach((t) => { target[dest][t] = clone(bar[t] || []); });
      } else {
        target[dest] = clone(bar);
      }
    });
    state.selectedBars = [];
    state.activeBar = targetIndex;
    clampActiveBar();
    syncAfterArrangementEdit();
    setStatus(tracks
      ? `Pasted ${tracks.length} track(s) into ${clip.length} bar(s) at bar ${targetIndex + 1}`
      : `Pasted ${clip.length} bar(s) at bar ${targetIndex + 1}`);
  }

  function normalizedBeatRange(range) {
    const source = bars();
    const totalSteps = Math.max(1, source.length * 16);
    const startStepAbs = Math.max(0, Math.min(totalSteps - 1, Math.round(Number(range?.startStepAbs) || 0)));
    const requestedLength = Math.max(1, Math.round(Number(range?.lengthSteps) || 1));
    const lengthSteps = Math.max(1, Math.min(requestedLength, totalSteps - startStepAbs));
    return {
      startStepAbs,
      endStepAbs: startStepAbs + lengthSteps,
      lengthSteps,
      startBar: Math.floor(startStepAbs / 16),
      endBar: Math.floor((startStepAbs + lengthSteps - 1) / 16)
    };
  }

  function beatRangeLabel(range) {
    const labelStep = (stepAbs) => `${Math.floor(stepAbs / 16) + 1}.${String((stepAbs % 16) + 1).padStart(2, "0")}`;
    return `${labelStep(range.startStepAbs)}-${labelStep(range.endStepAbs - 1)}`;
  }

  function entryStep(entry) {
    const value = Array.isArray(entry) ? entry[0] : entry?.step;
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function entryOptions(entry) {
    return (Array.isArray(entry) ? entry[2] : entry?.options) || {};
  }

  function entryIsPianoRoll(entry) {
    const options = entryOptions(entry);
    return options.pianoRoll === true || Number(options.pianoRoll) >= 0.5;
  }

  function selectedBeatTargets() {
    const selectedHit = state.selected?.hit || "";
    const selectedTracks = Array.isArray(state.selectedTracks) ? state.selectedTracks.filter(Boolean) : [];
    const openPiano = new Set(Array.isArray(state.config?.pianoRollTracks) ? state.config.pianoRollTracks : []);
    const waveTracks = getWaveTracks();
    const waveIds = new Set(waveTracks.map((track) => track?.id).filter(Boolean));
    const grid = [];
    const piano = [];
    const wave = [];
    const addUnique = (list, id) => {
      if (id && !list.includes(id)) list.push(id);
    };

    if (state.trackEditorMode === "pianoRoll") {
      [state.pianoRollTargetTrack, ...selectedTracks, selectedHit].forEach((id) => {
        if (openPiano.has(id)) addUnique(piano, id);
      });
    } else if (state.trackEditorMode === "wave") {
      waveTracks
        .filter((track) => track?.selected || track?.id === selectedHit)
        .forEach((track) => addUnique(wave, track.id));
    } else {
      const candidates = selectedTracks.length ? selectedTracks : (selectedHit ? [selectedHit] : []);
      candidates.forEach((id) => {
        if (waveIds.has(id)) addUnique(wave, id);
        else addUnique(grid, id);
      });
    }

    return {
      grid,
      piano,
      wave,
      hasSelection: grid.length > 0 || piano.length > 0 || wave.length > 0
    };
  }

  function entriesForBeatRange(sourceBar, trackId, barIndex, range, { pianoRoll = false } = {}) {
    const entries = Array.isArray(sourceBar?.[trackId]) ? sourceBar[trackId] : [];
    return entries.filter((entry) => {
      if (entryIsPianoRoll(entry) !== pianoRoll) return false;
      const abs = barIndex * 16 + entryStep(entry);
      return abs >= range.startStepAbs && abs < range.endStepAbs;
    }).map(clone);
  }

  function copyBeatSelection(range) {
    const normalized = normalizedBeatRange(range);
    const source = bars();
    const targets = selectedBeatTargets();
    const wholeGrid = !targets.hasSelection;
    const copiedBars = [];
    for (let barIndex = normalized.startBar; barIndex <= normalized.endBar; barIndex += 1) {
      const sourceBar = source[barIndex] || {};
      const gridTargets = wholeGrid
        ? Object.keys(sourceBar).filter((trackId) => Array.isArray(sourceBar[trackId]))
        : targets.grid;
      const barClip = { barIndex, grid: {}, piano: {} };
      gridTargets.forEach((trackId) => {
        const entries = entriesForBeatRange(sourceBar, trackId, barIndex, normalized, { pianoRoll: false });
        if (entries.length) barClip.grid[trackId] = entries;
      });
      targets.piano.forEach((trackId) => {
        const entries = entriesForBeatRange(sourceBar, trackId, barIndex, normalized, { pianoRoll: true });
        if (entries.length) barClip.piano[trackId] = entries;
      });
      if (Object.keys(barClip.grid).length || Object.keys(barClip.piano).length) copiedBars.push(barClip);
    }

    const startBar = normalized.startStepAbs / 16;
    const endBar = normalized.endStepAbs / 16;
    const waveTracks = targets.wave.length
      ? getWaveTracks()
          .filter((track) => targets.wave.includes(track?.id))
          .map((track) => ({
            id: track.id,
            name: track.name,
            regions: (Array.isArray(track.regions) ? track.regions : [])
              .filter((region) => {
                const regionStart = Number(region.bar) || 0;
                const regionEnd = regionStart + Math.max(0, Number(region.len) || 0);
                return regionEnd > startBar && regionStart < endBar;
              })
              .map(clone)
          }))
          .filter((track) => track.regions.length)
      : [];

    state.beatClipboard = {
      range: normalized,
      targets: {
        grid: wholeGrid ? null : targets.grid.slice(),
        piano: targets.piano.slice(),
        wave: targets.wave.slice()
      },
      bars: copiedBars,
      waveTracks
    };
    const laneCount = (wholeGrid ? "grid" : `${targets.grid.length + targets.piano.length + targets.wave.length} selected lane(s)`);
    setStatus(`Copied ${laneCount} ${beatRangeLabel(normalized)}`);
  }

  // ── Right-click context menus ────────────────────────────────

  function openLoopContextMenu(event, index) {
    const count = state.selectedLoops.length || 1;
    showContextMenu(event, [
      { label: `Copy ${count} loop(s)`, action: () => copySelectedLoops() },
      { label: `Paste loop(s) here`, disabled: !state.loopClipboard?.length, action: () => pasteLoopsAt(index) },
      { separator: true },
      { label: "Duplicate this loop", action: () => { state.activeLoopIndex = index; duplicateCurrentLoop(); } }
    ]);
  }

  function selectedBarSpanForContext(index) {
    const selected = state.selectedBars.includes(index) ? state.selectedBars : [index];
    const safeBars = [...new Set(selected)]
      .map((bar) => Math.round(Number(bar)))
      .filter((bar) => Number.isFinite(bar) && bar >= 0 && bar < bars().length)
      .sort((a, b) => a - b);
    const start = safeBars[0] ?? index;
    const end = safeBars[safeBars.length - 1] ?? start;
    return { start, length: Math.max(1, end - start + 1) };
  }

  function selectedBarsMatchActiveBeatLoop(selectedBars = state.selectedBars) {
    const range = state.loopBeatRange;
    if (!range?.lengthSteps) return false;
    const safeBars = [...new Set(Array.isArray(selectedBars) ? selectedBars : [])]
      .map((bar) => Math.round(Number(bar)))
      .filter((bar) => Number.isFinite(bar) && bar >= 0 && bar < bars().length)
      .sort((a, b) => a - b);
    if (!safeBars.length) return false;
    const startStepAbs = safeBars[0] * 16;
    const endStepAbs = (safeBars[safeBars.length - 1] + 1) * 16;
    return Math.round(Number(range.startStepAbs) || 0) === startStepAbs
      && Math.round(Number(range.endStepAbs ?? (Number(range.startStepAbs) || 0) + (Number(range.lengthSteps) || 0))) === endStepAbs;
  }

  function clearBarSelection({ stopMatchingLoop = false } = {}) {
    const shouldStopLoop = stopMatchingLoop && selectedBarsMatchActiveBeatLoop();
    state.selectedBars = [];
    state.barAnchor = null;
    const stoppedLoop = shouldStopLoop ? Boolean(clearBeatLoop?.()) : false;
    buildBarTabs();
    renderStepGrid();
    return stoppedLoop;
  }

  function openBarContextMenu(event, index) {
    const barCount = state.selectedBars.length || 1;
    const trackCount = state.selectedTracks.length;
    const useSelectedBars = state.selectedBars.includes(index) && state.selectedBars.length > 1;
    const items = [
      { label: "Play here", action: () => { void playFromBar?.(index); } },
      {
        label: useSelectedBars ? "Loop selected" : "Loop here",
        action: () => {
          const span = selectedBarSpanForContext(index);
          void loopFromBar?.(span.start, span.length);
        }
      },
      { separator: true },
      { label: `Copy ${barCount} bar(s)`, action: () => copySelectedBars() }
    ];
    if (trackCount) {
      items.push({ label: `Copy ${trackCount} track(s) × ${barCount} bar(s)`, action: () => copySelectedBars({ tracksOnly: true }) });
    }
    items.push(
      { label: "Paste here", disabled: !state.barClipboard?.bars?.length, action: () => pasteBarsAt(index) },
      { separator: true },
      {
        label: "Clear bar selection",
        disabled: !state.selectedBars.length,
        action: () => {
          const stoppedLoop = clearBarSelection({ stopMatchingLoop: true });
          setStatus(stoppedLoop ? "Bar selection cleared; loop off" : "Bar selection cleared");
        }
      }
    );
    showContextMenu(event, items);
  }

  function openTrackContextMenu(event, hit, laneKey = `grid:${hit}`) {
    const trackCount = state.selectedTracks.length || 1;
    const barCount = state.selectedBars.length || 1;
    const label = trackName(hit);
    const [laneKind = "grid", laneId = hit] = String(laneKey || `grid:${hit}`).split(":");
    const midiLabel = typeof midiTriggerLabel === "function" ? midiTriggerLabel(hit) : "";
    const hasCustomMidi = typeof hasCustomMidiTrigger === "function" ? hasCustomMidiTrigger(hit) : false;
    showContextMenu(event, [
      { label: `Copy ${trackCount} track(s) × ${barCount} bar(s)`, action: () => copySelectedBars({ tracksOnly: true }) },
      { label: "Paste track(s) at this bar", disabled: !state.barClipboard?.tracks?.length, action: () => pasteBarsAt(state.activeBar) },
      { separator: true },
      {
        label: midiLabel ? `Map MIDI trigger (${midiLabel})` : "Map MIDI trigger",
        disabled: !startTrackMidiLearn,
        action: () => startTrackMidiLearn?.(hit)
      },
      {
        label: "Reset MIDI trigger",
        disabled: !resetTrackMidiTrigger || !hasCustomMidi,
        action: () => resetTrackMidiTrigger?.(hit)
      },
      { separator: true },
      { label: `Move ${label}`, disabled: !moveTrackLane, action: () => moveTrackLane?.(laneKind, laneId, label) },
      { separator: true },
      { label: "Clear track selection", action: () => { resetSelectedPanel(); renderStepGrid(); } },
      { separator: true },
      { label: `Delete ${label}`, action: () => removeGridTrack(hit) }
    ]);
  }

  // ── Loop-count editing: set / duplicate / delete ─────────────

  function setLoopCount(nextCount, { duplicateFrom = state.activeLoopIndex } = {}) {
    const barsPerLoop = loopBarCount();
    const targetCount = Math.max(1, Math.min(maxLoopCount(), Math.round(Number(nextCount) || 1)));
    const currentCount = loopCount();
    if (targetCount === currentCount) return;
    const nextBars = bars();
    if (targetCount > currentCount) {
      const source = loopBarSlice(duplicateFrom);
      for (let index = currentCount; index < targetCount; index += 1) {
        nextBars.push(...source.map(clone));
      }
    } else {
      nextBars.length = targetCount * barsPerLoop;
      if (state.activeLoopIndex >= targetCount) {
        state.activeLoopIndex = targetCount - 1;
        state.activeBar = loopStartBar(state.activeLoopIndex) + localBarIndex(state.activeBar);
      }
    }
    clampActiveBar();
    applyConfig();
    buildLoopTabs();
    buildBarTabs();
    buildStepGrid();
    setStatus(`Song has ${targetCount} ${targetCount === 1 ? `${barsPerLoop}-bar verse` : `${barsPerLoop}-bar verses`}`);
  }

  function duplicateCurrentLoop() {
    const currentCount = loopCount();
    if (currentCount >= maxLoopCount()) {
      setStatus(`Maximum is ${maxLoopCount()} verses`);
      return;
    }
    bars().push(...loopBarSlice(state.activeLoopIndex).map(clone));
    state.activeLoopIndex = currentCount;
    state.activeBar = loopStartBar(state.activeLoopIndex);
    applyConfig();
    buildLoopTabs();
    buildBarTabs();
    buildStepGrid();
    setStatus(`Duplicated to loop ${state.activeLoopIndex + 1}`);
  }

  function deleteCurrentLoop() {
    const currentCount = loopCount();
    if (currentCount <= 1) {
      setStatus("Keep at least one loop");
      return;
    }
    const start = loopStartBar(state.activeLoopIndex);
    bars().splice(start, loopBarCount());
    state.activeLoopIndex = Math.max(0, Math.min(state.activeLoopIndex, currentCount - 2));
    state.activeBar = loopStartBar(state.activeLoopIndex) + localBarIndex(state.activeBar);
    clampActiveBar();
    applyConfig();
    buildLoopTabs();
    buildBarTabs();
    buildStepGrid();
    setStatus("Deleted current loop");
  }

  return {
    updateTwoBarClipboardButtons,
    updateTrackClipboardButtons,
    syncAfterArrangementEdit,
    copyTwoBars,
    pasteTwoBars,
    fillRestWithTwoBars,
    copyTrackTwoBars,
    pasteTrackTwoBars,
    fillRestWithTrackTwoBars,
    toggleLoopMultiSelect,
    toggleBarMultiSelect,
    copySelectedLoops,
    pasteLoopsAt,
    copySelectedBars,
    pasteBarsAt,
    copyBeatSelection,
    openLoopContextMenu,
    openBarContextMenu,
    openTrackContextMenu,
    setLoopCount,
    duplicateCurrentLoop,
    deleteCurrentLoop
  };
}
