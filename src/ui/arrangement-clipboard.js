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
 * @param {number} deps.LOOP_BAR_COUNT Bars per loop.
 * @param {number} deps.MAX_LOOP_COUNT Maximum loop count.
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
 * @param {() => void} deps.renderStepGrid
 * @param {() => void} deps.refreshLoopBarButton
 * @param {(hit: string, step: number, mode?: string) => void} deps.selectStep
 * @param {(event: any, items: any[]) => void} deps.showContextMenu
 * @param {() => void} deps.resetSelectedPanel
 * @param {(hit: string) => string} deps.trackName
 */
export function createArrangementClipboard(deps) {
  const {
    $,
    state,
    clone,
    setStatus,
    LOOP_BAR_COUNT,
    MAX_LOOP_COUNT,
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
    renderStepGrid,
    refreshLoopBarButton,
    selectStep,
    showContextMenu,
    resetSelectedPanel,
    trackName
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
    return state.selected?.hit || null;
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

  function syncAfterArrangementEdit() {
    clampActiveBar();
    applyConfig();
    buildLoopTabs();
    buildBarTabs();
    renderStepGrid();
    refreshLoopBarButton();
    if (state.selected) {
      selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step");
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
    if (shift && state.barAnchor != null) {
      const [lo, hi] = state.barAnchor <= index ? [state.barAnchor, index] : [index, state.barAnchor];
      const range = [];
      for (let i = lo; i <= hi; i += 1) range.push(i);
      state.selectedBars = range;
    } else {
      const set = new Set(state.selectedBars);
      if (set.has(index)) set.delete(index);
      else set.add(index);
      state.selectedBars = [...set].sort((a, b) => a - b);
      state.barAnchor = index;
    }
    buildBarTabs();
    setStatus(state.selectedBars.length
      ? `Selected ${state.selectedBars.length} bar(s)`
      : "Bar selection cleared");
  }

  /** Grab a deep copy of every bar belonging to a loop index. */
  function loopBarsForIndex(loopIndex) {
    const start = loopIndex * LOOP_BAR_COUNT;
    const source = bars();
    return Array.from({ length: LOOP_BAR_COUNT }, (_, i) => clone(source[start + i] || {}));
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
    if (needLoops > MAX_LOOP_COUNT) {
      setStatus(`Can only hold ${MAX_LOOP_COUNT} loops`);
      return;
    }
    // Grow the bars array so the target loops exist.
    const neededBars = needLoops * LOOP_BAR_COUNT;
    const target = bars();
    while (target.length < neededBars) target.push({});
    state.loopClipboard.forEach((entry, i) => {
      const start = (targetIndex + i) * LOOP_BAR_COUNT;
      entry.bars.forEach((bar, b) => {
        target[start + b] = clone(bar);
      });
    });
    state.selectedLoops = [];
    state.activeLoopIndex = targetIndex;
    state.activeBar = targetIndex * LOOP_BAR_COUNT;
    clampActiveBar();
    applyConfig();
    buildLoopTabs();
    buildBarTabs();
    renderStepGrid();
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

  function openBarContextMenu(event, index) {
    const barCount = state.selectedBars.length || 1;
    const trackCount = state.selectedTracks.length;
    const items = [
      { label: `Copy ${barCount} bar(s)`, action: () => copySelectedBars() }
    ];
    if (trackCount) {
      items.push({ label: `Copy ${trackCount} track(s) × ${barCount} bar(s)`, action: () => copySelectedBars({ tracksOnly: true }) });
    }
    items.push(
      { label: "Paste here", disabled: !state.barClipboard?.bars?.length, action: () => pasteBarsAt(index) },
      { separator: true },
      { label: "Clear bar selection", disabled: !state.selectedBars.length, action: () => { state.selectedBars = []; buildBarTabs(); } }
    );
    showContextMenu(event, items);
  }

  function openTrackContextMenu(event, hit) {
    const trackCount = state.selectedTracks.length || 1;
    const barCount = state.selectedBars.length || 1;
    showContextMenu(event, [
      { label: `Copy ${trackCount} track(s) × ${barCount} bar(s)`, action: () => copySelectedBars({ tracksOnly: true }) },
      { label: "Paste track(s) at this bar", disabled: !state.barClipboard?.tracks?.length, action: () => pasteBarsAt(state.activeBar) },
      { separator: true },
      { label: "Clear track selection", action: () => { resetSelectedPanel(); renderStepGrid(); } }
    ]);
  }

  // ── Loop-count editing: set / duplicate / delete ─────────────

  function setLoopCount(nextCount, { duplicateFrom = state.activeLoopIndex } = {}) {
    const targetCount = Math.max(1, Math.min(MAX_LOOP_COUNT, Math.round(Number(nextCount) || 1)));
    const currentCount = loopCount();
    if (targetCount === currentCount) return;
    const nextBars = bars();
    if (targetCount > currentCount) {
      const source = loopBarSlice(duplicateFrom);
      for (let index = currentCount; index < targetCount; index += 1) {
        nextBars.push(...source.map(clone));
      }
    } else {
      nextBars.length = targetCount * LOOP_BAR_COUNT;
      if (state.activeLoopIndex >= targetCount) {
        state.activeLoopIndex = targetCount - 1;
        state.activeBar = loopStartBar(state.activeLoopIndex) + localBarIndex(state.activeBar);
      }
    }
    clampActiveBar();
    applyConfig();
    buildLoopTabs();
    buildBarTabs();
    renderStepGrid();
    setStatus(`Song has ${targetCount} ${targetCount === 1 ? "32-bar loop" : "32-bar loops"}`);
  }

  function duplicateCurrentLoop() {
    const currentCount = loopCount();
    if (currentCount >= MAX_LOOP_COUNT) {
      setStatus(`Maximum is ${MAX_LOOP_COUNT} loops`);
      return;
    }
    bars().push(...loopBarSlice(state.activeLoopIndex).map(clone));
    state.activeLoopIndex = currentCount;
    state.activeBar = loopStartBar(state.activeLoopIndex);
    applyConfig();
    buildLoopTabs();
    buildBarTabs();
    renderStepGrid();
    setStatus(`Duplicated to loop ${state.activeLoopIndex + 1}`);
  }

  function deleteCurrentLoop() {
    const currentCount = loopCount();
    if (currentCount <= 1) {
      setStatus("Keep at least one loop");
      return;
    }
    const start = loopStartBar(state.activeLoopIndex);
    bars().splice(start, LOOP_BAR_COUNT);
    state.activeLoopIndex = Math.max(0, Math.min(state.activeLoopIndex, currentCount - 2));
    state.activeBar = loopStartBar(state.activeLoopIndex) + localBarIndex(state.activeBar);
    clampActiveBar();
    applyConfig();
    buildLoopTabs();
    buildBarTabs();
    renderStepGrid();
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
    openLoopContextMenu,
    openBarContextMenu,
    openTrackContextMenu,
    setLoopCount,
    duplicateCurrentLoop,
    deleteCurrentLoop
  };
}
