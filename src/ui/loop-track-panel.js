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
 * @typedef {{ bar: number, len: number, gain: number, chops: number, sliceSensitivity: number, mode: "cut"|"stretch", sampleOffset?: number }} LoopRegion
 * `sampleOffset` is seconds into the audio buffer to begin playback (cut mode only). Default 0.
 * @typedef {{ id: string, name: string, barsInFile: number, audioUrl: string, buffer: AudioBuffer|null, regions: LoopRegion[], selected: boolean }} LoopTrack
 */

const LANE_H = 64; // px – must match CSS .sample-lane height

// ── Waveform painter ─────────────────────────────────────────────────────────
/**
 * Render a mono overview waveform for `buffer` into `canvas`.
 * The waveform is drawn from x=startFrac*width to x=endFrac*width so regions
 * can show the correct section of the sample.
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

  const drawW = Math.round((endFrac - startFrac) * W);
  const offsetX = Math.round(startFrac * W);
  const samplesPerPx = (length * (endFrac - startFrac)) / Math.max(1, drawW);
  const sampleOffset = Math.round(startFrac * length);

  ctx.fillStyle = color + "33";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;

  // Draw filled waveform (min/max per pixel column)
  for (let px = 0; px < drawW; px++) {
    const s0 = Math.floor(sampleOffset + px * samplesPerPx);
    const s1 = Math.min(length, Math.floor(sampleOffset + (px + 1) * samplesPerPx));
    let min = 0, max = 0;
    for (let s = s0; s < s1; s++) {
      const v = merged[s];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const yMin = ((1 - max) / 2) * H;
    const yMax = ((1 - min) / 2) * H;
    ctx.fillRect(offsetX + px, yMin, 1, Math.max(1, yMax - yMin));
  }

  // Centre line
  ctx.strokeStyle = color + "44";
  ctx.beginPath();
  ctx.moveTo(offsetX, H / 2);
  ctx.lineTo(offsetX + drawW, H / 2);
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
        const naturalRegionSec = barDurationSec * (track.barsInFile || 1);

        let playbackRate, playDuration;
        const sampleOffset = region.sampleOffset ?? 0;
        if (mode === "stretch") {
          playbackRate = sampleDurationSec > 0 ? naturalRegionSec / sampleDurationSec : 1;
          playDuration = regionDurationSec;
        } else {
          playbackRate = 1;
          const remainingSec = Math.max(0, sampleDurationSec - sampleOffset);
          playDuration = Math.min(remainingSec, regionDurationSec);
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

        src.start(scheduledTime, sampleOffset);
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

    // ── Move region: drag the region left/right to a new bar position.
    addItem("↔  Move region…", () => {
      const lane = stepGrid.querySelector(`.sample-lane[data-loop-track="${track.id}"]`);
      if (!lane) return;
      const regionEl = lane.querySelectorAll(".sample-region")[regionIdx];
      if (!regionEl) return;

      // Visual cue: add a move-pending class
      regionEl.classList.add("sample-region--move-pending");
      regionEl.style.cursor = "grab";
      regionEl.title = "Drag to move region";

      const startMoveBar = region.bar;
      const laneWidth = lane.offsetWidth || 800;
      const pxPerBar = laneWidth / totalBarsCount;

      let moved = false;

      const onMouseDown = (ev) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        ev.preventDefault();
        regionEl.style.cursor = "grabbing";

        const startX = ev.clientX;
        const origBar = region.bar;

        const onMove = (me) => {
          const dx = me.clientX - startX;
          const deltaBar = Math.round(dx / pxPerBar);
          region.bar = Math.max(0, Math.min(totalBarsCount - region.len, origBar + deltaBar));
          const pct = regionPercent(region, totalBarsCount);
          regionEl.style.left = `${pct.left}%`;
          moved = true;
        };

        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          regionEl.removeEventListener("mousedown", onMouseDown);
          regionEl.classList.remove("sample-region--move-pending");
          regionEl.style.cursor = "";
          regionEl.title = "";
          if (moved) {
            renderLane(track.id);
            syncRegionPanel();
          }
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      };

      regionEl.addEventListener("mousedown", onMouseDown, { once: false });
    });

    sep();

    // ── Stretch to fill: expands the region to cover from its start bar to
    //    the end of the song's total bars.
    addItem("↕  Stretch to fill", () => {
      region.len = Math.max(1, totalBarsCount - region.bar);
      renderLane(track.id);
      syncRegionPanel();
    });

    sep();

    // ── Inverse: keep the parts of the timeline NOT covered by this region.
    //    Creates up to two new regions (before and after), then removes this one.
    addItem("⬛  Inverse (keep outside this region)", () => {
      const newRegions = [];
      if (region.bar > 0) {
        newRegions.push({ bar: 0, len: region.bar, gain: region.gain, chops: region.chops, sliceSensitivity: region.sliceSensitivity ?? 0.12, mode: region.mode ?? "cut" });
      }
      const afterBar = region.bar + region.len;
      if (afterBar < totalBarsCount) {
        newRegions.push({ bar: afterBar, len: totalBarsCount - afterBar, gain: region.gain, chops: region.chops, sliceSensitivity: region.sliceSensitivity ?? 0.12, mode: region.mode ?? "cut" });
      }
      track.regions.splice(regionIdx, 1, ...newRegions);
      selectedLoopRegion = newRegions.length > 0 ? { trackId: track.id, regionIdx } : null;
      syncRegionPanel();
      renderLane(track.id);
    });

    sep();

    // ── Mode toggle: cut vs stretch
    const currentMode = region.mode ?? "cut";
    const modeLabel = currentMode === "cut"
      ? "↔  Enable time-stretch (fills region duration)"
      : "✂  Disable stretch → Cut mode (natural speed)";
    addItem(modeLabel, () => {
      region.mode = currentMode === "cut" ? "stretch" : "cut";
      renderLane(track.id);
      syncRegionPanel();
    });

    sep();

    // ── Duplicate
    addItem("⧉  Duplicate region", () => {
      const dupe = { ...region };
      // Place the duplicate immediately after, clamped to the timeline
      dupe.bar = Math.min(region.bar + region.len, totalBarsCount - 1);
      dupe.len = Math.min(region.len, totalBarsCount - dupe.bar);
      track.regions.push(dupe);
      selectRegion(track.id, track.regions.length - 1);
      renderLane(track.id);
    });

    // ── Delete
    addItem("🗑  Delete region", () => {
      track.regions.splice(regionIdx, 1);
      selectedLoopRegion = null;
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
    //    Everything outside the marquee is removed.
    //    We use the raw floating-point bar positions for precise intersection,
    //    then round to integer bars for the final region boundaries.
    addItem("✂  Cut-inverse (keep inside selection)", (startBar, len, leftFrac, rightFrac) => {
      const bars = totalBars();
      const next = [];
      track.regions.forEach((region) => {
        // Convert region to fractions
        const rL = region.bar / bars;
        const rR = (region.bar + region.len) / bars;
        // Intersect with marquee in fraction space
        const oL = Math.max(rL, leftFrac);
        const oR = Math.min(rR, rightFrac);
        if (oR > oL) {
          // Convert back to bars
          const newBar = Math.round(oL * bars);
          const newEnd = Math.round(oR * bars);
          const newLen = Math.max(1, newEnd - newBar);
          // Compute sampleOffset: how many seconds into the audio to start.
          // In cut mode, 1 bar of the sample = sampleDuration / barsInFile seconds.
          // The kept region starts at fraction (oL - rL) / (rR - rL) through the
          // original region, which maps to:
          //   sampleOffset = (oL - rL) * bars / (track.barsInFile || 1) * bufferDuration
          // We store the raw seconds offset so the scheduler can use it directly.
          let sampleOffset = region.sampleOffset ?? 0;
          if ((region.mode ?? "cut") === "cut") {
            const secPerBarOfSample = (track.buffer ? track.buffer.duration : 0) / (track.barsInFile || 1);
            sampleOffset = sampleOffset + (oL - rL) * bars * secPerBarOfSample;
          }
          next.push({ ...region, bar: newBar, len: newLen, sampleOffset });
        }
      });
      setStatus(`Cut-inverse: kept ${next.length} region(s) inside selection`);
      track.regions.length = 0;
      track.regions.push(...next);
      selectedLoopRegion = null;
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
          // What fraction of the full file is this region?
          const fileFrac = track.barsInFile > 0 ? 1 / track.barsInFile : 1;
          const loopFrac = (region.len % track.barsInFile || track.barsInFile) * fileFrac;
          // If region has a sampleOffset (cut-inverse), shift the displayed waveform window
          const offsetFrac = (region.sampleOffset ?? 0) / track.buffer.duration;
          const waveStart = Math.min(1, offsetFrac);
          const waveEnd   = Math.min(1, offsetFrac + loopFrac);
          drawWaveform(waveCanvas, track.buffer, waveStart, waveEnd);
        }
      }));

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
            // Short click on empty lane → dismiss any marquee, deselect
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
    soloTracks,
    _tracks: loopTracks
  };
}
