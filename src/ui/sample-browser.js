// Sample-browser UI controller.
//
// Strategy:
//   • The bundled default pack is browsed from a static manifest.
//   • Upload opens the browser's directory input and builds a session tree.
//   • Chrome/Edge can also persist a directory handle in this browser.

import {
  getStoredSampleFolderHandle,
  bundledSampleReference,
  localFileReference,
  storeFileHandle,
  storeSampleFolderHandle,
  supportsPersistentDirectoryHandles
} from "./sample-assets.js";
import { DEFAULT_SAMPLE_ROOTS } from "./default-sample-pack.js";

// ── Main export ──────────────────────────────────────────────────────────────

export function createSampleBrowser({
  openBtn,
  fileInput = null,
  breadcrumb,
  list,
  setStatus = () => {},
  getSelectedHit = () => null,
  assignSample = () => {},
  addGridSampleTrack = null,
  addSampleTrack = null,
  addPianoRollTrack = null,
  onSampleFolderConfigured = null,
  onAddModeChange = () => {}
}) {
  const AUDIO_EXTS = new Set([".wav", ".mp3", ".ogg", ".flac", ".aif", ".aiff", ".m4a"]);
  const MAX_HANDLE_ENTRIES = 2000;

  // ── Virtual tree ─────────────────────────────────────────────────────────
  // Static-pack entries render directly; File/handle entries are materialised
  // on demand for user-selected folders.

  let rootNode = null;
  let navStack = [];
  let bundledRoot = null;
  let bundledRoots = DEFAULT_SAMPLE_ROOTS;
  let sampleFolderHandle = null;
  let bundledPath = "";
  let bundledCrumbs = [];
  let auditionUrl = null;
  let auditionEl = null;
  const capturedSamples = [];
  const browserSection = list?.closest?.(".sample-browser-section") ?? null;
  const folderStateEl = document.getElementById("sample-folder-state");
  const browserLabel = browserSection?.querySelector(".panel-label") ?? null;
  const addModeButtons = [...(browserSection?.querySelectorAll("[data-sample-add-mode]") ?? [])];
  let addMode = "hit";
  let initialized = false;

  function ext(name) {
    const i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i).toLowerCase() : "";
  }

  function lookupName(name = "") {
    return String(name || "")
      .normalize("NFC")
      .replace(/[\u2018\u2019\u0060\u00b4]/g, "'")
      .toLowerCase();
  }

  function pathParts(path = "") {
    return String(path || "").split(/[\\/]+/).filter(Boolean);
  }

  function fileNameFromPath(path = "") {
    const parts = pathParts(path);
    return parts[parts.length - 1] || "";
  }

  function sampleFolderName() {
    return sampleFolderHandle?.name || "Samples";
  }

  function setFolderState(state, text) {
    if (!folderStateEl) return;
    folderStateEl.dataset.state = state;
    folderStateEl.textContent = text;
  }

  function setBrowserExpanded(expanded) {
    browserSection?.classList.toggle("is-expanded", Boolean(expanded));
    const drawer = browserSection?.querySelector?.(".sample-browser-drawer");
    if (expanded && drawer instanceof HTMLDetailsElement) drawer.open = true;
  }

  function setBrowserView(view = "samples") {
    if (!browserSection) return;
    browserSection.dataset.browserView = view;
    if (browserLabel) browserLabel.textContent = "Sample Browser";
  }

  function keepBrowserPosition(callback) {
    const scroller = browserSection?.closest?.(".control-panel");
    const beforeTop = browserSection?.getBoundingClientRect?.().top ?? null;
    callback();
    if (!scroller || beforeTop == null) return;
    const afterTop = browserSection?.getBoundingClientRect?.().top ?? beforeTop;
    const delta = afterTop - beforeTop;
    if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
  }

  function updateAddModeUi() {
    browserSection?.setAttribute("data-sample-add-mode", addMode);
    addModeButtons.forEach((button) => {
      const active = button.dataset.sampleAddMode === addMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    list?.querySelectorAll(".sample-row-add").forEach((button) => {
      button.disabled = (addMode === "loop" && !addSampleTrack) || (addMode === "pianoRoll" && !addPianoRollTrack);
      button.title = addMode === "loop"
        ? "Add to Wave Edit player"
        : addMode === "pianoRoll"
          ? "Add as Piano Roll sampler"
          : "Add to Drum Hit player";
    });
  }

  function setAddMode(mode) {
    keepBrowserPosition(() => {
      addMode = mode === "loop" || mode === "pianoRoll" ? mode : "hit";
      updateAddModeUi();
      onAddModeChange(addMode);
    });
  }

  async function ensureDirectoryPermission(handle, { requestPermission = false } = {}) {
    if (!handle) return null;
    let permission = "granted";
    if (handle.queryPermission) {
      permission = await handle.queryPermission({ mode: "read" });
    }
    if (permission !== "granted" && requestPermission && handle.requestPermission) {
      permission = await handle.requestPermission({ mode: "read" });
    }
    if (permission !== "granted") throw new Error("sample-folder-permission-required");
    return handle;
  }

  async function buildNodeFromHandle(dirHandle, relPath = "") {
    const node = {
      name: dirHandle.name || "Samples",
      handle: dirHandle,
      path: relPath,
      children: new Map(),
      files: [],
      loaded: true,
      truncated: false,
      limit: MAX_HANDLE_ENTRIES
    };
    let visibleEntries = 0;
    for await (const [name, handle] of dirHandle.entries()) {
      if (name.startsWith(".")) continue;
      visibleEntries += 1;
      if (visibleEntries > MAX_HANDLE_ENTRIES) {
        node.truncated = true;
        break;
      }
      const childPath = relPath ? `${relPath}/${name}` : name;
      if (handle.kind === "directory") {
        node.children.set(name, {
          name,
          handle,
          path: childPath,
          children: new Map(),
          files: [],
          loaded: false,
          truncated: false,
          limit: MAX_HANDLE_ENTRIES
        });
      } else if (AUDIO_EXTS.has(ext(name))) {
        node.files.push({ name, handle, path: childPath });
      }
      if (visibleEntries % 250 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return node;
  }

  async function buildNodeFromFileList(fileList) {
    const root = {
      name: "Selected Folder",
      children: new Map(),
      files: [],
      loaded: true,
      truncated: false,
      limit: 0
    };
    const files = Array.from(fileList || []);
    root.limit = files.length;
    const firstPath = files[0]?.webkitRelativePath || files[0]?.name || "";
    if (firstPath.includes("/")) root.name = firstPath.split("/")[0] || root.name;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const relPath = file.webkitRelativePath || file.name;
      const parts = relPath.split(/[\\/]+/).filter(Boolean);
      const childStart = parts.length > 1 ? 1 : 0;
      let node = root;
      for (let i = childStart; i < parts.length - 1; i += 1) {
        const part = parts[i];
        if (!node.children.has(part)) {
          node.children.set(part, {
            name: part,
            children: new Map(),
            files: [],
            loaded: true,
            truncated: false,
            limit: files.length
          });
        }
        node = node.children.get(part);
      }
      const fileName = parts[parts.length - 1] || file.name;
      if (!fileName.startsWith(".") && AUDIO_EXTS.has(ext(fileName))) {
        node.files.push({ name: fileName, file, path: parts.slice(childStart).join("/") || fileName });
      }
      if (index > 0 && index % 250 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return root;
  }

  function findEntryByPath(node, path = "") {
    if (!node) return null;
    let parts = pathParts(path);
    if (!parts.length) return null;
    if (lookupName(parts[0]) === lookupName(node.name)) parts = parts.slice(1);
    if (!parts.length) return null;

    let cursor = node;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const expected = lookupName(parts[index]);
      cursor = [...(cursor.children?.values?.() || [])].find((child) => lookupName(child.name) === expected);
      if (!cursor?.loaded) return null;
    }

    const expectedFile = lookupName(parts[parts.length - 1]);
    return (cursor.files || []).find((entry) => lookupName(entry.name) === expectedFile) || null;
  }

  function findEntryByName(node, fileName, state = { seen: 0, max: 20000 }) {
    const expected = lookupName(fileName);
    if (!node || !expected) return null;
    for (const entry of node.files || []) {
      state.seen += 1;
      if (state.seen > state.max) return null;
      if (lookupName(entry.name) === expected) return entry;
    }
    for (const child of node.children?.values?.() || []) {
      state.seen += 1;
      if (state.seen > state.max) return null;
      if (!child.loaded) continue;
      const found = findEntryByName(child, fileName, state);
      if (found) return found;
    }
    return null;
  }

  // ── Materialise a File from an entry (works for both paths) ─────────────
  async function entryToFile(entry) {
    const hasFileCtor = typeof File === "function";
    const hasBlobCtor = typeof Blob === "function";
    if ((hasFileCtor && entry.file instanceof File) || (hasBlobCtor && entry.file instanceof Blob)) return entry.file;
    return entry.handle.getFile();
  }

  function appendCapturedSamples() {
    if (!list || !capturedSamples.length) return;
    const divider = document.createElement("div");
    divider.className = "sample-browser-divider";
    divider.innerHTML = `<span>Wave Edit Captures</span>`;
    list.appendChild(divider);
    capturedSamples.forEach((entry) => renderFileRow(entry));
  }

  function addCapturedSample(sample = {}) {
    if (!sample.file && !sample.blob && !sample.url) {
      setStatus("Could not copy wave edit to Sample Browser");
      return null;
    }
    const index = capturedSamples.length + 1;
    const name = sample.name || sample.label || `Wave Edit Capture ${index}.wav`;
    const file = sample.file || sample.blob || null;
    const url = sample.url || (file ? URL.createObjectURL(file) : null);
    const entry = {
      name,
      file,
      url,
      path: sample.path || name,
      source: "wave-edit-capture",
      captured: true
    };
    capturedSamples.push(entry);
    keepBrowserPosition(() => {
      setBrowserExpanded(true);
      if (navStack.length) renderCurrent();
      else if (bundledRoot) browseBundledRoot(bundledRoot, bundledPath);
      else renderRootList();
    });
    setStatus(`Copied ${name} to Sample Browser`);
    return entry;
  }

  async function resolveFromCurrentFolder({ path = "", fileName = "" } = {}) {
    const expectedName = fileName || fileNameFromPath(path);
    const entry = findEntryByPath(rootNode, path) || findEntryByName(rootNode, expectedName);
    if (!entry) return null;

    const file = await entryToFile(entry);
    const sourcePath = entry.path || file.name || entry.name || expectedName;
    const label = file.name || entry.name || expectedName;
    const audioUrl = URL.createObjectURL(file);
    if (entry.handle) {
      try {
        const source = await storeFileHandle(entry.handle, { label, path: sourcePath });
        return {
          file,
          audioUrl,
          source: {
            ...source,
            label,
            path: sourcePath,
            relinkRequired: false
          }
        };
      } catch (error) {
        console.warn("Could not persist relinked sample handle", error);
      }
    }
    return {
      file,
      audioUrl,
      source: localFileReference({ label, path: sourcePath })
    };
  }

  // ── Bundled static sample pack path ────────────────────────────────────
  function findBundledNode(root, path = "") {
    const parts = String(path || "").split(/[\\/]+/).filter(Boolean);
    let node = root;
    for (const part of parts) {
      node = (node.dirs || []).find((dir) => dir.name === part);
      if (!node) return null;
    }
    return node;
  }

  function shouldShowRootList() {
    return Boolean(sampleFolderHandle) || bundledRoots.length !== 1;
  }

  function renderRootList(status = "Samples ready") {
    rootNode = null;
    navStack = [];
    bundledRoot = null;
    bundledPath = "";
    bundledCrumbs = [];
    setBrowserExpanded(true);
    setBrowserView("samples");
    if (sampleFolderHandle) {
      setFolderState("ready", `Sample Folder: ${sampleFolderName()}`);
    } else {
      setFolderState("empty", "No sample directory set");
    }
    if (breadcrumb) breadcrumb.textContent = "";
    if (!list) return;
    list.innerHTML = "";

    if (sampleFolderHandle) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "sample-row sample-row-dir sample-row-root";
      row.innerHTML = `<span class="sample-row-icon">📂</span><span class="sample-row-name"></span>`;
      row.querySelector(".sample-row-name").textContent = `Sample Folder: ${sampleFolderName()}`;
      row.addEventListener("click", () => void browseSampleFolder({ requestPermission: true }));
      list.appendChild(row);
    }

    bundledRoots.forEach((root) => {
      const row = document.createElement("div");
      row.className = "sample-row sample-row-dir sample-row-root";
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.innerHTML = `<span class="sample-row-icon">📦</span><span class="sample-row-name"></span>`;
      row.querySelector(".sample-row-name").textContent = root.label;
      row.addEventListener("click", () => browseBundledRoot(root, ""));
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        browseBundledRoot(root, "");
      });
      list.appendChild(row);
    });

    appendCapturedSamples();

    if (!list.children.length) {
      const empty = document.createElement("p");
      empty.className = "sample-browser-empty";
      empty.textContent = "Upload a sample directory to browse local audio.";
      list.appendChild(empty);
    }
    setStatus(status);
  }

  function renderBundledBreadcrumb() {
    if (!breadcrumb) return;
    breadcrumb.innerHTML = "";
    const parts = [
      ...(shouldShowRootList() ? [{ label: "Samples", action: () => renderRootList() }] : []),
      { label: bundledRoot?.label || "Default Sample Pack", path: "" },
      ...bundledCrumbs
    ];
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
      btn.addEventListener("click", () => {
        if (part.action) {
          part.action();
          return;
        }
        browseBundledRoot(bundledRoot, part.path);
      });
      breadcrumb.appendChild(btn);
    });
  }

  async function browseSampleFolder({ requestPermission = false } = {}) {
    try {
      if (!sampleFolderHandle) {
        setFolderState("empty", "No sample directory set");
        renderRootList("Set a sample directory first");
        return;
      }
      setFolderState("loading", `Reading ${sampleFolderName()}...`);
      setStatus(`Reading ${sampleFolderName()}...`);
      const handle = await ensureDirectoryPermission(sampleFolderHandle, { requestPermission });
      rootNode = await buildNodeFromHandle(handle);
      navStack = [{ name: rootNode.name, node: rootNode }];
      bundledRoot = null;
      bundledPath = "";
      bundledCrumbs = [];
      renderCurrent();
      setBrowserExpanded(true);
      setFolderState("ready", `Sample Folder: ${rootNode.name}`);
      setStatus(rootNode.truncated
        ? `Sample folder: ${rootNode.name} (limited view)`
        : `Sample folder: ${rootNode.name}`);
    } catch (error) {
      console.warn("Failed to read sample folder", error);
      renderRootList("Could not read sample folder");
      setFolderState("error", "Could not read sample folder. Press Set again.");
    }
  }

  function browseBundledRoot(root, path = "") {
    if (!root) return;
    bundledRoot = root;
    bundledPath = path || "";
    rootNode = null;
    navStack = [];
    setBrowserView("samples");
    const data = findBundledNode(root, bundledPath);
    if (!data) {
      setStatus("Could not open sample pack");
      return;
    }
    bundledCrumbs = bundledPath
      ? bundledPath.split(/[\\/]+/).filter(Boolean).map((part, index, parts) => ({
        label: part,
        path: parts.slice(0, index + 1).join("/")
      }))
      : [];
    renderBundledBreadcrumb();
    setBrowserExpanded(true);
    if (!list) return;
    list.innerHTML = "";
    if (bundledPath) {
      const up = document.createElement("button");
      up.type = "button";
      up.className = "sample-row sample-row-dir";
      up.innerHTML = `<span class="sample-row-icon">↩</span><span class="sample-row-name">..</span>`;
      up.addEventListener("click", () => {
        const parts = bundledPath.split(/[\\/]+/).filter(Boolean);
        browseBundledRoot(root, parts.slice(0, -1).join("/"));
      });
      list.appendChild(up);
    }
    (data.dirs || []).forEach((dir) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "sample-row sample-row-dir";
      row.innerHTML = `<span class="sample-row-icon">📁</span><span class="sample-row-name"></span>`;
      row.querySelector(".sample-row-name").textContent = dir.name;
      row.addEventListener("click", () => browseBundledRoot(root, dir.path));
      list.appendChild(row);
    });
    (data.files || []).forEach((file) => {
      renderFileRow({
        name: file.name,
        url: file.url,
        source: "bundled-sample",
        root: root.id,
        path: file.path
      });
    });
    appendCapturedSamples();
    if (!(data.dirs || []).length && !(data.files || []).length && !capturedSamples.length) {
      const empty = document.createElement("p");
      empty.className = "sample-browser-empty";
      empty.textContent = "No audio files in this sample pack folder.";
      list.appendChild(empty);
    }
    setStatus(`Sample pack: ${root.label}`);
  }

  async function openDirectoryHandlePicker() {
    setFolderState("loading", "Opening directory dialogue...");
    setStatus("Opening directory dialogue...");
    let dirHandle = null;
    try {
      dirHandle = await window.showDirectoryPicker({ mode: "read" });
    } catch (error) {
      const name = error?.name || "";
      if (name === "AbortError") {
        setFolderState("empty", "Directory selection cancelled.");
        setStatus("Directory selection cancelled");
        return;
      }
      throw error;
    }

    try {
      sampleFolderHandle = dirHandle;
      if (supportsPersistentDirectoryHandles()) {
        try {
          await storeSampleFolderHandle(dirHandle);
        } catch (error) {
          console.warn("Could not persist sample folder handle", error);
        }
      }
      setFolderState("loading", `Reading ${sampleFolderName()}...`);
      rootNode = await buildNodeFromHandle(dirHandle);
      navStack = [{ name: rootNode.name, node: rootNode }];
      bundledRoot = null;
      bundledPath = "";
      bundledCrumbs = [];
      setBrowserExpanded(true);
      setBrowserView("samples");
      renderCurrent();
      setFolderState("ready", `Sample Folder: ${rootNode.name}`);
      setStatus(rootNode.truncated
        ? `Sample folder: ${rootNode.name} (limited view)`
        : `Sample folder: ${rootNode.name}`);
      if (onSampleFolderConfigured) {
        await onSampleFolderConfigured({ name: rootNode.name, resolveFile: resolveFromCurrentFolder });
      }
    } catch (error) {
      console.error("Failed to read selected directory", error);
      setFolderState("error", "Could not read selected directory.");
      setStatus("Could not read selected directory");
    }
  }

  async function loadFromDirectoryInput() {
    const files = fileInput?.files;
    if (!files?.length) {
      setFolderState("empty", "Directory selection cancelled.");
      setStatus("Directory selection cancelled");
      return;
    }
    setFolderState("loading", `Reading selected folder (${files.length} files)...`);
    setStatus(`Reading selected folder (${files.length} files)...`);
    try {
      sampleFolderHandle = null;
      rootNode = await buildNodeFromFileList(files);
      navStack = [{ name: rootNode.name, node: rootNode }];
      bundledRoot = null;
      bundledPath = "";
      bundledCrumbs = [];
      setBrowserExpanded(true);
      setBrowserView("samples");
      renderCurrent();
      setFolderState("ready", `Uploaded Folder: ${rootNode.name} (this session)`);
      setStatus(`Uploaded folder: ${rootNode.name} (this session)`);
      if (onSampleFolderConfigured) {
        await onSampleFolderConfigured({ name: rootNode.name, resolveFile: resolveFromCurrentFolder });
      }
    } catch (error) {
      console.error("Failed to load selected directory", error);
      setFolderState("error", "Could not load selected directory.");
      setStatus("Could not load selected directory");
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function renderBreadcrumb() {
    if (!breadcrumb) return;
    breadcrumb.innerHTML = "";
    if (shouldShowRootList()) {
      const rootBtn = document.createElement("button");
      rootBtn.type = "button";
      rootBtn.className = "sample-crumb";
      rootBtn.textContent = "Samples";
      rootBtn.addEventListener("click", () => renderRootList());
      breadcrumb.appendChild(rootBtn);
    }
    navStack.forEach(({ name }, i) => {
      if (i > 0 || breadcrumb.children.length) {
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
      row.addEventListener("click", () => {
        void (async () => {
          if (child.handle && !child.loaded) {
            setStatus(`Reading ${child.name}...`);
            Object.assign(child, await buildNodeFromHandle(child.handle, child.path || child.name));
          }
          navStack.push({ name: child.name, node: child });
          renderCurrent();
        })();
      });
      list.appendChild(row);
    });

    files.forEach((entry) => renderFileRow(entry));
    appendCapturedSamples();

    if (node.truncated) {
      const truncated = document.createElement("p");
      truncated.className = "sample-browser-empty";
      truncated.textContent = `Showing the first ${node.limit || MAX_HANDLE_ENTRIES} entries. Choose a smaller folder or open a subfolder.`;
      list.appendChild(truncated);
    }

    if (!dirs.length && !files.length && !capturedSamples.length) {
      const empty = document.createElement("p");
      empty.className = "sample-browser-empty";
      empty.textContent = "No audio files in this folder.";
      list.appendChild(empty);
    }
  }

  async function audition(entry) {
    stopAudition({ silent: true });
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

  function stopAudition({ silent = false } = {}) {
    if (auditionEl) {
      auditionEl.pause();
      try { auditionEl.currentTime = 0; } catch {}
      auditionEl.removeAttribute("src");
      auditionEl.load?.();
    }
    if (auditionUrl) {
      URL.revokeObjectURL(auditionUrl);
      auditionUrl = null;
    }
    if (!silent) setStatus("Sample preview stopped");
  }

  async function loadEntry(entry) {
    const hit = getSelectedHit() || await addGridSampleTrack?.({ name: entry.name });
    if (!hit) { setStatus("Select a track first"); return; }
    if (entry.url && !entry.file && !entry.handle) {
      await assignSample(hit, bundledSampleReference({
        url: entry.url,
        label: entry.name,
        root: entry.root ?? null,
        path: entry.path ?? entry.name
      }));
      return;
    }
    const file = await entryToFile(entry);
    const sessionUrl = URL.createObjectURL(file);
    if (entry.handle) {
      try {
        const reference = await storeFileHandle(entry.handle, { label: entry.name, path: entry.path ?? entry.name });
        await assignSample(hit, { ...reference, url: sessionUrl });
        setStatus(`Linked ${entry.name}`);
        return;
      } catch (error) {
        console.warn("Could not persist file handle", error);
      }
    }
    await assignSample(hit, {
      ...localFileReference({ label: entry.name, path: entry.path ?? entry.name }),
      url: sessionUrl
    });
    setStatus(`Loaded ${entry.name} for this session; relink after reload in this browser`);
  }

  async function loadEntryAsSampleTrack(entry) {
    if (!addSampleTrack) return;
    if (entry.url && !entry.file && !entry.handle) {
      await addSampleTrack({
        name: entry.name,
        file: null,
        source: bundledSampleReference({
          url: entry.url,
          label: entry.name,
          root: entry.root ?? null,
          path: entry.path ?? entry.name
        })
      });
      return;
    }
    const file = await entryToFile(entry);
    if (entry.handle) {
      try {
        const reference = await storeFileHandle(entry.handle, { label: entry.name, path: entry.path ?? entry.name });
        await addSampleTrack({ name: entry.name, file, source: reference });
        setStatus(`Linked ${entry.name} as sample track`);
        return;
      } catch (error) {
        console.warn("Could not persist sample-track file handle", error);
      }
    }
    await addSampleTrack({
      name: entry.name,
      file,
      source: localFileReference({ label: entry.name, path: entry.path ?? entry.name })
    });
    setStatus(`Loaded ${entry.name} as sample track for this session`);
  }

  async function loadEntryAsPianoRollTrack(entry) {
    if (!addPianoRollTrack) return;
    if (entry.url && !entry.file && !entry.handle) {
      await addPianoRollTrack({
        name: entry.name,
        sample: bundledSampleReference({
          url: entry.url,
          label: entry.name,
          root: entry.root ?? null,
          path: entry.path ?? entry.name
        })
      });
      return;
    }
    const file = await entryToFile(entry);
    const sessionUrl = URL.createObjectURL(file);
    if (entry.handle) {
      try {
        const reference = await storeFileHandle(entry.handle, { label: entry.name, path: entry.path ?? entry.name });
        await addPianoRollTrack({ name: entry.name, sample: { ...reference, url: sessionUrl } });
        setStatus(`Linked ${entry.name} as piano-roll sampler`);
        return;
      } catch (error) {
        console.warn("Could not persist piano-roll sample handle", error);
      }
    }
    await addPianoRollTrack({
      name: entry.name,
      sample: {
        ...localFileReference({ label: entry.name, path: entry.path ?? entry.name }),
        url: sessionUrl
      }
    });
    setStatus(`Loaded ${entry.name} as piano-roll sampler for this session`);
  }

  async function addEntry(entry) {
    if (addMode === "loop") {
      await loadEntryAsSampleTrack(entry);
      return;
    }
    if (addMode === "pianoRoll") {
      await loadEntryAsPianoRollTrack(entry);
      return;
    }
    await loadEntry(entry);
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
    auditionBtn.className = "sample-row-action sample-row-preview sample-row-preview--play";
    auditionBtn.title = `Audition ${entry.name}`;
    auditionBtn.setAttribute("aria-label", `Audition ${entry.name}`);
    auditionBtn.addEventListener("click", () => void audition(entry));

    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.className = "sample-row-action sample-row-preview sample-row-preview--stop";
    stopBtn.title = "Stop sample preview";
    stopBtn.setAttribute("aria-label", "Stop sample preview");
    stopBtn.addEventListener("click", () => stopAudition());

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "sample-row-action sample-row-load sample-row-add";
    loadBtn.textContent = "Add";
    loadBtn.addEventListener("click", () => void addEntry(entry));

    row.append(nameEl, auditionBtn, stopBtn, loadBtn);
    list.appendChild(row);
    updateAddModeUi();
  }

  async function openFolderPicker() {
    if (typeof window !== "undefined" && typeof window.showDirectoryPicker === "function") {
      try {
        await openDirectoryHandlePicker();
        return;
      } catch (error) {
        console.warn("showDirectoryPicker failed; falling back to directory input", error);
      }
    }
    if (fileInput) {
      setFolderState("loading", "Opening directory dialogue...");
      setStatus("Opening directory dialogue...");
      fileInput.value = "";
      fileInput.click();
      return;
    }
    setFolderState("error", "This browser does not allow directory selection.");
    setStatus("Directory selection is not available in this browser");
  }

  // ── Wire up the open button / input ─────────────────────────────────────
  function init() {
    if (initialized) return;
    initialized = true;
    // The Upload control is a <label> wrapping the directory input. Let the
    // browser perform the native input activation; programmatic click paths are
    // less reliable in Safari and embedded browsers.
    if (fileInput) {
      fileInput.addEventListener("change", () => void loadFromDirectoryInput());
    }
    if (openBtn) {
      openBtn.addEventListener("click", (event) => {
        if (event.target === fileInput || typeof window === "undefined" || typeof window.showDirectoryPicker !== "function") return;
        event.preventDefault();
        void openFolderPicker();
      });
    }
    addModeButtons.forEach((button) => {
      button.addEventListener("click", () => setAddMode(button.dataset.sampleAddMode));
    });
    updateAddModeUi();
  }

  async function loadRoots() {
    init();
    bundledRoots = DEFAULT_SAMPLE_ROOTS;
    if (supportsPersistentDirectoryHandles()) {
      try {
        sampleFolderHandle = await getStoredSampleFolderHandle();
      } catch {
        sampleFolderHandle = null;
      }
    }
    if (sampleFolderHandle) {
      setFolderState("ready", `Sample Folder: ${sampleFolderName()}`);
    } else {
      setFolderState("empty", "No sample directory set");
    }
    if (sampleFolderHandle || bundledRoots.length !== 1) {
      renderRootList(sampleFolderHandle
        ? `Sample folder ready: ${sampleFolderName()}`
        : "Default sample packs ready");
      return;
    }
    if (bundledRoots.length === 1) {
      browseBundledRoot(bundledRoots[0], "");
      return;
    }
  }

  async function browse() {}
  function render() {}

  return { init, loadRoots, browse, render, openFolder: openFolderPicker, addCapturedSample };
}
