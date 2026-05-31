// Sample-browser UI controller.
//
// Uses the browser File System Access API (showDirectoryPicker) so users can
// browse any folder on their local machine — no server config, no uploads.
// Falls back gracefully in browsers that don't support the API.
//
// Usage:
//   const browser = createSampleBrowser({ openBtn, breadcrumb, list,
//     setStatus, getSelectedHit, assignSample });
//   browser.init();

export function createSampleBrowser({
  openBtn,       // <button> that triggers the directory picker
  breadcrumb,    // breadcrumb container element (may be null)
  list,          // file list container element (may be null)
  setStatus = () => {},
  getSelectedHit = () => null,
  assignSample = () => {}
}) {
  // Stack of { name, handle } — index 0 is the root directory.
  let dirStack = [];
  let auditionEl = null;

  const AUDIO_EXTS = new Set([".wav", ".mp3", ".ogg", ".flac", ".aif", ".aiff", ".m4a"]);

  function ext(name) {
    const i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i).toLowerCase() : "";
  }

  async function openFolder() {
    if (!("showDirectoryPicker" in window)) {
      setStatus("Your browser doesn't support directory picking (use Chrome or Edge)");
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      dirStack = [{ name: handle.name, handle }];
      await renderDir();
    } catch (err) {
      if (err.name !== "AbortError") setStatus("Could not open folder");
    }
  }

  async function enterDir(handle, name) {
    dirStack.push({ name, handle });
    await renderDir();
  }

  async function goToDepth(depth) {
    dirStack = dirStack.slice(0, depth + 1);
    await renderDir();
  }

  function renderBreadcrumb() {
    if (!breadcrumb) return;
    breadcrumb.innerHTML = "";
    dirStack.forEach(({ name }, i) => {
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
      btn.addEventListener("click", () => void goToDepth(depth));
      breadcrumb.appendChild(btn);
    });
  }

  async function renderDir() {
    if (!dirStack.length) return;
    const { handle } = dirStack[dirStack.length - 1];
    renderBreadcrumb();
    if (!list) return;
    list.innerHTML = "";

    const dirs = [];
    const files = [];
    for await (const [name, entry] of handle.entries()) {
      if (name.startsWith(".")) continue;
      if (entry.kind === "directory") {
        dirs.push({ name, handle: entry });
      } else if (AUDIO_EXTS.has(ext(name))) {
        files.push({ name, handle: entry });
      }
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));

    // Up button (not at root)
    if (dirStack.length > 1) {
      const up = document.createElement("button");
      up.type = "button";
      up.className = "sample-row sample-row-dir";
      up.innerHTML = `<span class="sample-row-icon">↩</span><span class="sample-row-name">..</span>`;
      up.addEventListener("click", () => void goToDepth(dirStack.length - 2));
      list.appendChild(up);
    }

    dirs.forEach(({ name, handle: dirHandle }) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "sample-row sample-row-dir";
      row.innerHTML = `<span class="sample-row-icon">📁</span><span class="sample-row-name"></span>`;
      row.querySelector(".sample-row-name").textContent = name;
      row.addEventListener("click", () => void enterDir(dirHandle, name));
      list.appendChild(row);
    });

    files.forEach(({ name, handle: fileHandle }) => {
      const row = document.createElement("div");
      row.className = "sample-row sample-row-file";
      const nameEl = document.createElement("span");
      nameEl.className = "sample-row-name";
      nameEl.textContent = name;

      const auditionBtn = document.createElement("button");
      auditionBtn.type = "button";
      auditionBtn.className = "sample-row-action";
      auditionBtn.textContent = "▶";
      auditionBtn.title = `Audition ${name}`;
      auditionBtn.addEventListener("click", () => void audition(fileHandle, name));

      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.className = "sample-row-action sample-row-load";
      loadBtn.textContent = "＋";
      loadBtn.title = "Load into selected track";
      loadBtn.disabled = !getSelectedHit();
      loadBtn.addEventListener("click", () => void loadFile(fileHandle, name));

      row.append(nameEl, auditionBtn, loadBtn);
      list.appendChild(row);
    });

    if (!dirs.length && !files.length) {
      const empty = document.createElement("p");
      empty.className = "sample-browser-empty";
      empty.textContent = "No audio files in this folder.";
      list.appendChild(empty);
    }
  }

  async function audition(fileHandle, name) {
    try {
      const file = await fileHandle.getFile();
      const url = URL.createObjectURL(file);
      if (!auditionEl) auditionEl = new Audio();
      else URL.revokeObjectURL(auditionEl.src);
      auditionEl.src = url;
      auditionEl.currentTime = 0;
      await auditionEl.play();
      setStatus(`Auditioning ${name}`);
    } catch {
      setStatus("Could not play sample");
    }
  }

  async function loadFile(fileHandle, name) {
    const hit = getSelectedHit();
    if (!hit) { setStatus("Select a track first"); return; }
    try {
      const file = await fileHandle.getFile();
      const url = URL.createObjectURL(file);
      await assignSample(hit, { url, label: name, root: null, path: name });
    } catch {
      setStatus("Could not load sample");
    }
  }

  function init() {
    if (openBtn) openBtn.addEventListener("click", () => void openFolder());
    if (list && !("showDirectoryPicker" in window)) {
      list.innerHTML = `<p class="sample-browser-empty">Directory picker not supported in this browser. Use Chrome or Edge.</p>`;
    }
  }

  // Kept for API compatibility with call sites that use loadRoots / browse.
  async function loadRoots() { init(); }
  async function browse() {}
  function render() {}

  return { init, loadRoots, browse, render };
}
