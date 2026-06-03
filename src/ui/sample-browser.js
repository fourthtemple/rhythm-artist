// Sample-browser UI controller.
//
// Strategy:
//   • Chrome/Edge: use File System Access API (showDirectoryPicker) so we can
//     store the FileSystemDirectoryHandle in IndexedDB and re-use it across
//     sessions without asking the user to pick again.
//   • Safari / Firefox: fall back to <input type="file" webkitdirectory>.

const FS_ACCESS = typeof window !== "undefined" && "showDirectoryPicker" in window;

// ── Minimal IndexedDB key-value store (no deps) ─────────────────────────────
const DB_NAME = "rhythm-artist";
const DB_STORE = "kv";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(DB_STORE);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    const req = tx.objectStore(DB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

const IDB_HANDLE_KEY = "sampleDirHandle";

// ── Main export ──────────────────────────────────────────────────────────────

export function createSampleBrowser({
  openBtn,   // now unused — the label/input are wired directly in HTML
  fileInput, // <input type="file" webkitdirectory> element (fallback)
  breadcrumb,
  list,
  setStatus = () => {},
  getSelectedHit = () => null,
  assignSample = () => {}
}) {
  const AUDIO_EXTS = new Set([".wav", ".mp3", ".ogg", ".flac", ".aif", ".aiff", ".m4a"]);

  function ext(name) {
    const i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i).toLowerCase() : "";
  }

  // ── Virtual tree (shared between both paths) ─────────────────────────────

  // Node: { name, children: Map<name,node>, files: Array<File|FileEntry> }
  // For FS Access API we store { name, handle } in files instead of File
  // objects; we materialise File on demand for audition/load.

  let rootNode = null;
  let navStack = [];
  let serverRoot = null;
  let serverPath = "";
  let serverCrumbs = [];
  let auditionUrl = null;
  let auditionEl = null;

  // ── Build tree from flat FileList (webkitdirectory fallback) ─────────────
  function buildTreeFromFileList(fileList) {
    const root = { name: "", children: new Map(), files: [] };
    for (const file of fileList) {
      const parts = file.webkitRelativePath.split("/");
      let node = root;
      for (let i = 1; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!node.children.has(part)) {
          node.children.set(part, { name: part, children: new Map(), files: [] });
        }
        node = node.children.get(part);
      }
      const fileName = parts[parts.length - 1];
      if (!fileName.startsWith(".") && AUDIO_EXTS.has(ext(fileName))) {
        node.files.push({ name: fileName, file });
      }
    }
    root.name = fileList[0]?.webkitRelativePath?.split("/")[0] ?? "Folder";
    return root;
  }

  // ── Build tree from FileSystemDirectoryHandle (FS Access API) ───────────
  async function buildTreeFromHandle(dirHandle, depth = 0) {
    const node = { name: dirHandle.name, children: new Map(), files: [] };
    for await (const [name, handle] of dirHandle.entries()) {
      if (name.startsWith(".")) continue;
      if (handle.kind === "directory") {
        if (depth < 6) {
          const child = await buildTreeFromHandle(handle, depth + 1);
          node.children.set(name, child);
        }
      } else if (AUDIO_EXTS.has(ext(name))) {
        node.files.push({ name, handle });
      }
    }
    return node;
  }

  // ── Materialise a File from an entry (works for both paths) ─────────────
  async function entryToFile(entry) {
    if (entry.file instanceof File) return entry.file;
    return entry.handle.getFile();
  }

  // ── Server-backed sample pack path ─────────────────────────────────────
  async function loadServerRoots() {
    try {
      const response = await fetch("/api/sample-roots", { cache: "no-store" });
      if (!response.ok) return false;
      const data = await response.json();
      const roots = Array.isArray(data.roots) ? data.roots.filter((root) => root.available) : [];
      if (!roots.length) return false;
      if (roots.length === 1) {
        await browseServerRoot(roots[0], "");
        return true;
      }
      renderServerRootList(roots);
      return true;
    } catch {
      return false;
    }
  }

  function renderServerBreadcrumb() {
    if (!breadcrumb) return;
    breadcrumb.innerHTML = "";
    const parts = [{ label: serverRoot?.label || "Samples", path: "" }, ...serverCrumbs];
    parts.forEach((part, index) => {
      if (index > 0) {
        const sep = document.createElement("span");
        sep.className = "sample-crumb-sep";
        sep.textContent = "/";
        breadcrumb.appendChild(sep);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sample-crumb";
      btn.textContent = part.label;
      btn.addEventListener("click", () => void browseServerRoot(serverRoot, part.path));
      breadcrumb.appendChild(btn);
    });
  }

  function renderServerRootList(roots) {
    rootNode = null;
    navStack = [];
    if (breadcrumb) breadcrumb.textContent = "";
    if (!list) return;
    list.innerHTML = "";
    roots.forEach((root) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "sample-row sample-row-dir";
      row.innerHTML = `<span class="sample-row-icon">📦</span><span class="sample-row-name"></span>`;
      row.querySelector(".sample-row-name").textContent = root.label;
      row.addEventListener("click", () => void browseServerRoot(root, ""));
      list.appendChild(row);
    });
    setStatus("Default sample packs ready");
  }

  async function browseServerRoot(root, path = "") {
    if (!root) return;
    serverRoot = root;
    serverPath = path || "";
    rootNode = null;
    navStack = [];
    const response = await fetch(`/api/sample-browse?root=${encodeURIComponent(root.id)}&path=${encodeURIComponent(serverPath)}`, { cache: "no-store" });
    if (!response.ok) {
      setStatus("Could not open sample pack");
      return;
    }
    const data = await response.json();
    serverCrumbs = serverPath
      ? serverPath.split(/[\\/]+/).filter(Boolean).map((part, index, parts) => ({
        label: part,
        path: parts.slice(0, index + 1).join("/")
      }))
      : [];
    renderServerBreadcrumb();
    if (!list) return;
    list.innerHTML = "";
    if (serverPath) {
      const up = document.createElement("button");
      up.type = "button";
      up.className = "sample-row sample-row-dir";
      up.innerHTML = `<span class="sample-row-icon">↩</span><span class="sample-row-name">..</span>`;
      up.addEventListener("click", () => {
        const parts = serverPath.split(/[\\/]+/).filter(Boolean);
        void browseServerRoot(root, parts.slice(0, -1).join("/"));
      });
      list.appendChild(up);
    }
    data.dirs?.forEach((dir) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "sample-row sample-row-dir";
      row.innerHTML = `<span class="sample-row-icon">📁</span><span class="sample-row-name"></span>`;
      row.querySelector(".sample-row-name").textContent = dir.name;
      row.addEventListener("click", () => void browseServerRoot(root, dir.rel));
      list.appendChild(row);
    });
    data.files?.forEach((file) => {
      renderFileRow({
        name: file.name,
        url: file.url,
        root: root.id,
        path: file.rel
      });
    });
    if (!data.dirs?.length && !data.files?.length) {
      const empty = document.createElement("p");
      empty.className = "sample-browser-empty";
      empty.textContent = "No audio files in this sample pack folder.";
      list.appendChild(empty);
    }
    setStatus(`Sample pack: ${root.label}`);
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function renderBreadcrumb() {
    if (!breadcrumb) return;
    breadcrumb.innerHTML = "";
    navStack.forEach(({ name }, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "sample-crumb-sep";
        sep.textContent = "/";
        breadcrumb.appendChild(sep);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sample-crumb";
      btn.textContent = name;
      const depth = i;
      btn.addEventListener("click", () => {
        navStack = navStack.slice(0, depth + 1);
        renderCurrent();
      });
      breadcrumb.appendChild(btn);
    });
  }

  function renderCurrent() {
    if (!navStack.length) return;
    const { node } = navStack[navStack.length - 1];
    renderBreadcrumb();
    if (!list) return;
    list.innerHTML = "";

    const dirs = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
    const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));

    if (navStack.length > 1) {
      const up = document.createElement("button");
      up.type = "button";
      up.className = "sample-row sample-row-dir";
      up.innerHTML = `<span class="sample-row-icon">↩</span><span class="sample-row-name">..</span>`;
      up.addEventListener("click", () => { navStack = navStack.slice(0, -1); renderCurrent(); });
      list.appendChild(up);
    }

    dirs.forEach((child) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "sample-row sample-row-dir";
      row.innerHTML = `<span class="sample-row-icon">📁</span><span class="sample-row-name"></span>`;
      row.querySelector(".sample-row-name").textContent = child.name;
      row.addEventListener("click", () => { navStack.push({ name: child.name, node: child }); renderCurrent(); });
      list.appendChild(row);
    });

    files.forEach((entry) => renderFileRow(entry));

    if (!dirs.length && !files.length) {
      const empty = document.createElement("p");
      empty.className = "sample-browser-empty";
      empty.textContent = "No audio files in this folder.";
      list.appendChild(empty);
    }
  }

  async function audition(entry) {
    if (entry.url) {
      if (!auditionEl) auditionEl = new Audio();
      auditionEl.src = entry.url;
      auditionEl.currentTime = 0;
      void auditionEl.play().catch(() => setStatus("Could not play sample"));
      setStatus(`Auditioning ${entry.name}`);
      return;
    }
    const file = await entryToFile(entry);
    if (auditionUrl) URL.revokeObjectURL(auditionUrl);
    auditionUrl = URL.createObjectURL(file);
    if (!auditionEl) auditionEl = new Audio();
    auditionEl.src = auditionUrl;
    auditionEl.currentTime = 0;
    void auditionEl.play().catch(() => setStatus("Could not play sample"));
    setStatus(`Auditioning ${entry.name}`);
  }

  async function loadEntry(entry) {
    const hit = getSelectedHit();
    if (!hit) { setStatus("Select a track first"); return; }
    if (entry.url) {
      await assignSample(hit, { url: entry.url, label: entry.name, root: entry.root ?? null, path: entry.path ?? entry.name });
      return;
    }
    const file = await entryToFile(entry);
    const url = URL.createObjectURL(file);
    await assignSample(hit, { url, label: entry.name, root: null, path: entry.name });
  }

  function renderFileRow(entry) {
    if (!list) return;
    const row = document.createElement("div");
    row.className = "sample-row sample-row-file";

    const nameEl = document.createElement("span");
    nameEl.className = "sample-row-name";
    nameEl.textContent = entry.name;

    const auditionBtn = document.createElement("button");
    auditionBtn.type = "button";
    auditionBtn.className = "sample-row-action";
    auditionBtn.textContent = "▶";
    auditionBtn.title = `Audition ${entry.name}`;
    auditionBtn.addEventListener("click", () => void audition(entry));

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "sample-row-action sample-row-load";
    loadBtn.textContent = "＋";
    loadBtn.title = "Load into selected track";
    loadBtn.disabled = !getSelectedHit();
    loadBtn.addEventListener("click", () => void loadEntry(entry));

    row.append(nameEl, auditionBtn, loadBtn);
    list.appendChild(row);
  }

  // ── Open folder (FS Access API path) ────────────────────────────────────
  async function openWithFSAccess() {
    let dirHandle;
    try {
      dirHandle = await window.showDirectoryPicker({ mode: "read" });
    } catch {
      return; // user cancelled
    }
    setStatus("Reading folder…");
    try {
      rootNode = await buildTreeFromHandle(dirHandle);
      navStack = [{ name: rootNode.name, node: rootNode }];
      renderCurrent();
      // Persist the handle so we can restore it next session
      await idbSet(IDB_HANDLE_KEY, dirHandle);
      setStatus(`Opened: ${rootNode.name}`);
    } catch (err) {
      console.error("Failed to read sample folder", err);
      setStatus("Could not read folder");
    }
  }

  // ── Restore persisted handle on load (Chrome only) ───────────────────────
  async function tryRestoreHandle() {
    if (!FS_ACCESS) return;
    try {
      const handle = await idbGet(IDB_HANDLE_KEY);
      if (!handle) return;
      // Re-request permission (Chrome requires a user gesture for this but
      // queryPermission works without one to check status).
      const perm = await handle.queryPermission({ mode: "read" });
      if (perm === "granted") {
        setStatus("Restoring sample folder…");
        rootNode = await buildTreeFromHandle(handle);
        navStack = [{ name: rootNode.name, node: rootNode }];
        renderCurrent();
        setStatus(`Sample folder: ${rootNode.name}`);
      }
      // If perm is "prompt", we'll re-ask next time the user clicks Open.
    } catch {
      // Silently ignore — stale or revoked handle
    }
  }

  // ── Wire up the open button / input ─────────────────────────────────────
  function init() {
    if (FS_ACCESS) {
      // Intercept clicks on the label/button so we use showDirectoryPicker
      // instead of the file input.
      const label = fileInput?.closest?.("label") ?? document.querySelector("label[for='sample-open-folder']");
      if (label) {
        label.addEventListener("click", (e) => {
          e.preventDefault();
          void openWithFSAccess();
        });
      } else {
        // Fallback: wire any element with id sample-open-folder
        const btn = document.getElementById("sample-open-folder");
        if (btn) btn.addEventListener("click", (e) => { e.preventDefault(); void openWithFSAccess(); });
      }
      // Also wire a dedicated "change folder" button if present
      const changeBtn = document.getElementById("sample-change-folder");
      if (changeBtn) changeBtn.addEventListener("click", () => void openWithFSAccess());
    } else {
      // Safari/Firefox: use <input webkitdirectory>
      const input = fileInput;
      if (!input) return;
      input.addEventListener("change", () => {
        const files = [...input.files].filter(f => AUDIO_EXTS.has(ext(f.name)));
        if (!files.length) { setStatus("No audio files found in that folder"); return; }
        rootNode = buildTreeFromFileList(input.files);
        navStack = [{ name: rootNode.name, node: rootNode }];
        renderCurrent();
        input.value = "";
        setStatus(`Opened: ${rootNode.name}`);
      });
    }
  }

  async function loadRoots() {
    init();
    const loadedServerPack = await loadServerRoots();
    if (!loadedServerPack) await tryRestoreHandle();
  }

  async function browse() {}
  function render() {}

  return { init, loadRoots, browse, render };
}
