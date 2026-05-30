// Sample-browser UI controller.
//
// Encapsulates the "browse a sample library root → list folders/files →
// audition or load into the selected track" flow that used to live inline in
// the sequence editor. It owns its own browser state and audition element, and
// reaches the rest of the app only through a small set of injected callbacks,
// so it has no direct dependency on the editor's `state` object.
//
// Usage:
//   const browser = createSampleBrowser({
//     rootSelect, breadcrumb, list,   // DOM elements (may be null)
//     offline,                        // true when running from file:// (no dev server)
//     setStatus,                      // (text) => void
//     getSelectedHit,                 // () => trackId | null
//     assignSample                    // (hit, { url, label, root, path }) => Promise|void
//   });
//   browser.loadRoots();
//   // in a change handler: browser.browse(rootSelect.value, "");

export function createSampleBrowser({
  rootSelect,
  breadcrumb,
  list,
  offline = false,
  setStatus = () => {},
  getSelectedHit = () => null,
  assignSample = () => {}
}) {
  const browserState = { roots: [], rootId: null, path: "", dirs: [], files: [] };
  let auditionEl = null;

  function fileUrl(file) {
    if (file.url) return file.url;
    return `/api/sample-file?root=${encodeURIComponent(browserState.rootId)}&path=${encodeURIComponent(file.rel)}`;
  }

  function audition(file) {
    if (offline) {
      setStatus("Open the localhost version for audio");
      return;
    }
    if (!auditionEl) auditionEl = new Audio();
    auditionEl.src = fileUrl(file);
    auditionEl.currentTime = 0;
    void auditionEl.play().catch(() => setStatus("Could not play sample"));
    setStatus(`Auditioning ${file.name}`);
  }

  function renderBreadcrumb() {
    if (!breadcrumb) return;
    breadcrumb.innerHTML = "";
    const parts = browserState.path ? browserState.path.split("/").filter(Boolean) : [];
    const rootBtn = document.createElement("button");
    rootBtn.type = "button";
    rootBtn.className = "sample-crumb";
    rootBtn.textContent = "root";
    rootBtn.addEventListener("click", () => browse(browserState.rootId, ""));
    breadcrumb.appendChild(rootBtn);
    let acc = "";
    parts.forEach((part) => {
      acc = acc ? `${acc}/${part}` : part;
      const sep = document.createElement("span");
      sep.className = "sample-crumb-sep";
      sep.textContent = "/";
      const crumbPath = acc;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sample-crumb";
      btn.textContent = part;
      btn.addEventListener("click", () => browse(browserState.rootId, crumbPath));
      breadcrumb.append(sep, btn);
    });
  }

  function render() {
    renderBreadcrumb();
    if (!list) return;
    list.innerHTML = "";

    // Up one level
    if (browserState.path) {
      const up = document.createElement("button");
      up.type = "button";
      up.className = "sample-row sample-row-dir";
      up.innerHTML = `<span class="sample-row-icon">↩</span><span class="sample-row-name">..</span>`;
      up.addEventListener("click", () => {
        const parent = browserState.path.split("/").slice(0, -1).join("/");
        browse(browserState.rootId, parent);
      });
      list.appendChild(up);
    }

    browserState.dirs.forEach((dir) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "sample-row sample-row-dir";
      row.innerHTML = `<span class="sample-row-icon">📁</span><span class="sample-row-name"></span>`;
      row.querySelector(".sample-row-name").textContent = dir.name ?? dir;
      const next = dir.rel ?? (browserState.path ? `${browserState.path}/${dir.name ?? dir}` : (dir.name ?? dir));
      row.addEventListener("click", () => browse(browserState.rootId, next));
      list.appendChild(row);
    });

    browserState.files.forEach((file) => {
      const row = document.createElement("div");
      row.className = "sample-row sample-row-file";
      const name = document.createElement("span");
      name.className = "sample-row-name";
      name.textContent = file.name;

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
      loadBtn.addEventListener("click", () => {
        const hit = getSelectedHit();
        if (!hit) {
          setStatus("Select a track first");
          return;
        }
        void assignSample(hit, {
          url: fileUrl(file),
          label: file.name,
          root: browserState.rootId,
          path: file.rel
        });
      });

      row.append(name, auditionBtn, loadBtn);
      list.appendChild(row);
    });

    if (!browserState.dirs.length && !browserState.files.length && !browserState.path) {
      const empty = document.createElement("p");
      empty.className = "sample-browser-empty";
      empty.textContent = "This root is empty.";
      list.appendChild(empty);
    }
  }

  async function browse(rootId, path = "") {
    if (!rootId) return;
    browserState.rootId = rootId;
    browserState.path = path;
    try {
      const url = `/api/sample-browse?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`;
      const response = await fetch(url, { cache: "no-store" });
      const data = await response.json();
      browserState.dirs = Array.isArray(data?.dirs) ? data.dirs : [];
      browserState.files = Array.isArray(data?.files) ? data.files : [];
      render();
    } catch (error) {
      console.warn("Sample browse failed", error);
      if (list) {
        list.innerHTML = `<p class="sample-browser-empty">Could not list this folder.</p>`;
      }
    }
  }

  async function loadRoots() {
    if (!rootSelect) return;
    if (offline) {
      rootSelect.innerHTML = `<option value="">Run on localhost</option>`;
      if (list) {
        list.innerHTML = `<p class="sample-browser-empty">Sample browsing needs the dev server (npm run dev).</p>`;
      }
      return;
    }
    try {
      const response = await fetch("/api/sample-roots", { cache: "no-store" });
      const data = await response.json();
      browserState.roots = Array.isArray(data?.roots) ? data.roots : [];
      rootSelect.innerHTML = "";
      if (!browserState.roots.length) {
        rootSelect.innerHTML = `<option value="">No sample roots</option>`;
        if (list) {
          list.innerHTML = `<p class="sample-browser-empty">Add a root in <code>sample-library.json</code>.</p>`;
        }
        return;
      }
      browserState.roots.forEach((root) => {
        const option = document.createElement("option");
        option.value = root.id;
        option.textContent = root.available ? root.label : `${root.label} (missing)`;
        option.disabled = !root.available;
        rootSelect.appendChild(option);
      });
      const firstAvailable = browserState.roots.find((r) => r.available);
      if (firstAvailable) {
        rootSelect.value = firstAvailable.id;
        await browse(firstAvailable.id, "");
      }
    } catch (error) {
      console.warn("Sample roots failed to load", error);
      if (list) {
        list.innerHTML = `<p class="sample-browser-empty">Sample API unavailable.</p>`;
      }
    }
  }

  return { loadRoots, browse, render };
}
