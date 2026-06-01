// Loop-track lane UI controller.
//
// Each loop track renders as a full-width lane beneath the drum step rows.
// The lane shows: a waveform decoded from the audio file, a bar/beat ruler,
// and draggable/resizable region blocks (DAW style).
import {
  clampRegionBar,
  clampRegionLen,
  normalizeRegion,
  pixelsToBars,
  regionPercent
} from "./loop-region.js";

/**
 * @typedef {{ bar: number, len: number, gain: number, chops: number, sliceSensitivity: number, mode: "cut"|"stretch", srcStartFrac?: number, srcEndFrac?: number, sampleOffset?: number }} LoopRegion
 * `srcStartFrac`/`srcEndFrac` describe which slice of the audio buffer this
 * region plays/draws, as fractions (0–1) of the buffer. Default 0–1 (whole file).
 * `sampleOffset` is the legacy seconds-based start point, migrated on read.
 * @typedef {{ id: string, name: string, barsInFile: number, audioUrl: string, buffer: AudioBuffer|null, regions: LoopRegion[], selected: boolean }} LoopTrack
 */

const LANE_H = 64; // px – must match CSS .sample-lane height

/**
 * Return the audio buffer slice a region plays/draws as `{ startFrac, endFrac }`
 * (fractions 0–1 of the buffer). Falls back to the whole file and migrates the
 * legacy `sampleOffset` (seconds) field when present.
 */
function regionSrc(region, bufferDuration = 0) {
  let s = region.srcStartFrac;
  let e = region.srcEndFrac;
  if (s == null && e == null && region.sampleOffset && bufferDuration > 0) {
    // Legacy: only a start offset was stored — keep from there to the end.
    s = region.sampleOffset / bufferDuration;
    e = 1;
  }
  s = s ?? 0;
  e = e ?? 1;
  if (!(e > s)) { s = 0; e = 1; }
  return { startFrac: Math.max(0, Math.min(1, s)), endFrac: Math.max(0, Math.min(1, e)) };
}

// ── Waveform painter ─────────────────────────────────────────────────────────
/**
 * Render a mono overview waveform for `buffer` into `canvas`.
 * `startFrac`/`endFrac` select WHICH slice of the buffer to read (fractions
 * 0–1). The selected slice is always painted across the FULL width of the
 * canvas, so each region block shows exactly the audio it plays, edge-to-edge.
 * @param {boolean} [clear=true] Whether to clearRect first (false = paint on top).
 */
function drawWaveform(canvas, buffer, startFrac = 0, endFrac = 1, color = "#5b9bd5", clear = true) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  if (clear) ctx.clearRect(0, 0, W, H);

  if (!buffer) return;

  // Merge all channels to mono
  const length = buffer.length;
  const merged = new Float32Array(length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) merged[i] += data[i] / buffer.numberOfChannels;
  }

  // Sample range to read from the buffer
  const s = Math.max(0, Math.min(1, startFrac));
  const e = Math.max(0, Math.min(1, endFrac));
  const span = Math.max(1e-9, e - s);
  const firstSample = Math.floor(s * length);
  // How many source samples each painted pixel column represents
  const samplesPerPx = (length * span) / Math.max(1, W);

  ctx.fillStyle = color + "33";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;

  // Draw filled waveform (min/max per pixel column), painted across full width
  for (let px = 0; px < W; px++) {
    const s0 = Math.floor(firstSample + px * samplesPerPx);
    const s1 = Math.min(length, Math.floor(firstSample + (px + 1) * samplesPerPx));
    let min = 0, max = 0;
    for (let smp = s0; smp < s1; smp++) {
      const v = merged[smp];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const yMin = ((1 - max) / 2) * H;
    const yMax = ((1 - min) / 2) * H;
    ctx.fillRect(px, yMin, 1, Math.max(1, yMax - yMin));
  }

  // Centre line
  ctx.strokeStyle = color + "44";
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
}

/**
 * Draw a minimal bar/beat tick ruler onto a canvas.
 * `rulerBars` should be the number of musical bars the canvas represents
 * (use track.barsInFile for regions, totalBars for the background lane).
 * No fills — just thin lines so the waveform reads cleanly underneath.
 * @param {boolean} [clear=true] Whether to clearRect first (false = paint on top).
 */
function drawRuler(canvas, rulerBars, beatsPerBar = 4, clear = true) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  if (clear) ctx.clearRect(0, 0, W, H);
  if (rulerBars <= 0) return;

  const barW = W / rulerBars;
  const beatW = barW / beatsPerBar;

  // Beat lines (very faint)
  ctx.fillStyle = "rgba(160,200,240,0.10)";
  for (let b = 0; b < rulerBars; b++) {
    for (let bt = 1; bt < beatsPerBar; bt++) {
      const bx = Math.round(b * barW + bt * beatW);
      ctx.fillRect(bx, 0, 1, H);
    }
  }

  // Bar lines (subtle but visible)
  ctx.fillStyle = "rgba(160,200,240,0.30)";
  for (let b = 0; b <= rulerBars; b++) {
    const x = Math.round(b * barW);
    ctx.fillRect(x, 0, 1, H);
  }

  // Bar numbers (only when there's enough room)
  if (barW > 28) {
    ctx.fillStyle = "rgba(180,210,240,0.50)";
    ctx.font = `bold 9px ui-monospace, monospace`;
    for (let b = 0; b < rulerBars; b++) {
      ctx.fillText(String(b + 1), Math.round(b * barW) + 3, 10);
    }
  }
}

export function createLoopTrackPanel({
  stepGrid,
  $ = (sel) => document.querySelector(sel),
  getBarsLength = () => 1,
  setStatus = () => {},
  getEngine = () => null
}) {
  /** @type {LoopTrack[]} */
  const loopTracks = [];
  /** @type {Set<string>} Track IDs that are soloed */
  const soloTracks = new Set();
  /** @type {{ trackId: string, regionIdx: number } | null} */
  let selectedLoopRegion = null;
  /** @type {{ trackId: string, regionIdx: number, mode: "move"|"scale"|"reveal" } | null} */
  let activeRegionEdit = null;
  /** @type {Function|null} Unsubscribe from engine bar events */
  let _barUnsub = null;
  /** @type {Function|null} Unsubscribe from engine stop events */
  let _stopUnsub = null;
  /** @type {Set<AudioBufferSourceNode>} currently running sources (for stop) */
  const activeSources = new Set();
  /** Playhead: which bar the engine is currently on (local, wrapped) */
  let _playheadBar = -1;
  /** Scheduled audio time of that bar's downbeat (for smooth interpolation) */
  let _playheadScheduledTime = 0;
  /** rAF handle for playhead animation */
  let _playheadRaf = null;

  // ── Undo / Redo history ────────────────────────────────────────────────────
  // We snapshot every track's region list (deep-ish copy of plain region
  // objects). Buffers/raw bytes are not touched. Call pushHistory() *before*
  // mutating regions, then undo()/redo() swap snapshots in and out.
  /** @type {Array<Array<{id:string, regions:LoopRegion[]}>>} */
  const undoStack = [];
  /** @type {Array<Array<{id:string, regions:LoopRegion[]}>>} */
  const redoStack = [];
  const HISTORY_LIMIT = 100;

  function snapshot() {
    return loopTracks.map((t) => ({ id: t.id, regions: t.regions.map((r) => ({ ...r })) }));
  }
  function pushHistory() {
    undoStack.push(snapshot());
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }
  function applySnapshot(snap) {
    snap.forEach(({ id, regions }) => {
      const t = trackById(id);
      if (t) t.regions = regions.map((r) => ({ ...r }));
    });
    selectedLoopRegion = null;
    activeRegionEdit = null;
    syncRegionPanel();
    loopTracks.forEach((t) => renderLane(t.id));
  }
  function undo() {
    if (!undoStack.length) { setStatus("Nothing to undo"); return; }
    redoStack.push(snapshot());
    applySnapshot(undoStack.pop());
    setStatus("Undo");
  }
  function redo() {
    if (!redoStack.length) { setStatus("Nothing to redo"); return; }
    undoStack.push(snapshot());
    applySnapshot(redoStack.pop());
    setStatus("Redo");
  }

  // Global keyboard shortcuts: ⌘/Ctrl-Z undo, ⌘/Ctrl-Shift-Z or Ctrl-Y redo.
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if (key === "y") {
      e.preventDefault();
      redo();
    }
  });

  // ── Smooth playhead animation ────────────────────────────────────────────
  // We interpolate sub-bar position using ctx.currentTime vs scheduledTime
  // so the line glides smoothly across each bar rather than jumping.
  function renderPlayheads() {
    if (_playheadRaf) cancelAnimationFrame(_playheadRaf);

    const engine = getEngine();
    const ctx = engine?.context;
    const bpm = engine ? engine.currentBpm?.() ?? 120 : 120;
    const bars = totalBars();
    const secPerBeat = 60 / bpm;
    const barDurationSec = secPerBeat * 4;

    function frame() {
      _playheadRaf = requestAnimationFrame(frame);
      if (!engine?.playing) {
        // engine stopped — hide playheads
        stepGrid.querySelectorAll(".sample-lane-playhead").forEach((el) => { el.style.display = "none"; });
        return;
      }
      const now = ctx ? ctx.currentTime : 0;
      // How far into the current bar are we? (0..1)
      const fracInBar = Math.min(1, Math.max(0, (now - _playheadScheduledTime) / barDurationSec));
      // Global fractional bar position (local)
      const globalFrac = (_playheadBar + fracInBar) / bars;
      const pct = Math.min(100, Math.max(0, globalFrac * 100));

      stepGrid.querySelectorAll(".sample-lane-playhead").forEach((el) => {
        el.style.display = "";
        el.style.left = `${pct}%`;
      });
    }
    frame();
  }

  function stopPlayheads() {
    if (_playheadRaf) { cancelAnimationFrame(_playheadRaf); _playheadRaf = null; }
    stepGrid.querySelectorAll(".sample-lane-playhead").forEach((el) => { el.style.display = "none"; });
  }

  // ── Audio context: always reuse the engine's context so everything stays
  // on the same clock. Fall back to a local one only if the engine hasn't
  // initialised yet.
  function getAudioCtx() {
    return getEngine()?.context ?? null;
  }

  // ── Scheduler ────────────────────────────────────────────────────────────
  // Called on every "bar" event from the engine.
  function onBarEvent({ bar, scheduledTime, bpm }) {
    const engine = getEngine();
    const ctx = engine?.context;
    if (!ctx) return;
    const masterOut = engine.masterGain ?? ctx.destination;
    const anySolo = soloTracks.size > 0;
    const bars = totalBars();
    const localBar = bar % bars;

    _playheadBar = localBar;
    _playheadScheduledTime = scheduledTime;
    renderPlayheads();

    loopTracks.forEach((track) => {
      if (!track.buffer) {
        // Buffer not ready yet — try a synchronous decode from stash
        if (track._rawBytes && ctx) {
          const copy = track._rawBytes.buffer.slice(track._rawBytes.byteOffset, track._rawBytes.byteOffset + track._rawBytes.byteLength);
          ctx.decodeAudioData(copy).then((buf) => {
            track.buffer = buf;
            console.log("[loop] late-decoded buffer for", track.name);
          }).catch((e) => console.warn("[loop] late-decode failed", e));
        }
        return;
      }
      if (anySolo && !soloTracks.has(track.id)) return;
      track.regions.forEach((region) => {
        if (region.bar !== localBar) return;
        const gain = region.gain ?? 1;
        const mode = region.mode ?? "cut";
        const secPerBeat = 60 / bpm;
        const barDurationSec = secPerBeat * 4;
        const regionDurationSec = barDurationSec * region.len;
        const sampleDurationSec = track.buffer.duration;

        // Which slice of the buffer does this region play?
        const { startFrac, endFrac } = regionSrc(region, sampleDurationSec);
        const srcStartSec = startFrac * sampleDurationSec;
        const srcWindowSec = Math.max(0, (endFrac - startFrac) * sampleDurationSec);

        let playbackRate, playDuration;
        if (mode === "stretch") {
          // Stretch the selected window to fill the region's musical duration.
          playbackRate = srcWindowSec > 0 ? srcWindowSec / regionDurationSec : 1;
          playDuration = regionDurationSec;
        } else {
          playbackRate = 1;
          playDuration = Math.min(srcWindowSec, regionDurationSec);
        }

        console.log(`[loop] scheduling "${track.name}" bar=${localBar} rate=${playbackRate.toFixed(3)} dur=${playDuration.toFixed(2)}s at ${scheduledTime.toFixed(3)}`);

        const src = ctx.createBufferSource();
        src.buffer = track.buffer;
        src.playbackRate.value = playbackRate;
        src.loop = false;

        const gainNode = ctx.createGain();
        gainNode.gain.value = gain;
        src.connect(gainNode);
        gainNode.connect(masterOut);

        src.start(scheduledTime, srcStartSec);
        src.stop(scheduledTime + playDuration + 0.05);
        activeSources.add(src);
        src.onended = () => activeSources.delete(src);
      });
    });
  }

  async function attachScheduler() {
    const engine = getEngine();
    if (!engine) return;
    // Subscribe immediately so no bar events are missed while re-decoding
    if (_barUnsub) _barUnsub();
    if (_stopUnsub) _stopUnsub();
    _barUnsub = engine.on("bar", onBarEvent);
    _stopUnsub = engine.on("stop", stopPlayheads);
    // Re-decode in background — onBarEvent handles null buffers gracefully
    ensureBuffersForContext();
    console.log("[loop] attachScheduler — tracks:", loopTracks.length, "buffers ready:", loopTracks.filter(t => t.buffer).length);
  }

  function detachScheduler() {
    if (_barUnsub) { _barUnsub(); _barUnsub = null; }
    if (_stopUnsub) { _stopUnsub(); _stopUnsub = null; }
    activeSources.forEach((src) => { try { src.stop(); } catch (_) {} });
    activeSources.clear();
    stopPlayheads();
  }

  // Decode audio using the engine's context, or queue for re-decode later.
  // decodeAudioData() transfers (detaches) the ArrayBuffer, so we must keep
  // a separate copy for re-decode.  We store it as track._rawBytes (Uint8Array)
  // which survives the transfer.
  async function decodeAudio(uint8) {
    const engineCtx = getEngine()?.context;
    if (engineCtx) {
      // Copy so the buffer isn't transferred away from _rawBytes
      return engineCtx.decodeAudioData(uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength));
    }
    // Engine not started yet — decode with a throw-away context just for the
    // waveform preview.  We'll re-decode against the real context on first play.
    const tmp = new (window.AudioContext || window.webkitAudioContext)();
    try {
      return await tmp.decodeAudioData(uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength));
    } finally {
      tmp.close();
    }
  }

  // Re-decode all stashed tracks against the engine's live AudioContext.
  // Returns a Promise so callers can await it.
  async function ensureBuffersForContext() {
    const engineCtx = getEngine()?.context;
    if (!engineCtx) {
      console.log("[loop] ensureBuffersForContext: no engine context yet");
      return;
    }
    for (const track of loopTracks) {
      if (!track._rawBytes) continue;
      try {
        const copy = track._rawBytes.buffer.slice(track._rawBytes.byteOffset, track._rawBytes.byteOffset + track._rawBytes.byteLength);
        track.buffer = await engineCtx.decodeAudioData(copy);
        console.log("[loop] re-decoded", track.name, "dur=", track.buffer.duration.toFixed(2));
        renderLane(track.id);
      } catch (e) {
        console.warn("[loop] re-decode failed for", track.name, e);
      }
    }
  }

  const trackById = (id) => loopTracks.find((t) => t.id === id) ?? null;
  const totalBars = () => Math.max(1, getBarsLength());

  async function addTrack(name, file, barsInFile) {
    const audioUrl = URL.createObjectURL(file);
    const id = `loop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    /** @type {LoopTrack} */
    const track = { id, name, barsInFile, audioUrl, buffer: null, regions: [], selected: false, _rawBytes: null };
    loopTracks.push(track);

    // Decode audio, then re-paint the lane
    try {
      const arrayBuffer = await file.arrayBuffer();
      // Keep a Uint8Array copy BEFORE decodeAudio() because decodeAudioData()
      // transfers (detaches) the underlying ArrayBuffer making it unusable.
      track._rawBytes = new Uint8Array(arrayBuffer.slice(0));
      track.buffer = await decodeAudio(new Uint8Array(track._rawBytes));
      console.log("[loop] addTrack decoded", name, "dur=", track.buffer?.duration?.toFixed(2), "engineCtx?", !!getEngine()?.context);
    } catch (e) {
      console.warn("Loop track decode failed", e);
    }

    // Seed a default region spanning the full timeline so the waveform is
    // immediately visible across the entire lane.  barsInFile controls audio
    // looping/cut scheduling, but the region visually fills the whole song.
    const bars = totalBars();
    track.regions.push({
      bar: 0,
      len: bars,
      gain: 1,
      chops: 4,
      sliceSensitivity: 0.12,
      mode: "cut"
    });

    // (Re)attach the bar scheduler so new track gets picked up
    attachScheduler();
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

  // Enter an interactive edit mode for a region. The lane re-renders with edge
  // handles (and a move grip) wired to the chosen behaviour. Clicking elsewhere
  // / pressing Escape exits the mode. A history snapshot is taken on the first
  // actual drag so undo restores the pre-edit state.
  function beginRegionEdit(track, regionIdx, mode) {
    activeRegionEdit = { trackId: track.id, regionIdx, mode };
    selectRegion(track.id, regionIdx);
    const labels = { move: "Move", scale: "Scale (time-stretch)", reveal: "Reveal cut audio" };
    setStatus(`${labels[mode]}: drag the ${mode === "move" ? "block" : "edges"} — Esc to finish`);
    renderLane(track.id);

    const onKey = (e) => {
      if (e.key === "Escape") {
        activeRegionEdit = null;
        document.removeEventListener("keydown", onKey);
        renderLane(track.id);
      }
    };
    document.addEventListener("keydown", onKey);
  }

  function syncRegionPanel() {
    const panel = $("#loop-region-panel");
    if (!panel) return;
    if (!selectedLoopRegion) { panel.hidden = true; return; }
    const track = trackById(selectedLoopRegion.trackId);
    const region = track?.regions[selectedLoopRegion.regionIdx];
    if (!region) { panel.hidden = true; return; }
    panel.hidden = false;
    const startEl = /** @type {HTMLInputElement} */ ($("#loop-region-start"));
    const lenEl   = /** @type {HTMLInputElement} */ ($("#loop-region-len"));
    const chopsEl = /** @type {HTMLInputElement} */ ($("#loop-region-chops"));
    const gainEl  = /** @type {HTMLInputElement} */ ($("#loop-region-gain"));
    const gainOut = /** @type {HTMLElement}      */ ($("#loop-region-gain-value"));
    const sensEl  = /** @type {HTMLInputElement} */ ($("#loop-region-slice-sensitivity"));
    const sensOut = /** @type {HTMLElement}      */ ($("#loop-region-slice-sensitivity-value"));
    if (startEl) startEl.value = String(region.bar);
    if (lenEl)   lenEl.value   = String(region.len);
    if (chopsEl) chopsEl.value = String(region.chops);
    if (gainEl)  gainEl.value  = String(region.gain);
    if (gainOut) gainOut.textContent = region.gain.toFixed(2);
    if (sensEl)  sensEl.value  = String(region.sliceSensitivity ?? 0.12);
    if (sensOut) sensOut.textContent = (region.sliceSensitivity ?? 0.12).toFixed(2);
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
    const sensEl  = /** @type {HTMLInputElement} */ ($("#loop-region-slice-sensitivity"));
    const sensOut = /** @type {HTMLElement}      */ ($("#loop-region-slice-sensitivity-value"));
    const normalized = normalizeRegion({
      bar: startEl?.value, len: lenEl?.value,
      chops: chopsEl?.value, gain: gainEl?.value
    }, totalBars());
    region.bar = normalized.bar; region.len = normalized.len;
    region.chops = normalized.chops; region.gain = normalized.gain;
    if (sensEl) {
      const s = Math.max(0.01, Math.min(0.5, parseFloat(sensEl.value) || 0.12));
      region.sliceSensitivity = s;
      if (sensOut) sensOut.textContent = s.toFixed(2);
    }
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

  // ── Region context menu ───────────────────────────────────────────────────

  function showRegionContextMenu(x, y, track, region, regionIdx, totalBarsCount) {
    // Remove any existing menu
    document.querySelector(".loop-region-ctx-menu")?.remove();

    const menu = document.createElement("div");
    menu.className = "context-menu loop-region-ctx-menu";
    menu.style.cssText = `left:${x}px;top:${y}px`;

    const addItem = (label, action, disabled = false) => {
      const btn = document.createElement("button");
      btn.className = "context-menu-item";
      btn.textContent = label;
      btn.disabled = disabled;
      btn.addEventListener("click", () => {
        menu.remove();
        action();
      });
      menu.appendChild(btn);
    };

    const sep = () => {
      const d = document.createElement("div");
      d.className = "context-menu-sep";
      menu.appendChild(d);
    };

    // ── Move selection: drag the whole region left/right along the timeline.
    addItem("↔  Move selection", () => {
      beginRegionEdit(track, regionIdx, "move");
    });

    sep();

    // ── Scale selection: drag either edge to stretch/shrink the region in time
    //    WITHOUT changing pitch (time-stretch). The source window is unchanged.
    addItem("⇲  Scale selection (time-stretch, no pitch change)", () => {
      beginRegionEdit(track, regionIdx, "scale");
    });

    sep();

    // ── Reveal: drag either edge to pull back the audio that was cut away on
    //    the left/right, as if un-cutting. Source window grows/shrinks with the
    //    edges; pitch and speed stay natural.
    addItem("⤢  Reveal cut audio (drag edges)", () => {
      beginRegionEdit(track, regionIdx, "reveal");
    });

    sep();

    // ── Delete
    addItem("🗑  Delete region", () => {
      pushHistory();
      track.regions.splice(regionIdx, 1);
      selectedLoopRegion = null;
      activeRegionEdit = null;
      syncRegionPanel();
      renderLane(track.id);
    });

    document.body.appendChild(menu);

    // Dismiss on outside click
    const dismiss = (e) => {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("mousedown", dismiss); }
    };
    setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
  }

  // ── Marquee selection action popup ───────────────────────────────────────

  /**
   * Show a popup near (x,y) offering marquee actions over [startBar, startBar+len).
   * `marqueeEl` is removed only when an action is performed, not on outside-click.
   * Pass `getSelection` as a function so the popup reads the latest bar/len at
   * the moment the user clicks an action (handles may have moved it since open).
   */
  function showMarqueeActionPopup(x, y, track, getSelection, marqueeEl) {
    document.querySelector(".marquee-action-popup")?.remove();

    const popup = document.createElement("div");
    popup.className = "context-menu marquee-action-popup";
    popup.style.cssText = `left:${x}px;top:${y}px`;

    const addItem = (label, action) => {
      const btn = document.createElement("button");
      btn.className = "context-menu-item";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        // Read selection FIRST, before removing the marquee from the DOM
        const sel = getSelection();
        popup.remove();
        marqueeEl.remove();
        marqueeEl.parentElement?.querySelectorAll?.(".lane-marquee")?.forEach?.(el => el.remove());
        document.querySelectorAll(".lane-marquee").forEach(el => el.remove());
        const { startBar, len, leftFrac, rightFrac } = sel;
        action(startBar, len, leftFrac, rightFrac);
      });
      popup.appendChild(btn);
    };
    const sep = () => { const d = document.createElement("div"); d.className = "context-menu-sep"; popup.appendChild(d); };

    // ── Loop: create a region spanning the selection
    addItem("↺  Loop selection", (startBar, len) => {
      const bars = totalBars();
      const clampedLen = Math.max(1, Math.min(len, bars - startBar));
      track.regions.push({ bar: startBar, len: clampedLen, gain: 1, chops: 4, sliceSensitivity: 0.12, mode: "cut" });
      selectRegion(track.id, track.regions.length - 1);
      renderLane(track.id);
    });

    sep();

    // ── Cut-inverse: keep only the parts of existing regions INSIDE the selection.
    //    Everything outside the marquee is removed.  We map the visual marquee
    //    (timeline-fraction space) into each region's source-buffer window so
    //    the kept audio matches *exactly* what was highlighted on screen.
    addItem("✂  Cut (keep inside selection)", (startBar, len, leftFrac, rightFrac) => {
      const bars = totalBars();
      const dur = track.buffer ? track.buffer.duration : 0;
      const next = [];
      pushHistory();
      track.regions.forEach((region) => {
        // Region's extent on the timeline, as fractions
        const rL = region.bar / bars;
        const rR = (region.bar + region.len) / bars;
        // Intersect with the marquee in timeline-fraction space
        const oL = Math.max(rL, leftFrac);
        const oR = Math.min(rR, rightFrac);
        if (oR > oL) {
          // New region bounds on the timeline (snap to bars)
          const newBar = Math.round(oL * bars);
          const newEnd = Math.round(oR * bars);
          const newLen = Math.max(1, newEnd - newBar);

          // Map the kept slice back into the region's SOURCE window.
          // relL/relR are how far through the region (0–1) the kept part sits.
          const { startFrac, endFrac } = regionSrc(region, dur);
          const relL = (oL - rL) / Math.max(1e-9, rR - rL);
          const relR = (oR - rL) / Math.max(1e-9, rR - rL);
          const srcStartFrac = startFrac + relL * (endFrac - startFrac);
          const srcEndFrac   = startFrac + relR * (endFrac - startFrac);

          next.push({ ...region, bar: newBar, len: newLen, srcStartFrac, srcEndFrac, sampleOffset: undefined });
        }
      });
      setStatus(`Cut: kept ${next.length} region(s) inside selection`);
      track.regions.length = 0;
      track.regions.push(...next);
      selectedLoopRegion = next.length ? { trackId: track.id, regionIdx: 0 } : null;
      syncRegionPanel();
      renderLane(track.id);
    });

    sep();

    // ── Time-stretch: mark the overlapping portion of existing regions as stretch
    //    mode so they fill the selected range.  If no region overlaps, create one.
    addItem("↔  Time-stretch selection", (startBar, len) => {
      const bars = totalBars();
      const endBar = Math.min(bars, startBar + len);
      const clampedLen = Math.max(1, endBar - startBar);

      let applied = false;
      track.regions.forEach((region) => {
        const rEnd = region.bar + region.len;
        // Any region that overlaps the selection gets its mode flipped to stretch
        // and its boundaries clamped to the selection
        if (rEnd > startBar && region.bar < endBar) {
          region.bar  = Math.max(region.bar, startBar);
          region.len  = Math.min(rEnd, endBar) - region.bar;
          region.mode = "stretch";
          applied = true;
        }
      });
      // If nothing overlapped, create a new stretch region
      if (!applied) {
        track.regions.push({ bar: startBar, len: clampedLen, gain: 1, chops: 4, sliceSensitivity: 0.12, mode: "stretch" });
      }
      track.regions.sort((a, b) => a.bar - b.bar);
      const si = track.regions.findIndex((r) => r.bar >= startBar && r.mode === "stretch");
      selectRegion(track.id, si >= 0 ? si : track.regions.length - 1);
      renderLane(track.id);
    });

    sep();

    addItem("✕  Dismiss selection", () => { /* marquee already removed by addItem wrapper */ });

    document.body.appendChild(popup);

    // Close popup on outside click — but keep the marquee alive
    const dismiss = (e) => {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener("mousedown", dismiss);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
  }

  /**
   * Build a persistent marquee element in `lane` for `track`.
   * `left0` and `right0` are fractions (0–1) of lane width.
   * Returns the marquee element.
   */
  function makePersistentMarquee(lane, track, left0, right0) {
    // Dismiss any existing marquee in this lane
    lane.querySelector(".lane-marquee")?.remove();

    let left = Math.min(left0, right0);
    let right = Math.max(left0, right0);

    const marquee = document.createElement("div");
    marquee.className = "lane-marquee lane-marquee--active";

    const updatePos = () => {
      marquee.style.left  = `${left  * 100}%`;
      marquee.style.width = `${(right - left) * 100}%`;
    };
    updatePos();

    /**
     * Return current selection as fractional (floating-point) bar positions,
     * so callers can round as appropriate for their operation.
     * Also exposes integer startBar/endBar/len rounded to nearest bar.
     */
    const getSelection = () => {
      const bars = totalBars();
      const startBar = Math.max(0, Math.round(left * bars));
      const endBar   = Math.min(bars, Math.round(right * bars));
      const len = Math.max(1, endBar - startBar);
      return { startBar, len, leftFrac: left, rightFrac: right };
    };

    // ── Left edge handle
    const leftHandle = document.createElement("div");
    leftHandle.className = "lane-marquee-handle lane-marquee-handle--left";
    leftHandle.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      const startX = e.clientX;
      const startLeft = left;
      const minWidth = 1 / Math.max(1, totalBars());
      const onMove = (me) => {
        const rect = lane.getBoundingClientRect();
        left = Math.max(0, Math.min(right - minWidth, startLeft + (me.clientX - startX) / rect.width));
        updatePos();
      };
      const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // ── Right edge handle
    const rightHandle = document.createElement("div");
    rightHandle.className = "lane-marquee-handle lane-marquee-handle--right";
    rightHandle.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      const startX = e.clientX;
      const startRight = right;
      const minWidth = 1 / Math.max(1, totalBars());
      const onMove = (me) => {
        const rect = lane.getBoundingClientRect();
        right = Math.min(1, Math.max(left + minWidth, startRight + (me.clientX - startX) / rect.width));
        updatePos();
      };
      const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // Click the marquee body to open the action popup
    marquee.addEventListener("click", (e) => {
      e.stopPropagation();
      showMarqueeActionPopup(e.clientX, e.clientY + 4, track, getSelection, marquee);
    });

    // Right-click anywhere on the marquee body also works
    marquee.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMarqueeActionPopup(e.clientX, e.clientY, track, getSelection, marquee);
    });

    // Stop mousedown on the marquee body from starting a new one,
    // but only if it's not on a handle (handles stop propagation themselves)
    marquee.addEventListener("mousedown", (e) => { e.stopPropagation(); });

    // Escape key dismisses the marquee (and any open popup)
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        document.querySelector(".marquee-action-popup")?.remove();
        marquee.remove();
        document.removeEventListener("keydown", onKeyDown);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    // Clean up key listener when marquee is removed for any other reason
    const observer = new MutationObserver(() => {
      if (!marquee.isConnected) {
        document.removeEventListener("keydown", onKeyDown);
        observer.disconnect();
      }
    });
    observer.observe(lane, { childList: true });

    marquee.append(leftHandle, rightHandle);
    lane.appendChild(marquee);
    return marquee;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

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
      name.title = `${track.name} (${track.barsInFile} bars)`;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "loop-track-item-remove";
      removeBtn.textContent = "×";
      removeBtn.title = `Remove "${track.name}"`;
      removeBtn.addEventListener("click", (e) => { e.stopPropagation(); removeTrack(track.id); });
      item.append(name, removeBtn);
      item.addEventListener("click", () => {
        loopTracks.forEach((t) => { t.selected = false; });
        track.selected = true;
        renderTrackList();
      });
      list.appendChild(item);
    });
  }

  /** Paint a single lane's region blocks + waveform snippets on top of the ruler canvas. */
  function renderLane(trackId) {
    const lane = stepGrid.querySelector(`.sample-lane[data-loop-track="${trackId}"]`);
    if (!lane) return;
    const track = trackById(trackId);
    if (!track) return;
    const bars = totalBars();

    // Repaint background ruler (with waveform underneath)
    const rulerCanvas = lane.querySelector(".sample-lane-ruler");
    if (rulerCanvas) {
      rulerCanvas.width = lane.offsetWidth || 800;
      rulerCanvas.height = LANE_H;
      drawRuler(rulerCanvas, bars, 4, true);
    }

    // Remove old region elements
    lane.querySelectorAll(".sample-region").forEach((el) => el.remove());

    const laneWidth = lane.offsetWidth || 800;
    const pxPerBar = laneWidth / bars;

    track.regions.forEach((region, regionIdx) => {
      const el = document.createElement("div");
      el.className = "sample-region";
      const pct = regionPercent(region, bars);
      el.style.left = `${pct.left}%`;
      el.style.width = `${pct.width}%`;

      // Waveform canvas inside the region
      const waveCanvas = document.createElement("canvas");
      waveCanvas.className = "sample-region-wave";
      // We'll size it after append via ResizeObserver / rAF
      el.appendChild(waveCanvas);

      // Label
      const label = document.createElement("span");
      label.className = "sample-region-label";
      label.textContent = track.name;
      label.title = track.name;
      el.appendChild(label);

      // Mode badge
      const modeBadge = document.createElement("span");
      modeBadge.className = `sample-region-mode-badge mode-${region.mode ?? "cut"}`;
      modeBadge.title = region.mode === "stretch" ? "Stretch mode: time-stretched to fill region" : "Cut mode: plays at natural speed";
      modeBadge.textContent = region.mode === "stretch" ? "↔" : "✂";
      el.appendChild(modeBadge);

      // Chop lines
      for (let c = 1; c < region.chops; c++) {
        const line = document.createElement("div");
        line.className = "sample-chop-line";
        line.style.left = `${(c / region.chops) * 100}%`;
        el.appendChild(line);
      }

      // Resize handle
      const resizeHandle = document.createElement("div");
      resizeHandle.className = "sample-region-resize";
      resizeHandle.title = "Drag to resize";
      el.appendChild(resizeHandle);

      // After DOM paint, draw waveform at correct section
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const elW = el.offsetWidth || 200;
        waveCanvas.width = elW;
        waveCanvas.height = LANE_H;
        if (track.buffer) {
          const { startFrac, endFrac } = regionSrc(region, track.buffer.duration);
          drawWaveform(waveCanvas, track.buffer, startFrac, endFrac);
        }
      }));

      // Live waveform repaint — called during drag so the wave updates in real-time.
      const repaintWave = () => {
        const elW = el.offsetWidth || 200;
        if (waveCanvas.width !== elW) waveCanvas.width = elW;
        waveCanvas.height = LANE_H;
        if (track.buffer) {
          const { startFrac, endFrac } = regionSrc(region, track.buffer.duration);
          drawWaveform(waveCanvas, track.buffer, startFrac, endFrac);
        }
      };

      // Drag the right edge to resize the region
      resizeHandle.addEventListener("mousedown", (e) => {
        e.stopPropagation(); // don't start a marquee when dragging the resize handle
        const startX = e.clientX;
        const startLen = region.len;
        const onMove = (me) => {
          const dx = me.clientX - startX;
          region.len = clampRegionLen(startLen + pixelsToBars(dx, pxPerBar), region.bar, bars);
          renderLane(trackId);
          syncRegionPanel();
        };
        const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      // Right-click on a region → select it + show context menu
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectRegion(trackId, regionIdx);
        showRegionContextMenu(e.clientX, e.clientY, track, region, regionIdx, bars);
      });

      // ── Interactive edit mode (Move / Scale / Reveal) ──────────────────────
      if (activeRegionEdit && activeRegionEdit.trackId === track.id && activeRegionEdit.regionIdx === regionIdx) {
        el.classList.add("sample-region--editing", `sample-region--edit-${activeRegionEdit.mode}`);
        const mode = activeRegionEdit.mode;

        // Snapshot history once per drag gesture.
        const startDrag = (snapNeeded) => { if (snapNeeded) pushHistory(); };

        // Shared edge-drag wiring. `which` is "left" or "right".
        const wireEdge = (handle, which) => {
          handle.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            e.preventDefault();
            const rect = lane.getBoundingClientRect();
            const startX = e.clientX;
            const startBar = region.bar;
            const startLen = region.len;
            const srcA = regionSrc(region, track.buffer ? track.buffer.duration : 0);
            const startSrcStart = srcA.startFrac;
            const startSrcEnd = srcA.endFrac;
            const srcPerBar = startLen > 0 ? (startSrcEnd - startSrcStart) / startLen : 0;
            let snapped = false;

            const onMove = (me) => {
              if (!snapped) { startDrag(true); snapped = true; }
              const deltaBar = (me.clientX - startX) / (rect.width / bars);
              const dB = Math.round(deltaBar);

              if (which === "right") {
                const newLen = Math.max(1, Math.min(bars - startBar, startLen + dB));
                region.len = newLen;
                if (mode === "reveal") {
                  region.srcStartFrac = startSrcStart;
                  region.srcEndFrac = Math.max(startSrcStart + 1e-4, Math.min(1, startSrcStart + newLen * srcPerBar));
                  region.mode = "cut";
                } else if (mode === "scale") {
                  region.srcStartFrac = startSrcStart;
                  region.srcEndFrac = startSrcEnd;
                  region.mode = "stretch";
                }
                region.sampleOffset = undefined;
              } else { // left edge
                const newBar = Math.max(0, Math.min(startBar + startLen - 1, startBar + dB));
                const newLen = startLen + (startBar - newBar);
                region.bar = newBar;
                region.len = Math.max(1, newLen);
                if (mode === "reveal") {
                  const shift = (newBar - startBar) * srcPerBar;
                  region.srcStartFrac = Math.max(0, Math.min(startSrcEnd - 1e-4, startSrcStart + shift));
                  region.srcEndFrac = startSrcEnd;
                  region.mode = "cut";
                } else if (mode === "scale") {
                  region.srcStartFrac = startSrcStart;
                  region.srcEndFrac = startSrcEnd;
                  region.mode = "stretch";
                }
                region.sampleOffset = undefined;
              }
              // Update position CSS live, then repaint waveform in-place (no DOM rebuild)
              const pct = regionPercent(region, bars);
              el.style.left  = `${pct.left}%`;
              el.style.width = `${pct.width}%`;
              repaintWave();
            };
            const onUp = () => {
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
              // Full render pass to synchronise everything after drag ends
              renderLane(track.id);
              syncRegionPanel();
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          });
        };

        if (mode === "move") {
          // Drag the whole block to a new bar position (timeline only).
          el.style.cursor = "grab";
          el.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            el.style.cursor = "grabbing";
            const rect = lane.getBoundingClientRect();
            const startX = e.clientX;
            const startBar = region.bar;
            let snapped = false;
            const onMove = (me) => {
              if (!snapped) { startDrag(true); snapped = true; }
              const dB = Math.round((me.clientX - startX) / (rect.width / bars));
              region.bar = Math.max(0, Math.min(bars - region.len, startBar + dB));
              // Move CSS live; no DOM rebuild during drag
              const pct = regionPercent(region, bars);
              el.style.left = `${pct.left}%`;
            };
            const onUp = () => {
              el.style.cursor = "grab";
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
              renderLane(track.id);
              syncRegionPanel();
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          });
        } else {
          // Scale / Reveal: add draggable left + right edge handles.
          const leftH = document.createElement("div");
          leftH.className = "sample-region-edit-handle sample-region-edit-handle--left";
          leftH.title = mode === "scale" ? "Drag to stretch (no pitch change)" : "Drag to reveal audio on the left";
          const rightH = document.createElement("div");
          rightH.className = "sample-region-edit-handle sample-region-edit-handle--right";
          rightH.title = mode === "scale" ? "Drag to stretch (no pitch change)" : "Drag to reveal audio on the right";
          wireEdge(leftH, "left");
          wireEdge(rightH, "right");
          el.append(leftH, rightH);
        }
      }

      lane.appendChild(el);
    });
  }

  function rebuildStepGridRows() {
    stepGrid.querySelectorAll(".sample-lane-label, .sample-lane").forEach((el) => el.remove());

    loopTracks.forEach((track) => {
      // Label cell (first grid column)
      const label = document.createElement("div");
      label.className = "track-label sample-lane-label";
      label.dataset.loopTrackId = track.id;

      const span = document.createElement("span");
      span.textContent = track.name;
      span.title = track.name; // tooltip for full name

      // Solo button — use the same class as drum-track solo buttons so style is consistent
      const soloBtn = document.createElement("button");
      soloBtn.type = "button";
      soloBtn.className = `solo-button${soloTracks.has(track.id) ? " is-active" : ""}`;
      soloBtn.dataset.loopSoloTrack = track.id;
      soloBtn.textContent = "S";
      soloBtn.title = `Solo "${track.name}"`;
      soloBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (soloTracks.has(track.id)) {
          soloTracks.delete(track.id);
        } else {
          soloTracks.add(track.id);
        }
        const active = soloTracks.has(track.id);
        soloBtn.classList.toggle("is-active", active);
        // When any loop track is soloed, silence all engine (drum) tracks by
        // injecting a sentinel solo list that matches no real track.
        // When no loop solo is active, restore normal drum audibility.
        const engine = getEngine();
        if (engine) {
          if (soloTracks.size > 0) {
            // "__loop_solo_mute__" matches no drum track → all drums silent
            engine.config.soloTracks = ["__loop_solo_mute__"];
          } else {
            engine.config.soloTracks = [];
          }
        }
      });

      label.append(span, soloBtn);

      // The timeline lane (spans all step columns)
      const lane = document.createElement("div");
      lane.className = "sample-lane";
      lane.dataset.loopTrack = track.id;

      // Ruler canvas sits behind everything
      const rulerCanvas = document.createElement("canvas");
      rulerCanvas.className = "sample-lane-ruler";
      lane.appendChild(rulerCanvas);

      // Playhead line
      const playhead = document.createElement("div");
      playhead.className = "sample-lane-playhead";
      playhead.style.display = "none";
      lane.appendChild(playhead);

      // ── Left-click anywhere in the lane (including on regions) → draw marquee
      lane.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        // Only skip if clicking the marquee itself (handles are inside it)
        if ((e.target instanceof Element) && e.target.closest(".lane-marquee")) return;

        // Prevent the browser from drawing its native blue text-selection box
        e.preventDefault();

        // Re-fetch the bounding rect on every event so scroll offsets stay correct.
        const getLaneRect = () => lane.getBoundingClientRect();
        const laneRect0 = getLaneRect();
        const startFrac = Math.max(0, Math.min(1, (e.clientX - laneRect0.left) / laneRect0.width));

        // Temporary drawing marquee
        const marquee = document.createElement("div");
        marquee.className = "lane-marquee lane-marquee--drawing";
        marquee.style.left  = `${startFrac * 100}%`;
        marquee.style.width = "0%";
        lane.appendChild(marquee);

        let curFrac = startFrac;
        let dragged = false;

        const onMove = (me) => {
          const r = getLaneRect();
          curFrac = Math.max(0, Math.min(1, (me.clientX - r.left) / r.width));
          const left  = Math.min(startFrac, curFrac);
          const width = Math.abs(curFrac - startFrac);
          marquee.style.left  = `${left  * 100}%`;
          marquee.style.width = `${width * 100}%`;
          if (width * r.width > 4) dragged = true;
        };

        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          marquee.remove();

          const left  = Math.min(startFrac, curFrac);
          const width = Math.abs(curFrac - startFrac);

          if (!dragged || width * getLaneRect().width < 6) {
            // Short click on empty lane → exit edit mode, dismiss marquee, deselect
            if (activeRegionEdit && activeRegionEdit.trackId === track.id) {
              activeRegionEdit = null;
              renderLane(track.id);
            }
            lane.querySelector(".lane-marquee")?.remove();
            document.querySelector(".marquee-action-popup")?.remove();
            selectedLoopRegion = null;
            syncRegionPanel();
            return;
          }

          // Long drag → persistent marquee with edge handles
          makePersistentMarquee(lane, track, left, left + width);
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      // ── Right-click on empty lane space → context menu with track-level actions
      lane.addEventListener("contextmenu", (e) => {
        // If right-clicking a region, let the region's own handler take it
        if ((e.target instanceof Element) && e.target.closest(".sample-region")) return;
        e.preventDefault();
        e.stopPropagation();

        document.querySelector(".loop-region-ctx-menu")?.remove();
        const menu = document.createElement("div");
        menu.className = "context-menu loop-region-ctx-menu";
        menu.style.cssText = `left:${e.clientX}px;top:${e.clientY}px`;

        const addItem = (label, action, disabled = false) => {
          const btn = document.createElement("button");
          btn.className = "context-menu-item";
          btn.textContent = label;
          btn.disabled = disabled;
          btn.addEventListener("click", () => { menu.remove(); action(); });
          menu.appendChild(btn);
        };
        const sep = () => { const d = document.createElement("div"); d.className = "context-menu-sep"; menu.appendChild(d); };

        const bars = totalBars();

        addItem("⬛  Select entire loop", () => {
          makePersistentMarquee(lane, track, 0, 1);
        });

        sep();

        addItem("↺  Loop entire file here", () => {
          track.regions.push({ bar: 0, len: bars, gain: 1, chops: 4, sliceSensitivity: 0.12, mode: "cut" });
          selectRegion(track.id, track.regions.length - 1);
          renderLane(track.id);
        });

        if (track.regions.length > 0) {
          sep();
          addItem("🗑  Delete all regions", () => {
            track.regions.length = 0;
            selectedLoopRegion = null;
            syncRegionPanel();
            renderLane(track.id);
          });
        }

        document.body.appendChild(menu);
        const dismiss = (ev) => {
          if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("mousedown", dismiss); }
        };
        setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
      });

      stepGrid.appendChild(label);
      stepGrid.appendChild(lane);

      // Double-rAF: first rAF queues after paint, second fires after layout is
      // committed so offsetWidth is real.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const w = lane.offsetWidth || 800;
        rulerCanvas.width = w;
        rulerCanvas.height = LANE_H;
        drawRuler(rulerCanvas, totalBars(), 4, true);
        renderLane(track.id);
      }));
    });
  }

  return {
    addTrack,
    removeTrack,
    updateSelectedRegion,
    deleteSelectedRegion,
    rebuildStepGridRows,
    renderTrackList,
    attachScheduler,
    detachScheduler,
    undo,
    redo,
    soloTracks,
    _tracks: loopTracks
  };
}
