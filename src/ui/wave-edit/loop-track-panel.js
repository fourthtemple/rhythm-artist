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
import {
  localFileReference,
  resolveFileHandleSample,
  resolveSampleFromFolder,
  SAMPLE_SOURCE_BROWSER_HANDLE,
  storeFileHandle,
  supportsPersistentFileHandles
} from "../sample-assets.js";
import { positionContextMenu } from "../context-menu.js";
import { syncStepGridLaneRows } from "../grid/lane-grid-layout.js";

/**
 * @typedef {{ bar: number, len: number, gain: number, chops: number, sliceSensitivity: number, mode: "cut"|"stretch", srcStartFrac?: number, srcEndFrac?: number, sampleOffset?: number }} LoopRegion
 * `srcStartFrac`/`srcEndFrac` describe which slice of the audio buffer this
 * region plays/draws, as fractions (0–1) of the buffer. Default 0–1 (whole file).
 * `sampleOffset` is the legacy seconds-based start point, migrated on read.
 * @typedef {{ id: string, name: string, barsInFile: number, audioUrl: string|null, source?: string, url?: string|null, root?: string|null, path?: string|null, fileName?: string|null, handleId?: string|null, relinkRequired?: boolean, missing?: boolean, buffer: AudioBuffer|null, regions: LoopRegion[], selected: boolean }} LoopTrack
 */

const LANE_H = 64; // px – must match CSS .sample-lane height
const BAR_EPSILON = 1e-6;
const MIN_REGION_BARS = 1 / 64;

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const formatBars = (value) => {
  const n = finiteNumber(value, 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
};
const waveformOverviewCache = new WeakMap();

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

/**
 * Map a timeline bar span to the exact source-buffer fraction that should
 * play/draw for that span.
 */
export function regionSourceSlice(region, track, startBar, endBar, bufferDuration = 0, barDurationSec = 0) {
  const regionStartBar = finiteNumber(region?.bar, 0);
  const regionLenBars = Math.max(MIN_REGION_BARS, finiteNumber(region?.len, 1));
  const regionEndBar = regionStartBar + regionLenBars;
  const sliceStartBar = Math.max(regionStartBar, finiteNumber(startBar, regionStartBar));
  const sliceEndBar = Math.min(regionEndBar, finiteNumber(endBar, sliceStartBar));
  const sliceBars = Math.max(0, sliceEndBar - sliceStartBar);
  const { startFrac, endFrac } = regionSrc(region, bufferDuration);
  const sourceSpanFrac = Math.max(0, endFrac - startFrac);
  const mode = region?.mode ?? "cut";

  if (mode === "stretch") {
    const relStart = (sliceStartBar - regionStartBar) / regionLenBars;
    const relEnd = (sliceStartBar + sliceBars - regionStartBar) / regionLenBars;
    return {
      startFrac: Math.max(0, Math.min(1, startFrac + relStart * sourceSpanFrac)),
      endFrac: Math.max(0, Math.min(1, startFrac + relEnd * sourceSpanFrac))
    };
  }

  if (bufferDuration > 0 && barDurationSec > 0) {
    const sourceStartSec = startFrac * bufferDuration + Math.max(0, sliceStartBar - regionStartBar) * barDurationSec;
    const sourceEndSec = Math.min(endFrac * bufferDuration, sourceStartSec + sliceBars * barDurationSec);
    return {
      startFrac: Math.max(0, Math.min(1, sourceStartSec / bufferDuration)),
      endFrac: Math.max(0, Math.min(1, sourceEndSec / bufferDuration))
    };
  }

  // Fallback for pure tests and older callers that do not know current BPM.
  // This preserves legacy bar-count mapping when real-time duration is unknown.
  const hasSrcFracs = region?.srcStartFrac != null && region?.srcEndFrac != null;
  const sourceDenomBars = hasSrcFracs
    ? regionLenBars
    : Math.max(MIN_REGION_BARS, finiteNumber(track?.barsInFile, 1));
  const relStart = (sliceStartBar - regionStartBar) / sourceDenomBars;
  const relEnd = (sliceStartBar + sliceBars - regionStartBar) / sourceDenomBars;
  return {
    startFrac: Math.max(0, Math.min(1, startFrac + relStart * sourceSpanFrac)),
    endFrac: Math.max(0, Math.min(1, startFrac + relEnd * sourceSpanFrac))
  };
}

/**
 * Return the region list produced by "Cut (keep inside selection)" without
 * mutating the track. The selection is expressed in absolute bar units and may
 * be fractional; kept regions retain the exact timeline position of the
 * selection overlap.
 */
export function cutRegionsToSelection(track, startBar, len, bufferDuration = 0, barDurationSec = 0) {
  const selectionStart = Math.max(0, finiteNumber(startBar, 0));
  const selectionLen = Math.max(MIN_REGION_BARS, finiteNumber(len, 0));
  const selectionEnd = selectionStart + selectionLen;
  const regions = Array.isArray(track?.regions) ? track.regions : [];
  const next = [];

  regions.forEach((region) => {
    const rStart = finiteNumber(region.bar, 0);
    const rLen = Math.max(MIN_REGION_BARS, finiteNumber(region.len, 1));
    const rEnd = rStart + rLen;
    const oL = Math.max(rStart, selectionStart);
    const oR = Math.min(rEnd, selectionEnd);
    if (oR <= oL + BAR_EPSILON) return;

    const newLen = Math.max(MIN_REGION_BARS, oR - oL);
    const { startFrac: srcStartFracRaw, endFrac: srcEndFracRaw } = regionSourceSlice(
      region,
      track,
      oL,
      oR,
      bufferDuration,
      barDurationSec
    );
    const srcStartFrac = Math.max(0, Math.min(1, srcStartFracRaw));
    const srcEndFrac = Math.max(srcStartFrac + 1e-9, Math.min(1, srcEndFracRaw));

    next.push({ ...region, bar: oL, len: newLen, srcStartFrac, srcEndFrac, sampleOffset: undefined });
  });

  return next.sort((a, b) => a.bar - b.bar);
}

export function makeUnscaledRevealRegion(region, side, revealLen, bufferDuration = 0, barDurationSec = 0) {
  const safeLen = Math.max(0, finiteNumber(revealLen, 0));
  const srcPerBar = bufferDuration > 0 && barDurationSec > 0
    ? barDurationSec / bufferDuration
    : 0;
  if (safeLen <= BAR_EPSILON || srcPerBar <= 0) return null;

  const baseBar = finiteNumber(region?.bar, 0);
  const baseLen = Math.max(MIN_REGION_BARS, finiteNumber(region?.len, 1));
  const { startFrac, endFrac } = regionSrc(region, bufferDuration);

  if (side === "left") {
    const srcStartFrac = Math.max(0, startFrac - safeLen * srcPerBar);
    const srcEndFrac = startFrac;
    if (srcEndFrac <= srcStartFrac + 1e-9) return null;
    return {
      ...region,
      bar: Math.max(0, baseBar - safeLen),
      len: safeLen,
      mode: "cut",
      revealPreview: true,
      srcStartFrac,
      srcEndFrac,
      sampleOffset: undefined
    };
  }

  const srcStartFrac = endFrac;
  const srcEndFrac = Math.min(1, endFrac + safeLen * srcPerBar);
  if (srcEndFrac <= srcStartFrac + 1e-9) return null;
  return {
    ...region,
    bar: baseBar + baseLen,
    len: safeLen,
    mode: "cut",
    revealPreview: true,
    srcStartFrac,
    srcEndFrac,
    sampleOffset: undefined
  };
}

// ── Waveform painter ─────────────────────────────────────────────────────────
function getWaveformOverview(buffer) {
  let overview = waveformOverviewCache.get(buffer);
  if (overview) return overview;

  const length = buffer.length;
  const bucketCount = Math.max(512, Math.min(65536, Math.ceil(length / 512)));
  const mins = new Float32Array(bucketCount);
  const maxes = new Float32Array(bucketCount);

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor((bucket / bucketCount) * length);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) / bucketCount) * length));
    let min = 0;
    let max = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
      const data = buffer.getChannelData(ch);
      for (let sample = start; sample < end; sample += 1) {
        const v = data[sample] / buffer.numberOfChannels;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    mins[bucket] = min;
    maxes[bucket] = max;
  }

  overview = { mins, maxes, bucketCount };
  waveformOverviewCache.set(buffer, overview);
  return overview;
}

/**
 * Render a mono overview waveform for `buffer` into `canvas`.
 * `startFrac`/`endFrac` select WHICH slice of the buffer to read (fractions
 * 0–1). By default the selected slice is painted across the full canvas;
 * target pixel bounds can limit drawing when a cut-mode region contains
 * visible silence after the source audio ends.
 * @param {boolean} [clear=true] Whether to clearRect first (false = paint on top).
 */
function drawWaveform(canvas, buffer, startFrac = 0, endFrac = 1, color = "#5b9bd5", clear = true, targetStartPx = 0, targetEndPx = canvas.width) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  if (clear) ctx.clearRect(0, 0, W, H);

  if (!buffer) return;

  const s = Math.max(0, Math.min(1, startFrac));
  const e = Math.max(0, Math.min(1, endFrac));
  const span = Math.max(1e-9, e - s);
  const overview = getWaveformOverview(buffer);
  const { mins, maxes, bucketCount } = overview;
  const firstBucket = s * bucketCount;
  const targetStart = clampNumber(Math.floor(finiteNumber(targetStartPx, 0)), 0, W);
  const targetEnd = clampNumber(Math.ceil(finiteNumber(targetEndPx, W)), targetStart, W);
  const targetW = Math.max(1, targetEnd - targetStart);
  const bucketsPerPx = (span * bucketCount) / targetW;

  ctx.fillStyle = color + "33";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;

  // Draw filled waveform (min/max per pixel column) inside the requested target range.
  for (let px = targetStart; px < targetEnd; px++) {
    const localPx = px - targetStart;
    const b0 = Math.max(0, Math.min(bucketCount - 1, Math.floor(firstBucket + localPx * bucketsPerPx)));
    const b1 = Math.max(b0 + 1, Math.min(bucketCount, Math.ceil(firstBucket + (localPx + 1) * bucketsPerPx)));
    let min = 0, max = 0;
    for (let bucket = b0; bucket < b1; bucket += 1) {
      const lo = mins[bucket];
      const hi = maxes[bucket];
      if (lo < min) min = lo;
      if (hi > max) max = hi;
    }
    const yMin = ((1 - max) / 2) * H;
    const yMax = ((1 - min) / 2) * H;
    ctx.fillRect(px, yMin, 1, Math.max(1, yMax - yMin));
  }

  // Centre line
  ctx.strokeStyle = color + "44";
  ctx.beginPath();
  ctx.moveTo(targetStart, H / 2);
  ctx.lineTo(targetEnd, H / 2);
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
  getActiveBar = () => 0,
  getSegmentsCount = () => getBarsLength(),
  setStatus = () => {},
  getEngine = () => null,
  getQuantize = () => ({ enabled: false, value: 0.25 }),
  getCameraMode = () => false,
  getTrackEditorMode = () => null,
  getSelectedPatternTrack = () => null,
  onEditorLaneOpen = null,
  onEditorLaneFocus = null,
  onTrackSelect = null,
  onTrackRemove = null,
  editorLaneGridRow = null,
  rebuildTrackStack = null,
  showContextMenu = null,
  moveTrackLane = null,
  addSampleToBrowser = null,
  trackName = (id) => id,
  isTrackMuted = () => false,
  toggleMute = null,
  onSoloChange = null,
  onNavigate = null   // (bar: number) => void  — called to scroll view to a bar
}) {
  /** @type {LoopTrack[]} */
  const loopTracks = [];
  /** @type {Set<string>} Track IDs that are soloed */
  const soloTracks = new Set();
  /** @type {{ trackId: string, regionIdx: number } | null} */
  let selectedLoopRegion = null;
  /** @type {{ trackId: string, regionIdx: number } | null} */
  let regionMenuTarget = null;
  /** @type {{ trackId: string, regionIdx: number, mode: "move"|"scale"|"reveal"|"reveal-scaled" } | null} */
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
  /** @type {{ trackId: string, trackName: string, len: number, regions: LoopRegion[] } | null} */
  let waveEditClipboard = null;

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

  function serializeRegion(region) {
    return {
      bar: finiteNumber(region.bar, 0),
      len: Math.max(MIN_REGION_BARS, finiteNumber(region.len, 1)),
      gain: clampNumber(finiteNumber(region.gain, 1), 0, 2),
      chops: Math.max(1, Math.min(32, Math.round(finiteNumber(region.chops, 4)))),
      sliceSensitivity: clampNumber(finiteNumber(region.sliceSensitivity, 0.12), 0.01, 0.5),
      mode: region.mode === "stretch" ? "stretch" : "cut",
      ...(Number.isFinite(Number(region.srcStartFrac)) ? { srcStartFrac: clampNumber(Number(region.srcStartFrac), 0, 1) } : {}),
      ...(Number.isFinite(Number(region.srcEndFrac)) ? { srcEndFrac: clampNumber(Number(region.srcEndFrac), 0, 1) } : {})
    };
  }

  function wavBlobFromBufferSlice(buffer, startFrac = 0, endFrac = 1) {
    const channels = Math.max(1, buffer.numberOfChannels || 1);
    const sampleRate = buffer.sampleRate || 44100;
    const startFrame = Math.max(0, Math.min(buffer.length - 1, Math.floor(clampNumber(startFrac, 0, 1) * buffer.length)));
    const endFrame = Math.max(startFrame + 1, Math.min(buffer.length, Math.ceil(clampNumber(endFrac, 0, 1) * buffer.length)));
    const frameCount = Math.max(1, endFrame - startFrame);
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = frameCount * blockAlign;
    const bytes = new ArrayBuffer(44 + dataSize);
    const view = new DataView(bytes);
    const writeString = (offset, value) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);
    let offset = 44;
    for (let frame = startFrame; frame < endFrame; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const data = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
        const sample = Math.max(-1, Math.min(1, data[frame] || 0));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += bytesPerSample;
      }
    }
    return new Blob([bytes], { type: "audio/wav" });
  }

  function copiedRegionsForSelection(track, startBar, len) {
    const bufferDuration = track.buffer ? track.buffer.duration : 0;
    const clipped = cutRegionsToSelection(track, startBar, len, bufferDuration, currentBarDurationSec());
    if (clipped.length) {
      return clipped.map((region) => ({
        ...serializeRegion(region),
        bar: Math.max(0, finiteNumber(region.bar, startBar) - startBar)
      }));
    }
    const fileBars = Math.max(MIN_REGION_BARS, finiteNumber(track.barsInFile, totalSongBars()));
    const srcStartFrac = clampNumber(startBar / fileBars, 0, 1);
    const srcEndFrac = Math.max(srcStartFrac + 1e-9, clampNumber((startBar + len) / fileBars, 0, 1));
    return [{
      bar: 0,
      len: Math.max(MIN_REGION_BARS, len),
      gain: 1,
      chops: 4,
      sliceSensitivity: 0.12,
      mode: "cut",
      srcStartFrac,
      srcEndFrac
    }];
  }

  function copyWaveEditSelection(track, startBar, len) {
    const regions = copiedRegionsForSelection(track, startBar, len);
    waveEditClipboard = {
      trackId: track.id,
      trackName: track.name,
      len: Math.max(MIN_REGION_BARS, len),
      regions: regions.map((region) => ({ ...region }))
    };
    setStatus(`Copied wave edit from "${track.name}"`);
  }

  function pasteWaveEdit(track, startBar, targetLen = null) {
    if (!waveEditClipboard?.regions?.length) {
      setStatus("Copy a wave edit selection first");
      return;
    }
    if (waveEditClipboard.trackId !== track.id) {
      setStatus(`Paste this wave edit back onto "${waveEditClipboard.trackName}"`);
      return;
    }
    const sourceLen = Math.max(MIN_REGION_BARS, finiteNumber(waveEditClipboard.len, 1));
    const scale = targetLen && targetLen > MIN_REGION_BARS ? Math.max(MIN_REGION_BARS, targetLen) / sourceLen : 1;
    const inserted = [];
    pushHistory();
    waveEditClipboard.regions.forEach((region) => {
      const pasted = {
        ...serializeRegion(region),
        bar: startBar + finiteNumber(region.bar, 0) * scale,
        len: Math.max(MIN_REGION_BARS, finiteNumber(region.len, sourceLen) * scale)
      };
      inserted.push(pasted);
      track.regions.push(pasted);
    });
    track.regions.sort((a, b) => a.bar - b.bar);
    const pastedIndex = track.regions.indexOf(inserted[0]);
    selectRegion(track.id, pastedIndex >= 0 ? pastedIndex : track.regions.length - 1);
    renderLane(track.id);
    setStatus(`Pasted wave edit into "${track.name}"`);
  }

  function fileFromWaveEditBlob(blob, name) {
    if (typeof File === "function") {
      return new File([blob], name, { type: blob.type || "audio/wav" });
    }
    try { blob.name = name; } catch {}
    return blob;
  }

  function regionSliceSample(track, region, labelStartBar = 0) {
    if (!track.buffer) {
      return null;
    }
    const srcStartFrac = Number.isFinite(Number(region?.srcStartFrac)) ? Number(region.srcStartFrac) : 0;
    const srcEndFrac = Number.isFinite(Number(region?.srcEndFrac)) ? Number(region.srcEndFrac) : 1;
    const safeEndFrac = Math.max(srcStartFrac + 1e-9, Math.min(1, srcEndFrac));
    const blob = wavBlobFromBufferSlice(track.buffer, srcStartFrac, safeEndFrac);
    const baseName = String(track.name || "Wave Edit").replace(/\.[^.]+$/, "").trim() || "Wave Edit";
    const label = `${baseName} edit ${formatBars(labelStartBar + 1)}`;
    const fileName = `${label}.wav`;
    const file = fileFromWaveEditBlob(blob, fileName);
    const url = URL.createObjectURL(blob);
    return {
      label,
      name: fileName,
      path: fileName,
      file,
      url
    };
  }

  function copyRegionSliceToSampleBrowser(track, region, labelStartBar = 0) {
    if (!addSampleToBrowser) {
      setStatus("Sample Browser capture is not available");
      return;
    }
    if (!track.buffer) {
      setStatus(`"${track.name}" needs audio before copying to Sample Browser`);
      return;
    }
    const sample = regionSliceSample(track, region, labelStartBar);
    if (!sample) {
      setStatus("Could not copy wave edit to Sample Browser");
      return;
    }
    addSampleToBrowser(sample);
  }

  function copySelectionToSampleBrowser(track, startBar, len) {
    const regions = copiedRegionsForSelection(track, startBar, len);
    const slice = regions[0];
    copyRegionSliceToSampleBrowser(track, slice, startBar);
  }

  function copyClipboardToSampleBrowser() {
    if (!waveEditClipboard?.regions?.length) {
      setStatus("Copy a wave edit selection first");
      return;
    }
    const track = trackById(waveEditClipboard.trackId);
    if (!track) {
      setStatus("Copied wave edit source is gone");
      return;
    }
    copyRegionSliceToSampleBrowser(track, waveEditClipboard.regions[0], 0);
  }

  function serializeTracks() {
    return loopTracks
      .filter((track) => {
        const hasBundledUrl = typeof track.url === "string" && track.url && !track.url.startsWith("blob:");
        return hasBundledUrl || track.handleId || track.relinkRequired;
      })
      .map((track) => ({
        id: track.id,
        name: track.name,
        barsInFile: Math.max(1, Math.round(finiteNumber(track.barsInFile, 1))),
        source: track.source || (track.handleId ? "browser-file-handle" : track.url ? "bundled-sample" : "local-file"),
        ...(typeof track.url === "string" && track.url && !track.url.startsWith("blob:") ? { url: track.url } : {}),
        root: track.root ?? null,
        path: track.path ?? null,
        fileName: track.fileName ?? null,
        handleId: track.handleId ?? null,
        relinkRequired: Boolean(track.relinkRequired),
        regions: track.regions.map(serializeRegion)
      }));
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
    if (!undoStack.length) return false;
    redoStack.push(snapshot());
    applySnapshot(undoStack.pop());
    setStatus("Undo");
    return true;
  }
  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(snapshot());
    applySnapshot(redoStack.pop());
    setStatus("Redo");
    return true;
  }

  // Global keyboard shortcuts: ⌘/Ctrl-Z undo, ⌘/Ctrl-Shift-Z or Ctrl-Y redo.
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === "z") {
      const handled = e.shiftKey ? redo() : undo();
      if (handled) e.preventDefault();
    } else if (key === "y") {
      if (redo()) e.preventDefault();
    }
  });

  // ── Smooth playhead animation ────────────────────────────────────────────
  // We interpolate sub-bar position using ctx.currentTime vs scheduledTime
  // so the line glides smoothly across each bar rather than jumping.
  function samplePlayheads() {
    return Array.from(stepGrid.querySelectorAll(".sample-lane-playhead"));
  }

  function hideSamplePlayheads(playheads = samplePlayheads()) {
    playheads.forEach((el) => { el.style.display = "none"; });
  }

  function renderPlayheads() {
    if (_playheadRaf) {
      cancelAnimationFrame(_playheadRaf);
      _playheadRaf = null;
    }

    const playheads = samplePlayheads();
    if (!playheads.length || getCameraMode()) {
      hideSamplePlayheads(playheads);
      return;
    }

    const engine = getEngine();
    const ctx = engine?.context;
    const bpm = engine ? engine.currentBpm?.() ?? 120 : 120;
    const bars = totalBars();
    const secPerBeat = 60 / bpm;
    const barDurationSec = secPerBeat * 4;
    const laneWidth = playheads[0]?.parentElement?.clientWidth || 0;

    function frame() {
      if (!engine?.playing || getCameraMode()) {
        _playheadRaf = null;
        hideSamplePlayheads(playheads);
        return;
      }
      const now = ctx ? ctx.currentTime : 0;
      // How far into the current bar are we? (0..1)
      const fracInBar = Math.min(1, Math.max(0, (now - _playheadScheduledTime) / barDurationSec));
      // Position within the *visible* window (activeBar … activeBar+segmentsCount).
      // If the playhead bar is outside the window, hide it.
      const segments = totalBars();
      const activeBar = getActiveBar();
      const localBar = _playheadBar - activeBar;
      if (localBar < 0 || localBar >= segments) {
        _playheadRaf = null;
        hideSamplePlayheads(playheads);
        return;
      }
      const pct = Math.min(100, Math.max(0, ((localBar + fracInBar) / segments) * 100));
      const x = laneWidth * (pct / 100);

      playheads.forEach((el) => {
        el.style.display = "";
        el.style.transform = `translateX(${Math.round(x) - 1}px)`;
      });
      _playheadRaf = requestAnimationFrame(frame);
    }
    frame();
  }

  function stopPlayheads() {
    if (_playheadRaf) { cancelAnimationFrame(_playheadRaf); _playheadRaf = null; }
    hideSamplePlayheads();
  }

  // ── Audio context: always reuse the engine's context so everything stays
  // on the same clock. Fall back to a local one only if the engine hasn't
  // initialised yet.
  function getAudioCtx() {
    return getEngine()?.context ?? null;
  }

  // ── Scheduler ────────────────────────────────────────────────────────────
  // Called on every "bar" event from the engine.
  function onBarEvent({ bar, phraseBar, scheduledTime, bpm }) {
    const engine = getEngine();
    const ctx = engine?.context;
    if (!ctx) return;
    const masterOut = engine.masterGain ?? ctx.destination;
    const anySolo = soloTracks.size > 0;
    const visibleBars = totalBars();
    // phraseBar is 0-based position within the current phrase (0..PHRASE_BARS-1),
    // matching exactly what the drum grid uses. Fall back to bar%songBars if missing.
    const songBars = totalSongBars();
    const currentPhraseBar = (phraseBar != null) ? phraseBar : (bar % songBars);

    // _playheadBar is the phraseBar — renderPlayheads converts to visible-window coords.
    _playheadBar = currentPhraseBar;
    _playheadScheduledTime = scheduledTime;
    renderPlayheads();

    loopTracks.forEach((track) => {
      if (isTrackMuted(track.id)) return;
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
        const regionStartBar = finiteNumber(region.bar, 0);
        const regionLenBars = Math.max(MIN_REGION_BARS, finiteNumber(region.len, 1));
        const regionEndBar = regionStartBar + regionLenBars;
        const barStart = currentPhraseBar;
        const barEnd = currentPhraseBar + 1;
        const overlapStart = Math.max(regionStartBar, barStart);
        const overlapEnd = Math.min(regionEndBar, barEnd);
        if (overlapEnd <= overlapStart + BAR_EPSILON) return;

        const gain = region.gain ?? 1;
        const mode = region.mode ?? "cut";
        const secPerBeat = 60 / bpm;
        const barDurationSec = secPerBeat * 4;
        const regionDurationSec = barDurationSec * regionLenBars;
        const overlapBars = overlapEnd - overlapStart;
        const sampleDurationSec = track.buffer.duration;

        // Which slice of the buffer does this region play?
        const { startFrac, endFrac } = regionSrc(region, sampleDurationSec);
        const srcWindowSec = Math.max(0, (endFrac - startFrac) * sampleDurationSec);
        const sourceSlice = regionSourceSlice(
          region,
          track,
          overlapStart,
          overlapEnd,
          sampleDurationSec,
          barDurationSec
        );
        const srcStartSec = sourceSlice.startFrac * sampleDurationSec;
        const srcEndSec = sourceSlice.endFrac * sampleDurationSec;
        const sourceSliceSec = Math.max(0, srcEndSec - srcStartSec);

        let playbackRate, playDuration;
        if (mode === "stretch") {
          // Stretch the selected window to fill the region's musical duration.
          playbackRate = srcWindowSec > 0 ? srcWindowSec / regionDurationSec : 1;
          playDuration = overlapBars * barDurationSec;
        } else {
          playbackRate = 1;
          playDuration = Math.min(sourceSliceSec, overlapBars * barDurationSec);
        }

        if (playDuration <= 0) return;

        const startOffsetSec = Math.max(0, overlapStart - currentPhraseBar) * barDurationSec;
        const startTime = scheduledTime + startOffsetSec;

        console.log(`[loop] scheduling "${track.name}" bar=${overlapStart.toFixed(3)} rate=${playbackRate.toFixed(3)} dur=${playDuration.toFixed(2)}s at ${startTime.toFixed(3)}`);

        const src = ctx.createBufferSource();
        src.buffer = track.buffer;
        src.playbackRate.value = playbackRate;
        src.loop = false;

        const gainNode = ctx.createGain();
        gainNode.gain.value = gain;
        src.connect(gainNode);
        gainNode.connect(masterOut);

        src.start(startTime, srcStartSec);
        src.stop(startTime + playDuration + 0.05);
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
    // Engine not started yet — decode with an OfflineAudioContext for waveform preview.
    // OfflineAudioContext never needs a user gesture and is always in a runnable state,
    // so this works immediately when the file is picked, before the user hits play.
    const tmp = new OfflineAudioContext(2, 44100, 44100);
    return tmp.decodeAudioData(uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength));
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
  // Visible window: how many bars the step grid is currently showing.
  const totalBars = () => Math.max(1, getSegmentsCount());
  // Full song length: used for scheduling so regions outside the window still play.
  const totalSongBars = () => Math.max(1, getBarsLength());
  const shouldShowWaveLanes = () => loopTracks.length > 0;
  const currentBarDurationSec = () => {
    const bpm = getEngine()?.currentBpm?.() ?? 120;
    return (60 / Math.max(1, finiteNumber(bpm, 120))) * 4;
  };
  function renderLoopSoloButtons() {
    stepGrid.querySelectorAll("[data-loop-solo-track]").forEach((button) => {
      button.classList.toggle("is-active", soloTracks.has(button.dataset.loopSoloTrack));
    });
  }
  function syncLoopSoloState() {
    renderLoopSoloButtons();
    onSoloChange?.({
      active: soloTracks.size > 0,
      tracks: Array.from(soloTracks)
    });
  }

  // Snap a bar position to the current quantize grid (or return as-is if off).
  function snapQ(bar) {
    const q = getQuantize();
    if (!q.enabled || !(q.value > 0)) return bar;
    return Math.round(bar / q.value) * q.value;
  }
  // Snap a lane fraction (0–1) to the quantize grid given the visible bar count.
  function snapFrac(frac, visibleBars) {
    const q = getQuantize();
    if (!q.enabled || !(q.value > 0)) return frac;
    const rawBar = frac * visibleBars;
    return Math.round(rawBar / q.value) * q.value / visibleBars;
  }

  function barFromLaneClientX(lane, clientX, visibleBars = totalBars()) {
    const maxBar = Math.max(0, totalSongBars() - MIN_REGION_BARS);
    const rect = lane?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0) {
      return clampNumber(snapQ(getActiveBar()), 0, maxBar);
    }
    const clickFrac = clampNumber((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const rawBar = clampNumber(getActiveBar() + clickFrac * Math.max(1, visibleBars), 0, maxBar);
    return clampNumber(snapQ(rawBar), 0, maxBar);
  }

  function applyRegionElementWindowStyle(el, region, visibleBars) {
    const winStart = getActiveBar();
    const winEnd = winStart + visibleBars;
    const regionStart = finiteNumber(region.bar, 0);
    const regionEnd = regionStart + Math.max(MIN_REGION_BARS, finiteNumber(region.len, 1));
    const visibleStart = Math.max(regionStart, winStart);
    const visibleEnd = Math.min(regionEnd, winEnd);
    if (visibleEnd <= visibleStart + BAR_EPSILON) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    el.style.left = `${((visibleStart - winStart) / visibleBars) * 100}%`;
    el.style.width = `${((visibleEnd - visibleStart) / visibleBars) * 100}%`;
  }

  function maybeAutoNavigateDrag(clientX, trackId, scrollState) {
    if (!onNavigate) return 0;
    const liveLane = stepGrid.querySelector(`.sample-lane[data-loop-track="${trackId}"]`);
    const rect = liveLane?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0) return 0;
    const threshold = Math.max(24, Math.min(80, rect.width * 0.08));
    const visibleBars = totalBars();
    const currentStart = getActiveBar();
    const maxStart = Math.max(0, totalSongBars() - visibleBars);
    let nextStart = currentStart;
    if (clientX > rect.right - threshold && currentStart < maxStart) {
      nextStart = Math.min(maxStart, currentStart + visibleBars);
    } else if (clientX < rect.left + threshold && currentStart > 0) {
      nextStart = Math.max(0, currentStart - visibleBars);
    }
    if (Math.abs(nextStart - currentStart) <= BAR_EPSILON) return 0;

    const now = performance.now();
    if (now - (scrollState.lastAt ?? 0) < 180) return 0;
    scrollState.lastAt = now;
    onNavigate(nextStart);
    return nextStart - currentStart;
  }

  async function decodeTrackAudio(track, file = null) {
    const arrayBuffer = file
      ? await file.arrayBuffer()
      : await fetch(track.audioUrl, { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(`audio-fetch-${response.status}`);
        return response.arrayBuffer();
      });
    track._rawBytes = new Uint8Array(arrayBuffer.slice(0));
    track.buffer = await decodeAudio(new Uint8Array(track._rawBytes));
  }

  function pickRelinkAudioFileFallback() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".wav,.mp3,.ogg,.flac,.aif,.aiff,.m4a,audio/*";
      input.style.position = "fixed";
      input.style.left = "-9999px";
      input.style.top = "0";

      const cleanup = () => {
        window.removeEventListener("focus", onFocus);
        input.remove();
      };
      const finish = (file = null) => {
        cleanup();
        resolve(file
          ? { file, source: localFileReference({ label: file.name, path: file.name }) }
          : null);
      };
      const onFocus = () => {
        setTimeout(() => {
          if (!input.files?.length) finish(null);
        }, 200);
      };

      input.addEventListener("change", () => finish(input.files?.[0] || null), { once: true });
      input.addEventListener("cancel", () => finish(null), { once: true });
      document.body.appendChild(input);
      setTimeout(() => window.addEventListener("focus", onFocus, { once: true }), 0);
      input.click();
    });
  }

  function expectedTrackFileName(track) {
    return track.fileName || String(track.path || "").split(/[\\/]/).pop() || track.name || "sample";
  }

  function isExpectedSampleFolderMiss(error) {
    return [
      "sample-folder-not-found",
      "sample-folder-permission-required",
      "sample-file-not-found-in-folder"
    ].includes(error?.message);
  }

  function isExpectedSavedHandleMiss(error) {
    return error?.message === "sample-handle-not-found" || isExpectedSampleFolderMiss(error);
  }

  async function reopenSavedTrackFile(track) {
    if (!track.handleId) return null;
    const expectedName = expectedTrackFileName(track);
    setStatus(`Looking for "${expectedName}"`);
    try {
      const resolved = await resolveFileHandleSample(track.handleId, { requestPermission: true });
      return {
        file: resolved.file,
        audioUrl: resolved.url,
        source: {
          source: SAMPLE_SOURCE_BROWSER_HANDLE,
          handleId: track.handleId,
          label: resolved.label || expectedName,
          path: resolved.path || track.path || expectedName,
          relinkRequired: false
        }
      };
    } catch (error) {
      console.warn("Saved loop sample handle unavailable", track.name, error);
      return null;
    }
  }

  async function reopenSampleFolderFile(track, { requestPermission = true, resolveFile = null, logFailure = true } = {}) {
    const expectedName = expectedTrackFileName(track);
    setStatus(`Looking for "${expectedName}" in sample folder`);
    if (resolveFile) {
      try {
        const picked = await resolveFile({
          path: track.path || track.fileName || expectedName,
          fileName: expectedName
        });
        if (picked?.file) return picked;
      } catch (error) {
        if (logFailure && !isExpectedSampleFolderMiss(error)) {
          console.warn("Selected sample folder could not relink loop sample", track.name, error);
        }
      }
    }
    try {
      const resolved = await resolveSampleFromFolder({
        path: track.path || track.fileName || expectedName,
        fileName: expectedName,
        requestPermission,
        promptForFolder: false
      });
      const source = await storeFileHandle(resolved.handle, {
        label: resolved.label || expectedName,
        path: resolved.path || expectedName
      });
      return {
        file: resolved.file,
        audioUrl: resolved.url,
        source: {
          ...source,
          label: resolved.label || source.label,
          path: resolved.path || source.path
        }
      };
    } catch (error) {
      if (logFailure && !isExpectedSampleFolderMiss(error)) {
        console.warn("Configured sample folder could not relink loop sample", track.name, error);
      }
      return null;
    }
  }

  async function pickRelinkAudioFile() {
    if (supportsPersistentFileHandles()) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{
            description: "Audio files",
            accept: { "audio/*": [".wav", ".mp3", ".ogg", ".flac", ".aif", ".aiff", ".m4a"] }
          }]
        });
        if (!handle) return null;
        const file = await handle.getFile();
        return {
          file,
          source: await storeFileHandle(handle, { label: file.name, path: file.name })
        };
      } catch {
        return null;
      }
    }
    return pickRelinkAudioFileFallback();
  }

  async function relinkTrack(trackId) {
    const track = trackById(trackId);
    if (!track) return;
    const picked = await reopenSavedTrackFile(track)
      || await reopenSampleFolderFile(track)
      || await pickRelinkAudioFile();
    if (!picked?.file) {
      setStatus(`Relink canceled for "${track.name}"`);
      return;
    }
    await applyRelinkedTrackFile(track, picked);
  }

  async function applyRelinkedTrackFile(track, picked) {
    const { file, source } = picked;
    if (track.audioUrl?.startsWith?.("blob:")) URL.revokeObjectURL(track.audioUrl);
    const audioUrl = picked.audioUrl || URL.createObjectURL(file);
    Object.assign(track, {
      audioUrl,
      source: source.source || (source.handleId ? "browser-file-handle" : "local-file"),
      url: source.url && !source.url.startsWith?.("blob:") ? source.url : null,
      root: source.root ?? null,
      path: source.path ?? file.name,
      fileName: file.name,
      handleId: source.handleId ?? null,
      relinkRequired: Boolean(source.relinkRequired),
      missing: false,
      buffer: null,
      _rawBytes: null
    });
    renderTrackList();
    rebuildStepGridRows();
    setStatus(`Relinking "${track.name}"`);

    try {
      await decodeTrackAudio(track, file);
      attachScheduler();
      renderLane(track.id);
      setStatus(`Relinked "${track.name}"`);
    } catch (error) {
      console.warn("Loop track relink decode failed", track.name, error);
      track.missing = true;
      track.buffer = null;
      renderTrackList();
      renderLane(track.id);
      setStatus(`Could not relink "${track.name}"`);
    }
  }

  async function relinkMissingFromSampleFolder(options = {}) {
    const missingTracks = loopTracks.filter((track) => track.missing);
    if (!missingTracks.length) return 0;
    let relinked = 0;
    for (const track of missingTracks) {
      const picked = await reopenSampleFolderFile(track, options);
      if (!picked?.file) continue;
      await applyRelinkedTrackFile(track, picked);
      if (!track.missing) relinked += 1;
    }
    if (relinked) {
      setStatus(`Relinked ${relinked} sample track${relinked === 1 ? "" : "s"} from sample folder`);
    } else {
      setStatus("No missing sample tracks found in sample folder");
    }
    return relinked;
  }

  async function addTrack(name, file, barsInFile, beatmatch = false, source = {}) {
    const audioUrl = source.url || URL.createObjectURL(file);
    const id = source.id || `loop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    /** @type {LoopTrack} */
    const track = {
      id,
      name,
      barsInFile,
      audioUrl,
      source: source.source || (source.handleId ? "browser-file-handle" : source.url ? "bundled-sample" : "local-file"),
      url: source.url && !source.url.startsWith?.("blob:") ? source.url : null,
      root: source.root ?? null,
      path: source.path ?? null,
      fileName: source.fileName ?? file?.name ?? null,
      handleId: source.handleId ?? null,
      relinkRequired: Boolean(source.relinkRequired),
      missing: false,
      buffer: null,
      regions: [],
      selected: false,
      _rawBytes: null
    };
    loopTracks.push(track);
    onEditorLaneOpen?.("wave", id);
    rebuildTrackStack?.();

    // Seed a default region that covers the song lane. The detected/source bar
    // count is still kept on the track for explicit loop-length workflows, but
    // the initial waveform should follow the same 32-bar song grid as the rest
    // of the editor.
    // beatmatch=true → stretch mode so the sample fits exactly barsInFile bars
    // at project BPM; false → cut mode (natural speed, plays as long as it lasts).
    const regionLen = beatmatch ? Math.max(1, barsInFile) : totalSongBars();
    const region = {
      bar: 0,
      len: regionLen,
      gain: 1,
      chops: 4,
      sliceSensitivity: 0.12,
      mode: beatmatch ? "stretch" : "cut"
    };
    if (beatmatch) {
      region.srcStartFrac = 0;
      region.srcEndFrac = 1;
    }
    track.regions.push(region);

    // (Re)attach the bar scheduler so new track gets picked up
    attachScheduler();
    renderTrackList();
    rebuildStepGridRows();
    onTrackSelect?.(track);
    onEditorLaneFocus?.("wave", id);
    setStatus(`Loading loop track "${name}"`);

    // Decode audio, then repaint the already-visible lane as soon as the
    // waveform buffer is ready.
    try {
      await decodeTrackAudio(track, file);
      console.log("[loop] addTrack decoded", name, "dur=", track.buffer?.duration?.toFixed(2), "engineCtx?", !!getEngine()?.context);
      renderLane(track.id);
      setStatus(`Added loop track "${name}"`);
    } catch (e) {
      console.warn("Loop track decode failed", e);
      setStatus(`Added loop track "${name}" (waveform decode failed)`);
    }
  }

  async function restoreTracks(savedTracks = []) {
    const tracks = Array.isArray(savedTracks) ? savedTracks : [];
    loopTracks.forEach((track) => {
      if (track.audioUrl?.startsWith?.("blob:")) URL.revokeObjectURL(track.audioUrl);
    });
    loopTracks.length = 0;
    undoStack.length = 0;
    redoStack.length = 0;
    selectedLoopRegion = null;
    activeRegionEdit = null;
    syncRegionPanel();
    const hadLoopSolo = soloTracks.size > 0;
    soloTracks.clear();
    if (hadLoopSolo) syncLoopSoloState();
    activeSources.forEach((source) => {
      try { source.stop(); } catch {}
    });
    activeSources.clear();

    tracks.forEach((saved, index) => {
      if (!saved || typeof saved !== "object") return;
      const hasUrl = typeof saved.url === "string" && saved.url && !saved.url.startsWith("blob:");
      const hasHandle = typeof saved.handleId === "string" && saved.handleId;
      const relinkRequired = Boolean(saved.relinkRequired || saved.source === "local-file");
      if (!hasUrl && !hasHandle && !relinkRequired) return;
      const id = typeof saved.id === "string" && saved.id ? saved.id : `loop_saved_${index}_${Date.now()}`;
      const regions = Array.isArray(saved.regions) && saved.regions.length
        ? saved.regions.map(serializeRegion)
        : [{ bar: 0, len: totalSongBars(), gain: 1, chops: 4, sliceSensitivity: 0.12, mode: "cut" }];
      loopTracks.push({
        id,
        name: typeof saved.name === "string" && saved.name ? saved.name : saved.url?.split("/").pop() || "Loop",
        barsInFile: Math.max(1, Math.round(finiteNumber(saved.barsInFile, 1))),
        source: typeof saved.source === "string" ? saved.source : hasHandle ? "browser-file-handle" : hasUrl ? "bundled-sample" : "local-file",
        audioUrl: hasUrl ? saved.url : null,
        url: hasUrl ? saved.url : null,
        root: typeof saved.root === "string" ? saved.root : null,
        path: typeof saved.path === "string" ? saved.path : null,
        fileName: typeof saved.fileName === "string" ? saved.fileName : null,
        handleId: hasHandle ? saved.handleId : null,
        relinkRequired,
        missing: !hasUrl && !hasHandle,
        buffer: null,
        regions,
        selected: false,
        _rawBytes: null
      });
    });

    renderTrackList();
    rebuildStepGridRows();
    attachScheduler();
    await Promise.all(loopTracks.map(async (track) => {
      const restoreFromSampleFolder = async () => {
        const picked = await reopenSampleFolderFile(track, { requestPermission: false, logFailure: false });
        if (!picked?.file) return false;
        await applyRelinkedTrackFile(track, picked);
        return !track.missing;
      };
      try {
        if (!track.audioUrl && track.handleId) {
          const resolved = await resolveFileHandleSample(track.handleId, { requestPermission: false });
          track.audioUrl = resolved.url;
          track.missing = false;
        }
        if (!track.audioUrl) {
          if (await restoreFromSampleFolder()) return;
          track.missing = true;
          renderLane(track.id);
          return;
        }
        await decodeTrackAudio(track);
        renderLane(track.id);
      } catch (error) {
        if (await restoreFromSampleFolder()) return;
        track.missing = true;
        renderLane(track.id);
        if (!isExpectedSavedHandleMiss(error)) {
          console.warn("Loop track restore decode failed", track.name, error);
        }
      }
    }));
    if (loopTracks.length) setStatus(`Restored ${loopTracks.length} sample track${loopTracks.length === 1 ? "" : "s"}`);
  }

  function removeTrack(id) {
    const idx = loopTracks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const track = loopTracks[idx];
    if (track.audioUrl?.startsWith?.("blob:")) URL.revokeObjectURL(track.audioUrl);
    loopTracks.splice(idx, 1);
    const hadLoopSolo = soloTracks.delete(id);
    if (selectedLoopRegion?.trackId === id) {
      selectedLoopRegion = null;
      syncRegionPanel();
    }
    renderTrackList();
    rebuildStepGridRows();
    if (hadLoopSolo) syncLoopSoloState();
    onTrackRemove?.(track);
    setStatus(`Removed loop track "${track.name}"`);
  }

  function selectRegion(trackId, regionIdx) {
    selectedLoopRegion = { trackId, regionIdx };
    syncRegionPanel();
  }

  function clearRegionMenuTarget() {
    regionMenuTarget = null;
    stepGrid.querySelectorAll(".sample-region--menu-target").forEach((el) => {
      el.classList.remove("sample-region--menu-target");
    });
  }

  function setRegionMenuTarget(trackId, regionIdx) {
    clearRegionMenuTarget();
    regionMenuTarget = { trackId, regionIdx };
    stepGrid.querySelectorAll(".sample-region").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (el.dataset.loopTrack === trackId && Number(el.dataset.regionIdx) === regionIdx) {
        el.classList.add("sample-region--menu-target");
      }
    });
  }

  function audibleRegionSpan(track, region) {
    const start = finiteNumber(region?.bar, 0);
    const len = Math.max(MIN_REGION_BARS, finiteNumber(region?.len, 1));
    let end = start + len;
    const mode = region?.mode === "stretch" ? "stretch" : "cut";
    const barDurationSec = currentBarDurationSec();
    if (mode === "cut" && track?.buffer?.duration > 0 && barDurationSec > 0) {
      const { startFrac, endFrac } = regionSrc(region, track.buffer.duration);
      const sourceBars = ((endFrac - startFrac) * track.buffer.duration) / barDurationSec;
      end = Math.min(end, start + Math.max(MIN_REGION_BARS, sourceBars));
    }
    return { start, end: Math.max(start + MIN_REGION_BARS, end) };
  }

  function wholeWaveformSelectionFractions(track) {
    const bars = Math.max(MIN_REGION_BARS, totalBars());
    const winStart = getActiveBar();
    const spans = (track?.regions || []).map((region) => audibleRegionSpan(track, region));
    const endBar = spans.length
      ? Math.max(...spans.map((span) => span.end))
      : Math.max(MIN_REGION_BARS, finiteNumber(track?.barsInFile, bars));
    const left = clampNumber((0 - winStart) / bars, 0, 1);
    const minRight = Math.min(1, left + MIN_REGION_BARS / bars);
    const right = clampNumber((endBar - winStart) / bars, minRight, 1);
    return { left, right };
  }

  // Enter an interactive edit mode for a region. The lane re-renders with edge
  // handles (and a move grip) wired to the chosen behaviour. Clicking elsewhere
  // / pressing Escape exits the mode. A history snapshot is taken on the first
  // actual drag so undo restores the pre-edit state.
  function beginRegionEdit(track, regionIdx, mode) {
    activeRegionEdit = { trackId: track.id, regionIdx, mode };
    selectRegion(track.id, regionIdx);
    const labels = {
      move: "Move",
      scale: "Scale (time-stretch)",
      reveal: "Reveal unscaled audio",
      "reveal-scaled": "Reveal scaled audio"
    };
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
    // Allow len up to the track's own bar count (uncapped beyond PHRASE_BARS)
    const effectiveMax = Math.max(totalSongBars(), track.barsInFile || 0, 9999);
    const normalized = normalizeRegion({
      bar: startEl?.value, len: lenEl?.value,
      chops: chopsEl?.value, gain: gainEl?.value
    }, effectiveMax);
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

  function showRegionContextMenu(x, y, track, region, regionIdx, totalBarsCount, clickBar = finiteNumber(region.bar, 0)) {
    // Remove any existing menu
    document.querySelector(".loop-region-ctx-menu")?.remove();
    setRegionMenuTarget(track.id, regionIdx);

    const menu = document.createElement("div");
    menu.className = "context-menu loop-region-ctx-menu";

    const addItem = (label, action, disabled = false) => {
      const btn = document.createElement("button");
      btn.className = "context-menu-item";
      btn.textContent = label;
      btn.disabled = disabled;
      btn.addEventListener("click", () => {
        menu.remove();
        clearRegionMenuTarget();
        void action();
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

    if (region.mode === "stretch") {
      // Reveal scaled keeps the current time-stretch ratio and grows the
      // source window with the dragged edge.
      addItem("⤢  Reveal scaled audio", () => {
        beginRegionEdit(track, regionIdx, "reveal-scaled");
      });
      addItem("⤢  Reveal unscaled audio", () => {
        beginRegionEdit(track, regionIdx, "reveal");
      });
    } else {
      // Reveal unscaled pulls back source audio at natural speed.
      addItem("⤢  Reveal cut audio (drag edges)", () => {
        beginRegionEdit(track, regionIdx, "reveal");
      });
    }

    sep();

    addItem("⧉  Copy region as wave edit", () => {
      waveEditClipboard = {
        trackId: track.id,
        trackName: track.name,
        len: Math.max(MIN_REGION_BARS, finiteNumber(region.len, 1)),
        regions: [{
          ...serializeRegion(region),
          bar: 0
        }]
      };
      setStatus(`Copied region from "${track.name}"`);
    });

    addItem("⇣  Paste copied wave edit here", () => {
      pasteWaveEdit(track, clickBar);
    }, !waveEditClipboard || waveEditClipboard.trackId !== track.id);

    addItem("⇢  Copy region to Sample Browser", () => {
      copySelectionToSampleBrowser(track, finiteNumber(region.bar, 0), Math.max(MIN_REGION_BARS, finiteNumber(region.len, 1)));
    }, !addSampleToBrowser || !track.buffer);

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
    positionContextMenu(menu, x, y);

    // Dismiss on outside click
    const dismiss = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        clearRegionMenuTarget();
        document.removeEventListener("mousedown", dismiss);
      }
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

    const addItem = (label, action, disabled = false) => {
      const btn = document.createElement("button");
      btn.className = "context-menu-item";
      btn.textContent = label;
      btn.disabled = disabled;
      btn.addEventListener("click", () => {
        if (disabled) return;
        // Read selection FIRST, before removing the marquee from the DOM
        const sel = getSelection();
        popup.remove();
        marqueeEl.remove();
        marqueeEl.parentElement?.querySelectorAll?.(".lane-marquee")?.forEach?.(el => el.remove());
        document.querySelectorAll(".lane-marquee").forEach(el => el.remove());
        const { startBar, len, leftFrac, rightFrac } = sel;
        void action(startBar, len, leftFrac, rightFrac);
      });
      popup.appendChild(btn);
    };
    const sep = () => { const d = document.createElement("div"); d.className = "context-menu-sep"; popup.appendChild(d); };

    // ── Loop: create a region spanning the selection
    addItem("↺  Loop selection", (startBar, len) => {
      const regions = copiedRegionsForSelection(track, startBar, len);
      const region = {
        ...serializeRegion(regions[0] || {}),
        bar: startBar,
        len: Math.max(MIN_REGION_BARS, len),
        mode: regions[0]?.mode === "stretch" ? "stretch" : "cut"
      };
      pushHistory();
      track.regions.push(region);
      selectRegion(track.id, track.regions.length - 1);
      renderLane(track.id);
    });

    addItem("⧉  Copy selection", (startBar, len) => {
      copyWaveEditSelection(track, startBar, len);
    });

    addItem("⇣  Paste copied wave edit into selection", (startBar, len) => {
      pasteWaveEdit(track, startBar, len);
    }, !waveEditClipboard || waveEditClipboard.trackId !== track.id);

    addItem("⇢  Copy selection to Sample Browser", (startBar, len) => {
      copySelectionToSampleBrowser(track, startBar, len);
    }, !addSampleToBrowser || !track.buffer);

    sep();

    // ── Cut-inverse: keep only the parts of existing regions INSIDE the selection.
    //    Everything outside the marquee is removed.  We map the visual marquee
    //    (timeline-fraction space) into each region's source-buffer window so
    //    the kept audio matches *exactly* what was highlighted on screen.
    addItem("✂  Cut (keep inside selection)", (startBar, len) => {
      const selEnd = startBar + len;
      const dur = track.buffer ? track.buffer.duration : 0;
      pushHistory();
      const next = cutRegionsToSelection(track, startBar, len, dur, currentBarDurationSec());
      setStatus(`Cut: kept ${next.length} region(s) from bar ${formatBars(startBar)}-${formatBars(selEnd)}`);
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
      const songBars = totalSongBars();
      const endBar = Math.min(songBars, startBar + len);
      const clampedLen = Math.max(MIN_REGION_BARS, endBar - startBar);

      let applied = false;
      pushHistory();
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
    positionContextMenu(popup, x, y);

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

    const minWidthFrac = () => {
      const rect = lane.getBoundingClientRect();
      const minPixels = 6 / Math.max(1, rect.width || lane.offsetWidth || 1);
      const q = getQuantize();
      if (q.enabled && q.value > 0) return Math.min(1, q.value / Math.max(1, totalBars()));
      return Math.min(1, minPixels);
    };

    /**
     * Return current selection as fractional bar positions. Actions that need
     * bar snapping do it explicitly; cut uses these exact values.
     */
    const getSelection = () => {
      const bars = totalBars();
      const winStart = getActiveBar();
      const songBars = totalSongBars();
      const startBar = clampNumber(winStart + left * bars, 0, songBars);
      const endBar = clampNumber(winStart + right * bars, 0, songBars);
      const len = Math.max(MIN_REGION_BARS, endBar - startBar);
      return { startBar, endBar, len, leftFrac: left, rightFrac: right };
    };

    // ── Left edge handle
    const leftHandle = document.createElement("div");
    leftHandle.className = "lane-marquee-handle lane-marquee-handle--left";
    leftHandle.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      const startX = e.clientX;
      const startLeft = left;
      const onMove = (me) => {
        const rect = lane.getBoundingClientRect();
        const raw = Math.max(0, Math.min(right - minWidthFrac(), startLeft + (me.clientX - startX) / rect.width));
        left = snapFrac(raw, totalBars());
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
      const onMove = (me) => {
        const rect = lane.getBoundingClientRect();
        const raw = Math.min(1, Math.max(left + minWidthFrac(), startRight + (me.clientX - startX) / rect.width));
        right = snapFrac(raw, totalBars());
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
    const renderTrackItem = (track) => {
      const item = document.createElement("div");
      item.className = `loop-track-item${track.selected ? " is-selected" : ""}${track.missing ? " loop-track-item--missing" : ""}`;
      item.dataset.loopTrackId = track.id;
      const name = document.createElement("span");
      name.className = "loop-track-item-name";
      name.textContent = `${track.name} (${track.barsInFile} bars)${track.missing ? " · relink" : ""}`;
      name.title = track.missing ? `Double-click to relink "${track.name}"` : `${track.name} (${track.barsInFile} bars)`;
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
      item.addEventListener("dblclick", (event) => {
        if (!track.missing) return;
        event.preventDefault();
        event.stopPropagation();
        void relinkTrack(track.id);
      });
      list.appendChild(item);
    };
    loopTracks.forEach(renderTrackItem);
  }

  /** Paint a single lane's region blocks + waveform snippets on top of the ruler canvas. */
  function renderLane(trackId) {
    const lane = stepGrid.querySelector(`.sample-lane[data-loop-track="${trackId}"]`);
    if (!lane) return;
    const track = trackById(trackId);
    if (!track) return;
    // Visible window: how many bars are shown in the drum grid right now.
    const bars = totalBars();          // segmentsCount (e.g. 2)
    const winStart = getActiveBar();   // first visible phrase-bar (e.g. 8)
    const winEnd   = winStart + bars;  // last+1 visible phrase-bar (e.g. 10)

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
      // Clip region to the visible window.
      const rStart = region.bar;
      const rEnd   = region.bar + region.len;
      const mode = region.mode === "stretch" ? "stretch" : "cut";
      const barDurationSec = currentBarDurationSec();
      let displayStart = rStart;
      let displayEnd = rEnd;
      if (mode === "cut" && track.buffer?.duration > 0 && barDurationSec > 0) {
        const { startFrac, endFrac } = regionSrc(region, track.buffer.duration);
        const sourceBars = ((endFrac - startFrac) * track.buffer.duration) / barDurationSec;
        displayEnd = Math.min(rEnd, rStart + Math.max(MIN_REGION_BARS, sourceBars));
      }
      if (displayEnd <= winStart || displayStart >= winEnd) return; // fully outside window

      // Window-local start/end (clamped to visible range).
      const visStart = Math.max(displayStart, winStart) - winStart;
      const visEnd   = Math.min(displayEnd,   winEnd)   - winStart;
      const visLen   = visEnd - visStart;

      const el = document.createElement("div");
      el.className = "sample-region";
      el.dataset.loopTrack = track.id;
      el.dataset.regionIdx = String(regionIdx);
      if (regionMenuTarget?.trackId === track.id && regionMenuTarget.regionIdx === regionIdx) {
        el.classList.add("sample-region--menu-target");
      }
      if (track.missing) el.classList.add("sample-region--missing");
      if (region.revealPreview) el.classList.add("sample-region--reveal-preview");
      el.title = track.missing
        ? `Double-click to relink "${track.name}"`
        : `${track.name} · ${region.mode === "stretch" ? "stretched" : "cut"} · bar ${formatBars(region.bar + 1)} · ${formatBars(region.len)} bars`;
      el.style.left  = `${(visStart / bars) * 100}%`;
      el.style.width = `${(visLen   / bars) * 100}%`;

      const visibleSliceStartBar = Math.max(displayStart, winStart);
      const visibleSliceEndBar = Math.min(displayEnd, winEnd);

      // Waveform canvas inside the region
      const waveCanvas = document.createElement("canvas");
      waveCanvas.className = "sample-region-wave";
      // We'll size it after append via rAF.
      el.appendChild(waveCanvas);

      // Resize handle
      const resizeHandle = document.createElement("div");
      resizeHandle.className = "sample-region-resize";
      resizeHandle.title = "Drag to resize";
      el.appendChild(resizeHandle);

      // After DOM paint, draw waveform at correct section.
      // Paint once at the next frame, then again one frame later in case this is
      // the first layout pass after loading a sample lane.
      const predictedW = Math.max(4, Math.round(laneWidth * visLen / bars));
      const paintWave = () => {
        const rectW = el.getBoundingClientRect().width;
        const elW = Math.max(4, Math.round(rectW || el.offsetWidth || predictedW));
        waveCanvas.width = elW;
        waveCanvas.height = LANE_H;
        if (track.missing) {
          drawWaveform(waveCanvas, null);
          const ctx = waveCanvas.getContext("2d");
          if (ctx) {
            ctx.fillStyle = "rgba(150, 168, 190, 0.8)";
            ctx.font = "11px ui-sans-serif, system-ui";
            ctx.fillText("relink sample", 10, 36);
          }
        } else if (track.buffer) {
          if (visibleSliceEndBar <= visibleSliceStartBar + BAR_EPSILON) {
            drawWaveform(waveCanvas, null);
            return;
          }
          const { startFrac: visStartFrac, endFrac: visEndFrac } = regionSourceSlice(
            region,
            track,
            visibleSliceStartBar,
            visibleSliceEndBar,
            track.buffer.duration,
            currentBarDurationSec()
          );
          drawWaveform(
            waveCanvas,
            track.buffer,
            visStartFrac,
            visEndFrac,
            region.revealPreview ? "#6ec7ff" : "#5b9bd5",
            true,
            0,
            elW
          );
        }
      };
      requestAnimationFrame(() => {
        paintWave();
        requestAnimationFrame(paintWave);
      });

      // Live waveform repaint — called during drag so the wave updates in real-time.
      const repaintWave = () => {
        paintWave();
      };

      // Drag the right edge to resize the region
      resizeHandle.addEventListener("mousedown", (e) => {
        e.stopPropagation(); // don't start a marquee when dragging the resize handle
        const startX = e.clientX;
        const startLen = region.len;
        const onMove = (me) => {
          const dx = me.clientX - startX;
          // Allow resize beyond PHRASE_BARS — long samples need long regions
          const maxLen = Math.max(totalSongBars(), track.barsInFile || 0, 9999);
          region.len = clampRegionLen(startLen + pixelsToBars(dx, pxPerBar), region.bar, maxLen);
          renderLane(trackId);
          syncRegionPanel();
        };
        const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      // Click selects the region; drag still bubbles to the lane marquee handler.
      el.addEventListener("click", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        selectRegion(trackId, regionIdx);
      });
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectRegion(trackId, regionIdx);
        showRegionContextMenu(e.clientX, e.clientY, track, region, regionIdx, bars, barFromLaneClientX(lane, e.clientX, bars));
      });
      el.addEventListener("dblclick", (e) => {
        if (!track.missing) return;
        e.preventDefault();
        e.stopPropagation();
        void relinkTrack(track.id);
      });

      // ── Interactive edit mode (Move / Scale / Reveal) ──────────────────────
      if (activeRegionEdit && activeRegionEdit.trackId === track.id && activeRegionEdit.regionIdx === regionIdx) {
        const mode = activeRegionEdit.mode;
        const editClass = mode === "reveal-scaled"
          ? "sample-region--edit-reveal"
          : mode === "reveal" && region.mode === "stretch"
            ? "sample-region--edit-reveal-unscaled"
            : `sample-region--edit-${mode}`;
        el.classList.add("sample-region--editing", editClass);
        const isRevealMode = mode === "reveal" || mode === "reveal-scaled";

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
            const bufferDuration = track.buffer ? track.buffer.duration : 0;
            const naturalSrcPerBar = bufferDuration > 0
              ? currentBarDurationSec() / bufferDuration
              : (startLen > 0 ? (startSrcEnd - startSrcStart) / startLen : 0);
            const scaledSrcPerBar = startLen > 0
              ? (startSrcEnd - startSrcStart) / startLen
              : naturalSrcPerBar;
            const revealSrcPerBar = mode === "reveal-scaled" ? scaledSrcPerBar : naturalSrcPerBar;
            const splitUnscaledReveal = mode === "reveal" && region.mode === "stretch";
            let splitRevealRegion = null;
            const removeSplitRevealRegion = () => {
              if (!splitRevealRegion) return;
              const idx = track.regions.indexOf(splitRevealRegion);
              if (idx >= 0) track.regions.splice(idx, 1);
              splitRevealRegion = null;
            };
            const upsertSplitRevealRegion = (side, revealLen) => {
              const next = makeUnscaledRevealRegion(
                region,
                side,
                revealLen,
                bufferDuration,
                currentBarDurationSec()
              );
              if (!next) {
                removeSplitRevealRegion();
                return;
              }
              if (!splitRevealRegion) {
                splitRevealRegion = next;
                track.regions.push(splitRevealRegion);
              } else {
                Object.assign(splitRevealRegion, next);
              }
            };
            let snapped = false;
            let autoScrollBars = 0;
            const autoScrollState = { lastAt: 0 };
            let liveRenderQueued = false;
            const queueLiveRender = () => {
              if (liveRenderQueued) return;
              liveRenderQueued = true;
              requestAnimationFrame(() => {
                liveRenderQueued = false;
                renderLane(track.id);
              });
            };
            const renderSplitRevealPreview = () => {
              liveRenderQueued = false;
              renderLane(track.id);
            };

            const onMove = (me) => {
              if (!snapped) { startDrag(true); snapped = true; }
              const songBars = totalSongBars();
              autoScrollBars += maybeAutoNavigateDrag(me.clientX, track.id, autoScrollState);
              const liveLane = stepGrid.querySelector(`.sample-lane[data-loop-track="${track.id}"]`) ?? lane;
              const liveRect = liveLane.getBoundingClientRect();
              const liveWidth = liveRect.width || rect.width || 1;
              // Use visible bars for drag scale (1:1 feel within the window).
              const deltaPx = me.clientX - startX;
              const deltaBars = autoScrollBars + deltaPx * bars / liveWidth;

              if (splitUnscaledReveal) {
                if (which === "right") {
                  const rawEndBar = startBar + startLen + deltaBars;
                  const snappedEndBar = snapQ(rawEndBar);
                  const maxRevealLen = naturalSrcPerBar > 0
                    ? Math.min(songBars - startBar - startLen, (1 - startSrcEnd) / naturalSrcPerBar)
                    : 0;
                  const revealLen = clampNumber(snappedEndBar - startBar - startLen, 0, Math.max(0, maxRevealLen));
                  upsertSplitRevealRegion("right", revealLen);
                } else {
                  const rawNewBar = startBar + deltaBars;
                  const minRevealBar = naturalSrcPerBar > 0
                    ? Math.max(0, startBar - startSrcStart / naturalSrcPerBar)
                    : startBar;
                  const snappedBar = snapQ(rawNewBar);
                  const revealLen = clampNumber(startBar - snappedBar, 0, Math.max(0, startBar - minRevealBar));
                  upsertSplitRevealRegion("left", revealLen);
                }
                region.bar = startBar;
                region.len = startLen;
                region.srcStartFrac = startSrcStart;
                region.srcEndFrac = startSrcEnd;
                region.mode = "stretch";
                region.sampleOffset = undefined;
                renderSplitRevealPreview();
                return;
              }

              if (which === "right") {
                const rawEndBar = startBar + startLen + deltaBars;
                const snappedEndBar = snapQ(rawEndBar);
                const maxRevealLen = isRevealMode && revealSrcPerBar > 0
                  ? Math.min(songBars - startBar, startLen + (1 - startSrcEnd) / revealSrcPerBar)
                  : songBars - startBar;
                const newLen = clampNumber(snappedEndBar - startBar, MIN_REGION_BARS, maxRevealLen);
                region.len = newLen;
                if (isRevealMode) {
                  const addedBars = newLen - startLen;
                  region.srcStartFrac = startSrcStart;
                  region.srcEndFrac = Math.max(startSrcStart + 1e-4, Math.min(1, startSrcEnd + addedBars * revealSrcPerBar));
                  region.mode = mode === "reveal-scaled" ? "stretch" : "cut";
                } else if (mode === "scale") {
                  region.srcStartFrac = startSrcStart;
                  region.srcEndFrac = startSrcEnd;
                  region.mode = "stretch";
                }
                region.sampleOffset = undefined;
              } else { // left edge
                const rawNewBar = startBar + deltaBars;
                const minRevealBar = isRevealMode && revealSrcPerBar > 0
                  ? Math.max(0, startBar - startSrcStart / revealSrcPerBar)
                  : 0;
                const newBar = clampNumber(snapQ(rawNewBar), minRevealBar, startBar + startLen - MIN_REGION_BARS);
                const newLen = startLen + (startBar - newBar);
                region.bar = newBar;
                region.len = Math.max(MIN_REGION_BARS, newLen);
                if (isRevealMode) {
                  const shift = (newBar - startBar) * revealSrcPerBar;
                  region.srcStartFrac = Math.max(0, Math.min(startSrcEnd - 1e-4, startSrcStart + shift));
                  region.srcEndFrac = startSrcEnd;
                  region.mode = mode === "reveal-scaled" ? "stretch" : "cut";
                } else if (mode === "scale") {
                  region.srcStartFrac = startSrcStart;
                  region.srcEndFrac = startSrcEnd;
                  region.mode = "stretch";
                }
                region.sampleOffset = undefined;
              }
              // Update position CSS live (window-relative), then repaint waveform
              if (el.isConnected) {
                applyRegionElementWindowStyle(el, region, bars);
                repaintWave();
              } else {
                queueLiveRender();
              }
            };
            const onUp = () => {
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
              if (splitRevealRegion) delete splitRevealRegion.revealPreview;
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
            let autoScrollBars = 0;
            const autoScrollState = { lastAt: 0 };
            let liveRenderQueued = false;
            const queueLiveRender = () => {
              if (liveRenderQueued) return;
              liveRenderQueued = true;
              requestAnimationFrame(() => {
                liveRenderQueued = false;
                renderLane(track.id);
              });
            };
            const onMove = (me) => {
              if (!snapped) { startDrag(true); snapped = true; }
              const songBars = totalSongBars();
              autoScrollBars += maybeAutoNavigateDrag(me.clientX, track.id, autoScrollState);
              const liveLane = stepGrid.querySelector(`.sample-lane[data-loop-track="${track.id}"]`) ?? lane;
              const liveRect = liveLane.getBoundingClientRect();
              const liveWidth = liveRect.width || rect.width || 1;
              // Use visible bars for drag scale (1:1 feel within the window).
              const rawNewBar = startBar + autoScrollBars + (me.clientX - startX) * bars / liveWidth;
              region.bar = clampNumber(snapQ(rawNewBar), 0, Math.max(0, songBars - region.len));
              // Move CSS live (window-relative); no DOM rebuild during drag.
              if (el.isConnected) {
                applyRegionElementWindowStyle(el, region, bars);
              } else {
                queueLiveRender();
              }
            };
            const onUp = () => {
              el.style.cursor = "grab";
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
              // If the region moved outside the visible window, scroll the view to it
              const wb = getActiveBar();
              if (region.bar < wb || region.bar >= wb + totalBars()) {
                if (onNavigate) { onNavigate(region.bar); return; }
              }
              renderLane(track.id);
              syncRegionPanel();
              setStatus(`Region moved to bar ${formatBars(region.bar + 1)}`);
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
    if (!shouldShowWaveLanes()) {
      syncStepGridLaneRows(stepGrid);
      return;
    }

    const gridTrackRows = stepGrid.querySelectorAll(".track-label[data-hit]:not(.piano-roll-lane-label):not(.sample-lane-label)").length;
    const startRow = gridTrackRows + 2;

    loopTracks.forEach((track, index) => {
      const gridRow = String(editorLaneGridRow?.("wave", track.id, index, gridTrackRows) ?? (startRow + index));
      // Label cell (first grid column)
      const label = document.createElement("div");
      label.className = "track-label sample-lane-label";
      label.dataset.loopTrackId = track.id;
      label.dataset.hit = track.id;
      label.dataset.laneKey = `wave:${track.id}`;
      label.style.gridColumn = "1";
      label.style.gridRow = gridRow;
      label.style.height = `${LANE_H}px`;
      label.style.minHeight = `${LANE_H}px`;
      label.title = `Select ${track.name}`;
      label.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        if (event.target?.closest?.(".track-row-control")) return;
        event.preventDefault();
        onTrackSelect?.(track);
      });
      label.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onTrackSelect?.(track);
        if (showContextMenu) {
          showContextMenu(event, [
            {
              label: `Move ${track.name}`,
              action: () => moveTrackLane?.("wave", track.id, track.name)
            },
            { separator: true },
            {
              label: `Delete ${track.name}`,
              action: () => removeTrack(track.id)
            }
          ]);
        } else {
          moveTrackLane?.("wave", track.id, track.name);
        }
      });

      const span = document.createElement("span");
      span.textContent = track.name;

      const trackStateButtons = document.createElement("div");
      trackStateButtons.className = "track-state-buttons";

      const soloBtn = document.createElement("button");
      soloBtn.type = "button";
      soloBtn.className = `solo-button track-row-control${soloTracks.has(track.id) ? " is-active" : ""}`;
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
        syncLoopSoloState();
        setStatus(active ? `Solo loop: ${track.name}` : "Loop solo cleared");
      });

      const muteBtn = document.createElement("button");
      muteBtn.type = "button";
      muteBtn.className = `mute-button track-row-control${isTrackMuted(track.id) ? " is-active" : ""}`;
      muteBtn.dataset.muteTrack = track.id;
      muteBtn.textContent = "M";
      muteBtn.title = `Mute "${track.name}"`;
      muteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleMute?.(track.id);
      });

      trackStateButtons.append(soloBtn, muteBtn);
      label.append(span, trackStateButtons);

      // The timeline lane (spans all step columns)
      const lane = document.createElement("div");
      lane.className = "sample-lane";
      lane.dataset.loopTrack = track.id;
      lane.style.gridColumn = "2 / -1";
      lane.style.gridRow = gridRow;
      lane.style.height = `${LANE_H}px`;
      lane.style.minHeight = `${LANE_H}px`;

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
        // Skip if clicking the marquee itself (handles are inside it)
        if ((e.target instanceof Element) && e.target.closest(".lane-marquee")) return;

        // Prevent the browser from drawing its native blue text-selection box
        e.preventDefault();

        // Re-fetch the bounding rect on every event so scroll offsets stay correct.
        const getLaneRect = () => lane.getBoundingClientRect();
        const laneRect0 = getLaneRect();
        const startFrac = snapFrac(Math.max(0, Math.min(1, (e.clientX - laneRect0.left) / laneRect0.width)), totalBars());

        // Marquee element — only added to DOM once actual dragging begins (avoids
        // the brief flash that was visible on a plain click with no drag).
        let marquee = null;

        let curFrac = startFrac;
        let dragged = false;

        const onMove = (me) => {
          const r = getLaneRect();
          const rawFrac = Math.max(0, Math.min(1, (me.clientX - r.left) / r.width));
          curFrac = snapFrac(rawFrac, totalBars());
          const left  = Math.min(startFrac, curFrac);
          const width = Math.abs(curFrac - startFrac);
          if (width * r.width > 4) {
            dragged = true;
            // Create and attach the marquee the first time we cross the threshold
            if (!marquee) {
              marquee = document.createElement("div");
              marquee.className = "lane-marquee lane-marquee--drawing";
              lane.appendChild(marquee);
            }
            marquee.style.left  = `${left  * 100}%`;
            marquee.style.width = `${width * 100}%`;
          }
        };

        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          marquee?.remove();

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
            clearRegionMenuTarget();
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
        const clickBar = barFromLaneClientX(lane, e.clientX, bars);

        addItem("⬛  Select entire loop", () => {
          const { left, right } = wholeWaveformSelectionFractions(track);
          makePersistentMarquee(lane, track, left, right);
        });

        sep();

        addItem("↺  Loop entire file here", () => {
          pushHistory();
          track.regions.push({
            bar: clickBar,
            len: Math.max(MIN_REGION_BARS, totalSongBars() - clickBar),
            gain: 1,
            chops: 4,
            sliceSensitivity: 0.12,
            mode: "cut"
          });
          selectRegion(track.id, track.regions.length - 1);
          renderLane(track.id);
        });

        addItem("⇣  Paste copied wave edit here", () => {
          pasteWaveEdit(track, clickBar);
        }, !waveEditClipboard || waveEditClipboard.trackId !== track.id);

        addItem("⇢  Copy copied wave edit to Sample Browser", () => {
          copyClipboardToSampleBrowser();
        }, !waveEditClipboard || !addSampleToBrowser);

        if (track.regions.length > 0) {
          sep();
          addItem("🗑  Delete all regions", () => {
            pushHistory();
            track.regions.length = 0;
            selectedLoopRegion = null;
            syncRegionPanel();
            renderLane(track.id);
          });
        }

        document.body.appendChild(menu);
        positionContextMenu(menu, e.clientX, e.clientY);
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
    syncStepGridLaneRows(stepGrid);
  }

  return {
    addTrack,
    removeTrack,
    updateSelectedRegion,
    deleteSelectedRegion,
    rebuildStepGridRows,
    renderAllLanes: () => loopTracks.forEach((t) => renderLane(t.id)),
    renderTrackList,
    attachScheduler,
    detachScheduler,
    undo,
    redo,
    soloTracks,
    hasActiveSolo: () => soloTracks.size > 0,
    serializeTracks,
    restoreTracks,
    relinkMissingFromSampleFolder,
    _tracks: loopTracks
  };
}
