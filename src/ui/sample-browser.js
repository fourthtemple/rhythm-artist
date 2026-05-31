// Sample-browser UI controller.
//
// Uses a hidden <input type="file" webkitdirectory> to let users pick a local
// folder — works in Safari, Chrome, and Firefox with no server required.

export function createSampleBrowser({
  openBtn,
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

  // Tree node: { name, children: Map<name, node>, files: File[] }
  let rootNode = null;
  // Stack of { name, node } for navigation
  let navStack = [];
  let auditionUrl = null;
  let auditionEl = null;

  // Build a virtual folder tree from a flat FileList
  function buildTree(fileList) {
    const root = { name: "", children: new Map(), files: [] };
    for (const file of fileList) {
      // webkitRelativePath = "rootFolder/sub/file.wav"
      const parts = file.webkitRelativePath.split("/");
      let node = root;
      // parts[0] is the root folder name, skip it for tree structure
      for (let i = 1; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!node.children.has(part)) {
          node.children.set(part, { name: part, children: new Map(), files: [] });
        }
        node = node.children.get(part);
      }
      const fileName = parts[parts.length - 1];
      if (!fileName.startsWith(".") && AUDIO_EXTS.has(ext(fileName))) {
        node.files.push(file);
      }
    }
    // The root folder name is parts[0] of first file
    const rootName = fileList[0]?.webkitRelativePath?.split("/")[0] ?? "Folder";
    root.name = rootName;
    return root;
  }

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

    // Up button
    if (navStack.length > 1) {
      const up = document.createElement("button");
      up.type = "button";
      up.className = "sample-row sample-row-dir";
      up.innerHTML = `<span class="sample-row-icon">↩</span><span class="sample-row-name">..</span>`;
      up.addEventListener("click", () => {
        navStack = navStack.slice(0, -1);
        renderCurrent();
      });
      list.appendChild(up);
    }

    dirs.forEach((child) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "sample-row sample-row-dir";
      row.innerHTML = `<span class="sample-row-icon">📁</span><span class="sample-row-name"></span>`;
      row.querySelector(".sample-row-name").textContent = child.name;
      row.addEventListener("click", () => {
        navStack.push({ name: child.name, node: child });
        renderCurrent();
      });
      list.appendChild(row);
    });

    files.forEach((file) => {
      const row = document.createElement("div");
      row.className = "sample-row sample-row-file";
      const nameEl = document.createElement("span");
      nameEl.className = "sample-row-name";
      nameEl.textContent = file.name;

      const auditionBtn = document.createElement("button");
      auditionBtn.type = "button";
      auditionBtn.className = "sample-row-action";
      auditionBtn.textContent = "▶";
      auditionBtn.title = `Audition ${file.name}`;
      auditionBtn.addEventListener("click", () => audition(file));

      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.className = "sample-row-action sample-row-load";
      loadBtn.textContent = "＋";
      loadBtn.title = "Load into selected track";
      loadBtn.disabled = !getSelectedHit();
      loadBtn.addEventListener("click", () => void loadFile(file));

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

  function audition(file) {
    if (auditionUrl) URL.revokeObjectURL(auditionUrl);
    auditionUrl = URL.createObjectURL(file);
    if (!auditionEl) auditionEl = new Audio();
    auditionEl.src = auditionUrl;
    auditionEl.currentTime = 0;
    void auditionEl.play().catch(() => setStatus("Could not play sample"));
    setStatus(`Auditioning ${file.name}`);
  }

  async function loadFile(file) {
    const hit = getSelectedHit();
    if (!hit) { setStatus("Select a track first"); return; }
    const url = URL.createObjectURL(file);
    await assignSample(hit, { url, label: file.name, root: null, path: file.name });
  }

  function init() {
    // Create a hidden file input for folder picking
    const input = document.createElement("input");
    input.type = "file";
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("multiple", "");
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener("change", () => {
      const files = [...input.files].filter(f => AUDIO_EXTS.has(ext(f.name)));
      if (!files.length) { setStatus("No audio files found in that folder"); return; }
      rootNode = buildTree(input.files);
      navStack = [{ name: rootNode.name, node: rootNode }];
      renderCurrent();
      input.value = "";
    });

    if (openBtn) openBtn.addEventListener("click", () => input.click());
  }

  // API compatibility
  async function loadRoots() { init(); }
  async function browse() {}
  function render() {}

  return { init, loadRoots, browse, render };
}
