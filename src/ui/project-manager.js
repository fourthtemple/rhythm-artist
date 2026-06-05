// Project save/load (browser IndexedDB) and WAV export.
//
// Presents an explorer-style window with:
//   • File list with selection, sortable by name / date
//   • Toolbar: New · Save · Save As · Load · Rename (F2) · Delete · Export WAV
//   • Double-click or Enter on a row to load
//   • Inline rename on F2 / slow double-click
//   • WAV export via MediaRecorder → decode → 16-bit PCM WAV download

import { saveDefaultProject } from "../lib/config-io.js";

const DB_NAME   = "rhythm-artist";
const DB_STORE  = "kv";
const SLOTS_KEY = "projectSlots";
const MAX_SLOTS = 32;
const PROJECT_SCHEMA = "rhythm-artist/project@1";

// ── IndexedDB helpers ────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(DB_STORE);
    req.onsuccess  = (e) => resolve(e.target.result);
    req.onerror    = (e) => reject(e.target.error);
  });
}
async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = (e) => reject(e.target.error);
  });
}
async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ── WAV encoder ──────────────────────────────────────────────────────────────
function audioBufferToWav(audioBuffer) {
  const numCh = audioBuffer.numberOfChannels;
  const rate  = audioBuffer.sampleRate;
  const len   = audioBuffer.length;
  const bps   = 2; // 16-bit
  const block = numCh * bps;
  const data  = len * block;
  const buf   = new ArrayBuffer(44 + data);
  const v     = new DataView(buf);
  const str   = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + data, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * block, true); v.setUint16(32, block, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, data, true);
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return buf;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
}

// ── Main export ───────────────────────────────────────────────────────────────
export function createProjectManager({
  getConfig,
  applyLoadedConfig,
  getEngine,
  startPlayback,
  stopPlayback,
  setStatus = () => {}
}) {
  // ── Slot persistence ─────────────────────────────────────────────────────
  function configFromProject(project) {
    return project?.schema === PROJECT_SCHEMA && project.config ? project.config : project;
  }

  async function loadSlots() {
    const idbSlots = (await idbGet(SLOTS_KEY)) ?? [];
    return idbSlots.map((slot) => ({ ...slot, source: "browser" })).sort((a, b) => {
      if (a.name === "Default Project") return -1;
      if (b.name === "Default Project") return 1;
      return String(b.savedAt || "").localeCompare(String(a.savedAt || ""));
    });
  }
  async function saveSlots(slots) { await idbSet(SLOTS_KEY, slots); }

  async function saveProject(name) {
    const config = JSON.parse(JSON.stringify(getConfig()));
    const now = new Date().toISOString();
    if (name === "Default Project") {
      const result = await saveDefaultProject(config, name);
      return {
        name,
        savedAt: result.project?.savedAt || now,
        config,
        source: "browser",
        localSaved: result.localSaved,
        localSaveError: result.localSaveError
      };
    }
    const slots = ((await idbGet(SLOTS_KEY)) ?? []);
    const idx = slots.findIndex(s => s.name === name);
    if (idx >= 0) {
      slots[idx] = { ...slots[idx], config, savedAt: now };
    } else {
      slots.unshift({ name, savedAt: now, config });
      if (slots.length > MAX_SLOTS) slots.length = MAX_SLOTS;
    }
    await saveSlots(slots);
    return slots.find(s => s.name === name);
  }

  async function loadProject(name) {
    const slots = await loadSlots();
    const entry = slots.find(s => s.name === name);
    if (!entry) throw new Error(`"${name}" not found`);
    applyLoadedConfig(configFromProject(entry.config));
    return entry;
  }

  async function renameProject(oldName, newName) {
    if (!newName || newName === oldName) return false;
    const slots = await loadSlots();
    if (slots.some(s => s.name === newName)) return false; // collision
    const entry = slots.find(s => s.name === oldName);
    if (!entry) return false;
    entry.name = newName;
    await saveSlots(slots);
    return true;
  }

  async function deleteProject(name) {
    const slots = await loadSlots();
    await saveSlots(slots.filter(s => s.name !== name));
  }

  // ── Export to JSON file ──────────────────────────────────────────────────
  function exportJson() {
    const config = getConfig();
    const json   = JSON.stringify(config, null, 2) + "\n";
    const ts     = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    triggerDownload(new Blob([json], { type: "application/json" }), `rhythm-artist-${ts}.json`);
    setStatus("Exported JSON ✓");
  }

  // ── WAV export ───────────────────────────────────────────────────────────
  async function exportWav(durationSeconds = 8) {
    const engine = getEngine();
    if (!engine?.context) { setStatus("Start playback first to export audio"); return; }
    const ctx      = engine.context;
    const recDest  = ctx.createMediaStreamDestination();
    const mastering = engine.getMasteringChain?.();
    const tapNode  = mastering?.output ?? engine.masterGain;
    if (!tapNode) { setStatus("Engine not ready for export"); return; }
    tapNode.connect(recDest);

    const mimeType = ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus"]
      .find(t => MediaRecorder.isTypeSupported(t)) ?? "";
    const recorder = new MediaRecorder(recDest.stream, mimeType ? { mimeType } : {});
    const chunks   = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    setStatus(`Recording ${durationSeconds}s for WAV export…`);
    const wasPlaying = engine.playing;
    if (!wasPlaying) await startPlayback();
    recorder.start();
    await new Promise(r => setTimeout(r, durationSeconds * 1000));
    recorder.stop();
    await new Promise(r => { recorder.onstop = r; });
    tapNode.disconnect(recDest);
    if (!wasPlaying) stopPlayback();

    setStatus("Encoding WAV…");
    const blob    = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const wavBlob = new Blob([audioBufferToWav(decoded)], { type: "audio/wav" });
    const ts      = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    triggerDownload(wavBlob, `rhythm-artist-${ts}.wav`);
    setStatus("WAV exported ✓");
  }

  // ── UI state ─────────────────────────────────────────────────────────────
  let selectedName = null; // currently highlighted row
  let overlay      = null;

  function fmt(iso) {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  }

  function btn(id, label, cls = "") {
    return `<button type="button" id="${id}" class="pm-btn${cls ? " " + cls : ""}">${label}</button>`;
  }

  // ── Build the window DOM (once) ──────────────────────────────────────────
  function buildWindow() {
    const el = document.createElement("div");
    el.id        = "project-manager-overlay";
    el.className = "project-manager-overlay";
    el.innerHTML = `
      <div class="pm-window" role="dialog" aria-modal="true" aria-label="Projects">
        <div class="pm-titlebar">
          <span class="pm-titlebar-icon">🗂</span>
          <span class="pm-titlebar-title">Projects</span>
          <button type="button" class="pm-titlebar-close" id="pm-close" title="Close">✕</button>
        </div>

        <div class="pm-toolbar">
          ${btn("pm-new",     "＋ New")}
          ${btn("pm-save",    "💾 Save")}
          ${btn("pm-save-as", "Save As…")}
          <div class="pm-toolbar-sep"></div>
          ${btn("pm-load",    "⏎ Load",   "pm-btn-primary")}
          ${btn("pm-rename",  "✏ Rename")}
          ${btn("pm-delete",  "✕ Delete", "pm-btn-danger")}
          <div class="pm-toolbar-sep"></div>
          ${btn("pm-export-json", "⬇ JSON")}
          ${btn("pm-export-wav",  "⬇ WAV")}
          <div class="pm-toolbar-spacer"></div>
        </div>

        <div class="pm-body">
          <div class="pm-explorer" id="pm-explorer">
            <div class="pm-col-header">
              <span class="pm-col-label">Name</span>
              <span class="pm-col-label">Saved</span>
            </div>
            <div id="pm-file-list"></div>
          </div>
        </div>

        <div class="pm-footer">
          <span class="pm-footer-info" id="pm-footer-info">No project selected</span>
          <label class="pm-dur-label" title="WAV export duration">
            WAV dur.
            <input id="pm-dur" type="number" min="1" max="300" value="8" class="pm-dur-input" />s
          </label>
        </div>
      </div>`;
    return el;
  }

  // ── Render file list ─────────────────────────────────────────────────────
  async function renderList() {
    if (!overlay) return;
    const listEl   = overlay.querySelector("#pm-file-list");
    const footerEl = overlay.querySelector("#pm-footer-info");
    const slots    = await loadSlots();
    if (!selectedName && slots.some((slot) => slot.name === "Default Project")) {
      selectedName = "Default Project";
    }

    // Disable/enable toolbar buttons
    const hasSelection = !!selectedName && slots.some(s => s.name === selectedName);
    overlay.querySelector("#pm-load").disabled    = !hasSelection;
    overlay.querySelector("#pm-rename").disabled  = !hasSelection;
    overlay.querySelector("#pm-delete").disabled  = !hasSelection;

    if (!hasSelection && selectedName) selectedName = null;

    footerEl.textContent = hasSelection
      ? `"${selectedName}" — ${slots.length} project${slots.length !== 1 ? "s" : ""}`
      : `${slots.length} project${slots.length !== 1 ? "s" : ""}`;

    listEl.innerHTML = "";

    if (!slots.length) {
      listEl.innerHTML = `
        <div class="pm-empty-state">
          <span class="pm-empty-icon">📂</span>
          <span>No saved projects — click <b>＋ New</b> or <b>💾 Save</b> to create one</span>
        </div>`;
      return;
    }

    slots.forEach(slot => {
      const row = document.createElement("div");
      row.className = "pm-file-row" + (slot.name === selectedName ? " is-selected" : "");
      row.dataset.name = slot.name;
      row.tabIndex = 0;
      row.innerHTML = `
        <span class="pm-file-name">
          <span class="pm-file-icon">♪</span>
          <span class="pm-file-name-text"></span>
        </span>
        <span class="pm-file-date">${fmt(slot.savedAt)}</span>`;
      row.querySelector(".pm-file-name-text").textContent = slot.name;

      // Single click = select
      row.addEventListener("click", () => {
        selectedName = slot.name;
        renderList();
      });

      // Double-click = load & close
      row.addEventListener("dblclick", async () => {
        await doLoad(slot.name);
      });

      // Keyboard: Enter = load, F2 = rename, Delete = delete
      row.addEventListener("keydown", async (e) => {
        if (e.key === "Enter")  { await doLoad(slot.name); }
        if (e.key === "F2")     { await doRename(slot.name, row); }
        if (e.key === "Delete") { await doDelete(slot.name); }
      });

      listEl.appendChild(row);
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  function promptName(defaultVal = "") {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.style.cssText = `
        position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.6);
        display:flex;align-items:center;justify-content:center;`;
      modal.innerHTML = `
        <div style="
          background:var(--panel,#171c23);
          border:1px solid var(--line,#313b49);
          border-radius:10px;padding:20px 22px;
          display:flex;flex-direction:column;gap:12px;
          min-width:300px;box-shadow:0 12px 40px rgba(0,0,0,0.7)">
          <span style="font-size:0.75rem;color:var(--muted,#9eacb6);text-transform:uppercase;letter-spacing:0.08em;font-weight:700">Project name</span>
          <input id="pm-prompt-input" type="text" maxlength="64" style="
            background:var(--bg,#101318);
            border:1px solid var(--accent-2,#78d7ba);
            border-radius:5px;color:var(--text,#edf2f5);
            padding:7px 10px;font-size:0.85rem;outline:none;font:inherit;" />
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="pm-prompt-cancel" class="pm-btn">Cancel</button>
            <button id="pm-prompt-ok" class="pm-btn pm-btn-primary">OK</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      const input = modal.querySelector("#pm-prompt-input");
      input.value = defaultVal;
      requestAnimationFrame(() => { input.focus(); input.select(); });
      const finish = (val) => { document.body.removeChild(modal); resolve(val); };
      modal.querySelector("#pm-prompt-ok").addEventListener("click", () => finish(input.value.trim()));
      modal.querySelector("#pm-prompt-cancel").addEventListener("click", () => finish(null));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter")  finish(input.value.trim());
        if (e.key === "Escape") finish(null);
      });
    });
  }

  async function doNew() {
    const name = await promptName(`Project ${new Date().toLocaleString()}`);
    if (!name) return;
    const saved = await saveProject(name);
    selectedName = name;
    setStatus(saveStatus(name, saved));
    await renderList();
  }

  function saveStatus(name, saved) {
    if (name !== "Default Project") return `Saved "${name}"`;
    if (saved?.localSaved) return "Saved Default Project to browser + bundled startup file";
    if (saved?.localSaveError) return "Saved Default Project in browser; bundled file save failed";
    return "Saved Default Project in this browser";
  }

  async function doSave() {
    // Save over the selected project, or prompt for a name if nothing selected
    if (selectedName) {
      const saved = await saveProject(selectedName);
      setStatus(saveStatus(selectedName, saved));
      await renderList();
    } else {
      await doNew();
    }
  }

  async function saveCurrentProject() {
    const target = selectedName || "Default Project";
    const saved = await saveProject(target);
    selectedName = target;
    setStatus(saveStatus(target, saved));
    return saved;
  }

  async function doSaveAs() {
    const defaultName = selectedName
      ? `${selectedName} copy`
      : `Project ${new Date().toLocaleString()}`;
    const name = await promptName(defaultName);
    if (!name) return;
    const saved = await saveProject(name);
    selectedName = name;
    setStatus(saveStatus(name, saved));
    await renderList();
  }

  async function doLoad(name) {
    const target = name ?? selectedName;
    if (!target) return;
    try {
      await loadProject(target);
      setStatus(`Loaded "${target}"`);
      close();
    } catch (err) { console.error(err); setStatus("Load failed"); }
  }

  async function doRename(name, _row) {
    const target = name ?? selectedName;
    if (!target) return;
    const newName = await promptName(target);
    if (!newName || newName === target) return;
    const ok = await renameProject(target, newName);
    if (!ok) { setStatus(`A project named "${newName}" already exists`); return; }
    selectedName = newName;
    setStatus(`Renamed to "${newName}"`);
    await renderList();
  }

  async function doDelete(name) {
    const target = name ?? selectedName;
    if (!target) return;
    if (!confirm(`Delete "${target}"?`)) return;
    await deleteProject(target);
    if (selectedName === target) selectedName = null;
    setStatus(`Deleted "${target}"`);
    await renderList();
  }

  // ── Open / close ─────────────────────────────────────────────────────────
  function close() {
    overlay?.remove();
    overlay = null;
  }

  async function open() {
    if (overlay) { close(); return; }
    overlay = buildWindow();
    document.body.appendChild(overlay);

    // Close on backdrop click
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector("#pm-close").addEventListener("click", close);

    // Toolbar wiring
    overlay.querySelector("#pm-new").addEventListener("click", doNew);
    overlay.querySelector("#pm-save").addEventListener("click", doSave);
    overlay.querySelector("#pm-save-as").addEventListener("click", doSaveAs);
    overlay.querySelector("#pm-load").addEventListener("click", () => doLoad(null));
    overlay.querySelector("#pm-rename").addEventListener("click", () => doRename(null, null));
    overlay.querySelector("#pm-delete").addEventListener("click", () => doDelete(null));
    overlay.querySelector("#pm-export-json").addEventListener("click", () => { close(); exportJson(); });
    overlay.querySelector("#pm-export-wav").addEventListener("click", () => {
      const dur = Number(overlay.querySelector("#pm-dur").value) || 8;
      close();
      void exportWav(dur);
    });

    // Global keyboard shortcuts inside the panel
    overlay.querySelector(".pm-window").addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); doSave(); }
    });

    await renderList();
  }

  return { open, close, saveProject, saveCurrentProject, loadProject, deleteProject, renameProject, exportWav, exportJson };
}
