// Loop-track lane UI controller.
//
// Manages the "loop tracks" feature: audio loops dropped onto horizontal lanes
// in the step grid, each carrying resizable/movable regions that get chopped
// into slices. It owns the loop-track list and the currently selected region,
// and reaches the rest of the app only through injected dependencies (the step
// grid element, a song-length getter, and a status setter), so it has no
// direct dependency on the editor's `state`.
//
// Usage:
//   const loopPanel = createLoopTrackPanel({
//     stepGrid, $, getBarsLength, setStatus
//   });
//   loopPanel.addTrack(name, file, barsInFile);   // from the add-loop form
//   loopPanel.updateSelectedRegion();             // from the region panel inputs
//   loopPanel.deleteSelectedRegion();
import {
  clampRegionBar,
  clampRegionLen,
  normalizeRegion,
  pixelsToBars,
  regionPercent
} from "./loop-region.js";

/**
 * @typedef {{ bar: number, len: number, gain: number, chops: number }} LoopRegion
 * @typedef {{ id: string, name: string, barsInFile: number, audioUrl: string, regions: LoopRegion[], selected: boolean }} LoopTrack
 */

export function createLoopTrackPanel({
  stepGrid,
  $ = (sel) => document.querySelector(sel),
  getBarsLength = () => 1,
  setStatus = () => {}
}) {
  /** @type {LoopTrack[]} */
  const loopTracks = [];
  /** @type {{ trackId: string, regionIdx: number } | null} */
  let selectedLoopRegion = null;

  const trackById = (id) => loopTracks.find((t) => t.id === id) ?? null;
  const totalBars = () => Math.max(1, getBarsLength());

  async function addTrack(name, file, barsInFile) {
    const audioUrl = URL.createObjectURL(file);
    const id = `loop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    /** @type {LoopTrack} */
    const track = { id, name, barsInFile, audioUrl, regions: [], selected: false };
    loopTracks.push(track);
    renderTrackList();
    rebuildStepGridRows();
    setStatus(`Added loop track "${name}"`);
  }

  function removeTrack(id) {
    const idx = loopTracks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const track = loopTracks[idx];
    URL.revokeObjectURL(track.audioUrl);
    loopTracks.splice(idx, 1);
    if (selectedLoopRegion?.trackId === id) {
      selectedLoopRegion = null;
      syncRegionPanel();
    }
    renderTrackList();
    rebuildStepGridRows();
    setStatus(`Removed loop track "${track.name}"`);
  }

  function selectRegion(trackId, regionIdx) {
    selectedLoopRegion = { trackId, regionIdx };
    syncRegionPanel();
  }

  function syncRegionPanel() {
    const panel = $("#loop-region-panel");
    if (!panel) return;
    if (!selectedLoopRegion) {
      panel.hidden = true;
      return;
    }
    const track = trackById(selectedLoopRegion.trackId);
    const region = track?.regions[selectedLoopRegion.regionIdx];
    if (!region) { panel.hidden = true; return; }
    panel.hidden = false;
    const startEl = /** @type {HTMLInputElement} */ ($("#loop-region-start"));
    const lenEl   = /** @type {HTMLInputElement} */ ($("#loop-region-len"));
    const chopsEl = /** @type {HTMLInputElement} */ ($("#loop-region-chops"));
    const gainEl  = /** @type {HTMLInputElement} */ ($("#loop-region-gain"));
    const gainOut = /** @type {HTMLElement}      */ ($("#loop-region-gain-value"));
    if (startEl) startEl.value = String(region.bar);
    if (lenEl)   lenEl.value   = String(region.len);
    if (chopsEl) chopsEl.value = String(region.chops);
    if (gainEl)  gainEl.value  = String(region.gain);
    if (gainOut) gainOut.textContent = region.gain.toFixed(2);
  }

  function updateSelectedRegion() {
    if (!selectedLoopRegion) return;
    const track = trackById(selectedLoopRegion.trackId);
    const region = track?.regions[selectedLoopRegion.regionIdx];
    if (!region) return;
    const startEl = /** @type {HTMLInputElement} */ ($("#loop-region-start"));
    const lenEl   = /** @type {HTMLInputElement} */ ($("#loop-region-len"));
    const chopsEl = /** @type {HTMLInputElement} */ ($("#loop-region-chops"));
    const gainEl  = /** @type {HTMLInputElement} */ ($("#loop-region-gain"));
    const normalized = normalizeRegion({
      bar: startEl?.value,
      len: lenEl?.value,
      chops: chopsEl?.value,
      gain: gainEl?.value
    }, totalBars());
    region.bar = normalized.bar;
    region.len = normalized.len;
    region.chops = normalized.chops;
    region.gain = normalized.gain;
    renderLane(selectedLoopRegion.trackId);
  }

  function deleteSelectedRegion() {
    if (!selectedLoopRegion) return;
    const track = trackById(selectedLoopRegion.trackId);
    if (!track) return;
    track.regions.splice(selectedLoopRegion.regionIdx, 1);
    selectedLoopRegion = null;
    syncRegionPanel();
    renderLane(track.id);
  }

  // ── Rendering ────────────────────────────────────────────────

  function renderTrackList() {
    const list = $("#loop-track-list");
    if (!list) return;
    list.innerHTML = "";
    loopTracks.forEach((track) => {
      const item = document.createElement("div");
      item.className = `loop-track-item${track.selected ? " is-selected" : ""}`;
      item.dataset.loopTrackId = track.id;

      const name = document.createElement("span");
      name.className = "loop-track-item-name";
      name.textContent = `${track.name} (${track.barsInFile} bars)`;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "loop-track-item-remove";
      removeBtn.textContent = "×";
      removeBtn.title = `Remove "${track.name}"`;
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeTrack(track.id);
      });

      item.append(name, removeBtn);
      item.addEventListener("click", () => {
        loopTracks.forEach((t) => { t.selected = false; });
        track.selected = true;
        renderTrackList();
      });
      list.appendChild(item);
    });
  }

  function renderLane(trackId) {
    const lane = stepGrid.querySelector(`.loop-lane[data-loop-track="${trackId}"]`);
    if (!lane) return;
    const track = trackById(trackId);
    if (!track) return;

    lane.innerHTML = "";

    const laneWidth = lane.clientWidth || lane.offsetWidth || 1;
    const bars = totalBars();
    const pxPerBar = laneWidth / bars;

    track.regions.forEach((region, regionIdx) => {
      const isSelected = selectedLoopRegion?.trackId === trackId && selectedLoopRegion?.regionIdx === regionIdx;

      const el = document.createElement("div");
      el.className = `loop-region${isSelected ? " is-selected" : ""}`;
      const pct = regionPercent(region, bars);
      el.style.left  = `${pct.left}%`;
      el.style.width = `${pct.width}%`;

      const label = document.createElement("span");
      label.className = "loop-region-label";
      label.textContent = `${track.name} ×${region.chops}`;
      el.appendChild(label);

      // Chop lines
      for (let c = 1; c < region.chops; c += 1) {
        const line = document.createElement("div");
        line.className = "loop-chop-line";
        line.style.left = `${(c / region.chops) * 100}%`;
        el.appendChild(line);
      }

      // Resize handle
      const resizeHandle = document.createElement("div");
      resizeHandle.className = "loop-region-resize";
      resizeHandle.title = "Drag to resize";
      el.appendChild(resizeHandle);

      // Click to select
      el.addEventListener("mousedown", (e) => {
        if (e.target === resizeHandle) return; // handled separately
        e.stopPropagation();
        selectRegion(trackId, regionIdx);
        renderLane(trackId);
      });

      // Drag to move
      el.addEventListener("mousedown", (e) => {
        if (e.target === resizeHandle) return;
        const startX = e.clientX;
        const startBar = region.bar;
        const onMove = (moveEvent) => {
          const dx = moveEvent.clientX - startX;
          const barDelta = pixelsToBars(dx, pxPerBar);
          region.bar = clampRegionBar(startBar + barDelta, region.len, bars);
          renderLane(trackId);
          syncRegionPanel();
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      // Drag to resize
      resizeHandle.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        const startX = e.clientX;
        const startLen = region.len;
        const onMove = (moveEvent) => {
          const dx = moveEvent.clientX - startX;
          const barDelta = pixelsToBars(dx, pxPerBar);
          region.len = clampRegionLen(startLen + barDelta, region.bar, bars);
          renderLane(trackId);
          syncRegionPanel();
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      lane.appendChild(el);
    });
  }

  function rebuildStepGridRows() {
    // Remove existing loop rows
    stepGrid.querySelectorAll(".loop-lane-row-label, .loop-lane").forEach((el) => el.remove());

    loopTracks.forEach((track) => {
      const label = document.createElement("div");
      label.className = "track-label loop-lane-row-label";
      label.textContent = track.name;
      label.dataset.loopTrackId = track.id;

      const lane = document.createElement("div");
      lane.className = "loop-lane";
      lane.dataset.loopTrack = track.id;
      lane.title = `Click to add a region to "${track.name}"`;

      // Click empty space → create region
      lane.addEventListener("click", (e) => {
        if ((e.target instanceof Element) && e.target.closest(".loop-region")) return;
        const rect = lane.getBoundingClientRect();
        const bars = totalBars();
        const clickBar = Math.floor(((e.clientX - rect.left) / rect.width) * bars);
        const newRegion = {
          bar: Math.max(0, Math.min(bars - 1, clickBar)),
          len: Math.min(track.barsInFile, bars),
          gain: 1,
          chops: 4
        };
        track.regions.push(newRegion);
        const newIdx = track.regions.length - 1;
        selectRegion(track.id, newIdx);
        renderLane(track.id);
      });

      stepGrid.appendChild(label);
      stepGrid.appendChild(lane);

      renderLane(track.id);
    });
  }

  return {
    addTrack,
    removeTrack,
    updateSelectedRegion,
    deleteSelectedRegion,
    rebuildStepGridRows,
    renderTrackList,
    // Exposed for tests/inspection.
    _tracks: loopTracks
  };
}
