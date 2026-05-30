// ════════════════════════════════════════════════════════════════════════
// Global Mix spectrum + mastering-curve widget.
//
// Draws a live spectrum analyser and an interactive multi-band "mastering
// curve" on a single canvas. Each EQ band is a draggable node positioned on
// the log-frequency axis; dragging vertically changes its gain (dB) and calls
// back into the engine so you can emphasise key Hz ranges like a mastering
// engineer. Pure view layer — it owns no audio, only reads an analyser and
// reports band-gain changes through callbacks.
// ════════════════════════════════════════════════════════════════════════

import {
  MASTER_EQ_BANDS,
  MASTER_EQ_GAIN_MIN,
  MASTER_EQ_GAIN_MAX
} from "../audio/rhythm-mastering.js";

const MIN_HZ = 20;
const MAX_HZ = 20000;
const logHz = (hz) => Math.log10(Math.max(MIN_HZ, Math.min(MAX_HZ, hz)));
const LOG_MIN = logHz(MIN_HZ);
const LOG_MAX = logHz(MAX_HZ);

/** Map a frequency (Hz) to a normalized 0..1 x position on the log axis. */
const hzToNorm = (hz) => (logHz(hz) - LOG_MIN) / (LOG_MAX - LOG_MIN);
/** Map a gain (dB) to a normalized 0..1 y position (0 = top/max gain). */
const gainToNorm = (db) =>
  1 - (db - MASTER_EQ_GAIN_MIN) / (MASTER_EQ_GAIN_MAX - MASTER_EQ_GAIN_MIN);
/** Inverse of gainToNorm: a 0..1 y position back to a clamped gain (dB). */
const normToGain = (norm) => {
  const db = MASTER_EQ_GAIN_MIN + (1 - norm) * (MASTER_EQ_GAIN_MAX - MASTER_EQ_GAIN_MIN);
  return Math.max(MASTER_EQ_GAIN_MIN, Math.min(MASTER_EQ_GAIN_MAX, db));
};

const HZ_GRID = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

export class GlobalMixSpectrum {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{
   *   getAnalyserData: () => Uint8Array | null,
   *   getNyquist: () => number,
   *   getEq: () => Record<string, number>,
   *   onBandChange: (bandId: string, gainDb: number) => void,
   *   onBandCommit?: (bandId: string, gainDb: number) => void
   * }} hooks
   */
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.hooks = hooks;
    this.running = false;
    this.rafId = null;
    this.dragBandId = null;
    this.hoverBandId = null;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onDoubleClick = this._onDoubleClick.bind(this);
    this._frame = this._frame.bind(this);

    canvas.addEventListener("pointerdown", this._onPointerDown);
    canvas.addEventListener("pointermove", this._onPointerMove);
    canvas.addEventListener("dblclick", this._onDoubleClick);
    window.addEventListener("pointerup", this._onPointerUp);
  }

  /** Size the backing store to the element's CSS box (call when shown/resized). */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    this.rafId = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  dispose() {
    this.stop();
    this.canvas.removeEventListener("pointerdown", this._onPointerDown);
    this.canvas.removeEventListener("pointermove", this._onPointerMove);
    this.canvas.removeEventListener("dblclick", this._onDoubleClick);
    window.removeEventListener("pointerup", this._onPointerUp);
  }

  // ── Pointer interaction ────────────────────────────────────────────────

  _bandNodePositions() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const eq = this.hooks.getEq() || {};
    return MASTER_EQ_BANDS.map((band) => ({
      id: band.id,
      label: band.label,
      x: hzToNorm(band.frequency) * w,
      y: gainToNorm(eq[band.id] ?? 0) * h
    }));
  }

  _hitTest(px, py) {
    const nodes = this._bandNodePositions();
    const radius = 22 * this.dpr;
    let best = null;
    let bestDist = radius * radius;
    for (const node of nodes) {
      const dx = node.x - px;
      const dy = node.y - py;
      const dist = dx * dx + dy * dy;
      if (dist <= bestDist) { bestDist = dist; best = node.id; }
    }
    return best;
  }

  _canvasPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * this.dpr,
      y: (event.clientY - rect.top) * this.dpr
    };
  }

  _onPointerDown(event) {
    const { x, y } = this._canvasPoint(event);
    const bandId = this._hitTest(x, y);
    if (!bandId) return;
    this.dragBandId = bandId;
    this.canvas.setPointerCapture?.(event.pointerId);
    this._applyDrag(y);
    event.preventDefault();
  }

  _onPointerMove(event) {
    const { x, y } = this._canvasPoint(event);
    if (this.dragBandId) {
      this._applyDrag(y);
    } else {
      const hit = this._hitTest(x, y);
      if (hit !== this.hoverBandId) {
        this.hoverBandId = hit;
        this.canvas.style.cursor = hit ? "ns-resize" : "crosshair";
      }
    }
  }

  _onPointerUp() {
    if (this.dragBandId) {
      const eq = this.hooks.getEq() || {};
      this.hooks.onBandCommit?.(this.dragBandId, eq[this.dragBandId] ?? 0);
      this.dragBandId = null;
    }
  }

  /** Double-click a node to reset that band to 0 dB (flat). */
  _onDoubleClick(event) {
    const { x, y } = this._canvasPoint(event);
    const bandId = this._hitTest(x, y);
    if (!bandId) return;
    this.hooks.onBandChange(bandId, 0);
    this.hooks.onBandCommit?.(bandId, 0);
    event.preventDefault();
  }

  _applyDrag(py) {
    const norm = Math.max(0, Math.min(1, py / this.canvas.height));
    const gain = normToGain(norm);
    this.hooks.onBandChange(this.dragBandId, gain);
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  _frame() {
    if (!this.running) return;
    this._draw();
    this.rafId = requestAnimationFrame(this._frame);
  }

  _draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);

    // Background.
    ctx.fillStyle = "#0c0f14";
    ctx.fillRect(0, 0, w, h);

    this._drawGrid(ctx, w, h);
    this._drawSpectrum(ctx, w, h);
    this._drawCurve(ctx, w, h);
    this._drawNodes(ctx, w, h);
  }

  _drawGrid(ctx, w, h) {
    ctx.save();
    ctx.font = `${11 * this.dpr}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "#3a4453";
    ctx.strokeStyle = "rgba(120, 215, 186, 0.08)";
    ctx.lineWidth = 1;
    HZ_GRID.forEach((hz) => {
      const x = hzToNorm(hz) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      const label = hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
      ctx.fillText(label, x + 3 * this.dpr, h - 3 * this.dpr);
    });
    // 0 dB centre line.
    const midY = gainToNorm(0) * h;
    ctx.strokeStyle = "rgba(226, 207, 118, 0.25)";
    ctx.setLineDash([4 * this.dpr, 4 * this.dpr]);
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawSpectrum(ctx, w, h) {
    const data = this.hooks.getAnalyserData?.();
    if (!data || !data.length) return;
    const nyquist = this.hooks.getNyquist?.() || 22050;
    const binHz = nyquist / data.length;

    ctx.save();
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, "rgba(120, 215, 186, 0.85)");
    gradient.addColorStop(0.6, "rgba(120, 215, 186, 0.35)");
    gradient.addColorStop(1, "rgba(120, 215, 186, 0.05)");
    ctx.fillStyle = gradient;

    ctx.beginPath();
    ctx.moveTo(0, h);
    let started = false;
    for (let i = 1; i < data.length; i += 1) {
      const hz = i * binHz;
      if (hz < MIN_HZ) continue;
      if (hz > MAX_HZ) break;
      const x = hzToNorm(hz) * w;
      const mag = data[i] / 255; // 0..1
      const y = h - mag * h;
      if (!started) { ctx.lineTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawCurve(ctx, w, h) {
    const nodes = this._bandNodePositions();
    if (!nodes.length) return;
    ctx.save();
    ctx.strokeStyle = "#e2cf76";
    ctx.lineWidth = 2 * this.dpr;
    ctx.beginPath();
    // Anchor at the left edge using the first node's height.
    ctx.moveTo(0, nodes[0].y);
    nodes.forEach((node, i) => {
      if (i === 0) { ctx.lineTo(node.x, node.y); return; }
      const prev = nodes[i - 1];
      const cx = (prev.x + node.x) / 2;
      ctx.bezierCurveTo(cx, prev.y, cx, node.y, node.x, node.y);
    });
    ctx.lineTo(w, nodes[nodes.length - 1].y);
    ctx.stroke();
    ctx.restore();
  }

  _drawNodes(ctx, w, h) {
    const nodes = this._bandNodePositions();
    const eq = this.hooks.getEq() || {};
    ctx.save();
    ctx.font = `${11 * this.dpr}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    nodes.forEach((node) => {
      const active = node.id === this.dragBandId || node.id === this.hoverBandId;
      const r = (active ? 9 : 6) * this.dpr;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = active ? "#fff0b8" : "#e2cf76";
      ctx.fill();
      ctx.lineWidth = 2 * this.dpr;
      ctx.strokeStyle = "#0c0f14";
      ctx.stroke();

      const db = eq[node.id] ?? 0;
      ctx.fillStyle = "#cdd6e0";
      ctx.textBaseline = "bottom";
      ctx.fillText(node.label, node.x, node.y - 12 * this.dpr);
      ctx.fillStyle = active ? "#fff0b8" : "#8693a6";
      ctx.textBaseline = "top";
      ctx.fillText(`${db > 0 ? "+" : ""}${db.toFixed(1)}dB`, node.x, node.y + 12 * this.dpr);
    });
    ctx.restore();
  }
}
