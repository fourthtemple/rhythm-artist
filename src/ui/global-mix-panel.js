// Mixer overlay controller.
//
// Owns the full-screen "Mixer" view: a live spectrum/mastering-EQ widget
// plus one mixer strip per grid track (Level / Pan / Echo / Reverb sends and an
// optional compact 808-shape readout). It reaches the rest of the app only
// through injected dependencies, so it has no direct reference to the editor's
// module-level `state`.
//
// Usage:
//   const mixPanel = createGlobalMixPanel({ $, getEngine, getConfig, ... });
//   mixPanel.open();   // wired to the "Open Mix" button
//   mixPanel.close();  // wired to the close button + Escape
//   mixPanel.reset();  // wired to the "Flatten EQ" button
import { GlobalMixSpectrum } from "./global-mix-spectrum.js";
import { MASTER_EQ_BANDS } from "../audio/rhythm-mastering.js";

/**
 * Group-level bus controls shown inline in each mixer group heading.
 * Each entry maps a group id to an array of sliders that write directly
 * to `config` keys via `applyConfig`. Kept here so adding a new group
 * trim is a one-line change in one place.
 */
const GROUP_BUS_CONTROLS = {
  core: [
    { label: "Bus",  key: "drumBusGain",  min: 0,   max: 1.2, step: 0.01 },
    { label: "Cap",  key: "drumGainCap",  min: 0.1, max: 1,   step: 0.01 },
    { label: "Lift", key: "drumLift",     min: 0.2, max: 1.2, step: 0.01 }
  ],
  synth: [
    { label: "Level", key: "synthLevel", min: 0, max: 3, step: 0.01 }
  ],
  eightOhEight: [
    { label: "Level", key: "eightOhEightLevel", min: 0,   max: 2,  step: 0.01 },
    { label: "Tune",  key: "eightOhEightTune",  min: -12, max: 12, step: 1    }
  ],
  fx: [
    { label: "FX Send",   key: "fxSendBase",        min: 0, max: 1,   step: 0.01 },
    { label: "Feedback",  key: "delayFeedbackBase",  min: 0, max: 0.8, step: 0.01 },
    { label: "Echo Wet",  key: "echoWetBase",        min: 0, max: 1,   step: 0.01 },
    { label: "Verb Wet",  key: "reverbWetBase",      min: 0, max: 1,   step: 0.01 },
    { label: "Dub Throw", key: "dubThrowAmount",     min: 0, max: 1.2, step: 0.01 },
    { label: "Auto Echo", key: "autoEchoEnabled",    min: 0, max: 1,   step: 1    },
    { label: "Echo Amt",  key: "autoEchoAmount",     min: 0, max: 1,   step: 0.01 },
    { label: "Duck Dub",  key: "duckWhaleAmount",    min: 0, max: 1.5, step: 0.01 },
    { label: "Hit Depth", key: "hitImpactAmount",    min: 0, max: 1.5, step: 0.01 }
  ]
};

/**
 * @param {object} deps
 * @param {(sel: string) => Element|null} deps.$ DOM query helper.
 * @param {() => any} deps.getEngine Returns the current RhythmEngine (may be replaced on restart).
 * @param {() => any} deps.getConfig Returns the live editor config object.
 * @param {() => void} deps.applyConfig Normalize + re-emit JSON + push to engine.
 * @param {(msg: string) => void} deps.setStatus Status-line setter.
 * @param {number} [deps.clampValue] (unused placeholder)
 * @param {(value: any, min: number, max: number, fallback: number) => number} deps.clamp
 * @param {(value: number) => string} deps.formatPan
 * @param {Array<{id: string, label: string, accent?: string}>} deps.trackGroups
 * @param {(id: string) => any} deps.getTrackDef
 * @param {(id: string) => boolean} deps.isInstanceId
 * @param {(id: string) => string} deps.instanceLabel
 * @param {() => string[]} deps.getGridTrackIds
 * @param {object} deps.mix Per-track mix getters/setters keyed by track id.
 * @param {(hit: string) => number} deps.mix.getLevel
 * @param {(hit: string, v: number) => void} deps.mix.setLevel
 * @param {(hit: string) => number} deps.mix.getPan
 * @param {(hit: string, v: number) => void} deps.mix.setPan
 * @param {(hit: string) => number} deps.mix.getBusSend
 * @param {(hit: string, v: number) => void} deps.mix.setBusSend
 * @param {(hit: string) => number} deps.mix.getReverbSend
 * @param {(hit: string, v: number) => void} deps.mix.setReverbSend
 * @param {(hit: string) => boolean} deps.trackSupportsShape
 * @param {(hit: string, container: Element) => void} deps.renderTrackShapeControls
 * @param {(hit: string) => void} deps.onInspect Focus a track in the sequencer inspector.
 */
export function createGlobalMixPanel({
  $,
  getEngine,
  getConfig,
  applyConfig,
  setStatus,
  clamp,
  formatPan,
  trackGroups,
  getTrackDef,
  isInstanceId,
  instanceLabel,
  getGridTrackIds,
  mix,
  trackSupportsShape,
  renderTrackShapeControls,
  onInspect
}) {
  /** Live spectrum + mastering-curve widget; lazily created on first open. */
  let globalMixSpectrum = null;

  /** Set one master EQ band live (drag) and keep config + JSON in sync. */
  function setMasterEqBand(bandId, gainDb) {
    const config = getConfig();
    if (!config.masterEq) config.masterEq = {};
    config.masterEq[bandId] = gainDb;
    getEngine().setMasterEqBand(bandId, gainDb);
  }

  /** Persist the master EQ after a drag settles (normalize + re-emit JSON). */
  function commitMasterEq() {
    applyConfig();
  }

  /** Flatten the whole mastering curve back to 0 dB. */
  function reset() {
    MASTER_EQ_BANDS.forEach((band) => setMasterEqBand(band.id, 0));
    applyConfig();
    setStatus("Mastering curve flattened");
  }

  /** Build the spectrum widget once the overlay exists in the DOM. */
  function ensureSpectrumWidget() {
    if (globalMixSpectrum) return globalMixSpectrum;
    const canvas = /** @type {HTMLCanvasElement} */ ($("#global-mix-spectrum"));
    if (!canvas) return null;
    globalMixSpectrum = new GlobalMixSpectrum(canvas, {
      getAnalyserData: () => {
        const chain = getEngine().getMasteringChain?.();
        return chain ? chain.getFrequencyData() : null;
      },
      getNyquist: () => {
        const chain = getEngine().getMasteringChain?.();
        return chain ? chain.nyquist : 22050;
      },
      getEq: () => getConfig().masterEq || {},
      onBandChange: (bandId, gainDb) => setMasterEqBand(bandId, gainDb),
      onBandCommit: () => commitMasterEq()
    });
    return globalMixSpectrum;
  }

  /** Open the Mixer overlay and render every track's level/pan/sends/shape. */
  function open() {
    const overlay = $("#global-mix-view");
    if (!overlay) return;
    overlay.hidden = false;
    document.body.classList.add("global-mix-open");
    render();
    const widget = ensureSpectrumWidget();
    if (widget) {
      // Defer so the canvas has its laid-out size before sizing the backing store.
      requestAnimationFrame(() => {
        widget.resize();
        widget.start();
      });
    }
  }

  function close() {
    const overlay = $("#global-mix-view");
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove("global-mix-open");
    globalMixSpectrum?.stop();
  }

  function isOpen() {
    const overlay = $("#global-mix-view");
    return Boolean(overlay && !overlay.hidden);
  }

  /**
   * Render the Mixer grid: one strip per grid track showing Level, Pan,
   * Echo (bus) and Reverb sends, plus a compact 808 shape readout. Edits here
   * write to the same per-track config maps as the inspector.
   */
  function render() {
    const host = $("#global-mix-strips");
    if (!host) return;
    host.innerHTML = "";
    const gridTrackIds = getGridTrackIds();
    trackGroups.forEach((group) => {
      const groupTrackIds = gridTrackIds.filter((id) => getTrackDef(id)?.group === group.id);
      if (!groupTrackIds.length) return;
      const col = document.createElement("div");
      col.className = "global-mix-group";
      const heading = document.createElement("div");
      heading.className = "global-mix-group-heading";
      heading.textContent = group.label;
      if (group.accent) heading.style.setProperty("--group-accent", group.accent);
      col.appendChild(heading);

      // ── Group-level bus trims ──────────────────────────────
      const busDefs = GROUP_BUS_CONTROLS[group.id];
      if (busDefs?.length) {
        const busRow = document.createElement("div");
        busRow.className = "global-mix-group-bus";
        busDefs.forEach(({ label, key, min, max, step }) => {
          const cfg = getConfig();
          const current = cfg[key] ?? ((min + max) / 2);
          const lbl = document.createElement("label");
          lbl.className = "global-mix-bus-param";
          const span = document.createElement("span");
          span.textContent = label;
          const range = document.createElement("input");
          range.type = "range";
          range.min = String(min); range.max = String(max); range.step = String(step);
          range.value = String(current);
          const out = document.createElement("output");
          out.textContent = Number(current).toFixed(step < 1 ? 2 : 0);
          range.addEventListener("input", () => {
            getConfig()[key] = Number(range.value);
            out.textContent = Number(range.value).toFixed(step < 1 ? 2 : 0);
            applyConfig();
          });
          lbl.append(span, range, out);
          busRow.appendChild(lbl);
        });
        col.appendChild(busRow);
      }

      groupTrackIds.forEach((hit) => {
        const def = getTrackDef(hit);
        const strip = document.createElement("div");
        strip.className = "global-mix-strip";

        const title = document.createElement("div");
        title.className = "global-mix-strip-name";
        title.textContent = isInstanceId(hit) ? instanceLabel(hit) : (def?.label || hit);
        strip.appendChild(title);

        const addParam = (label, getValue, setValue, format, min, max, step) => {
          const row = document.createElement("label");
          row.className = "global-mix-param";
          const span = document.createElement("span");
          span.textContent = label;
          const range = document.createElement("input");
          range.type = "range";
          range.min = String(min); range.max = String(max); range.step = String(step);
          const value = getValue(hit);
          range.value = String(value);
          const out = document.createElement("output");
          out.textContent = format(value);
          range.addEventListener("input", () => {
            const v = clamp(range.value, min, max, value);
            out.textContent = format(v);
            setValue(hit, v);
          });
          row.append(span, range, out);
          strip.appendChild(row);
        };
        addParam("Level", mix.getLevel, mix.setLevel, (v) => Number(v).toFixed(2), 0, 2, 0.01);
        addParam("Pan", mix.getPan, mix.setPan, formatPan, -1, 1, 0.01);
        addParam("Echo", mix.getBusSend, mix.setBusSend, (v) => Number(v).toFixed(2), 0, 1, 0.01);
        addParam("Reverb", mix.getReverbSend, mix.setReverbSend, (v) => Number(v).toFixed(2), 0, 1, 0.01);

        if (trackSupportsShape(hit)) {
          const shape = document.createElement("div");
          shape.className = "global-mix-shape";
          renderTrackShapeControls(hit, shape);
          strip.appendChild(shape);
        }

        const actions = document.createElement("div");
        actions.className = "global-mix-strip-actions";
        const focusBtn = document.createElement("button");
        focusBtn.type = "button";
        focusBtn.textContent = "Inspect";
        focusBtn.title = "Select this track in the sequencer inspector";
        focusBtn.addEventListener("click", () => {
          close();
          onInspect(hit);
        });
        actions.appendChild(focusBtn);
        strip.appendChild(actions);

        col.appendChild(strip);
      });
      host.appendChild(col);
    });
    if (!host.children.length) {
      const empty = document.createElement("p");
      empty.className = "global-mix-empty";
      empty.textContent = "No tracks yet. Add tracks in the sequencer.";
      host.appendChild(empty);
    }
  }

  return { open, close, isOpen, reset, render };
}
