// Browser I/O primitives for saving and loading the rhythm config. These are
// the side-effecting boundary (blob download, IndexedDB, fetch GET) with no
// dependency on editor state, so the editor can wrap them with its own
// normalization and re-render logic.

const DB_NAME = "rhythm-artist";
const DB_STORE = "kv";
const SLOTS_KEY = "projectSlots";
const DEFAULT_PROJECT_KEY = "defaultProject";
const PROJECT_SCHEMA = "rhythm-artist/project@1";
const LOCAL_MODE_URL = "/__rhythm-local/mode";
const LOCAL_DEFAULT_PROJECT_URL = "/__rhythm-local/default-project";
const DEFAULT_LOCAL_MODE = {
  mode: "user",
  canSaveDefaultProject: false,
  preferBundledDefault: false
};

let localModePromise = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (event) => event.target.result.createObjectStore(DB_STORE);
    req.onsuccess = (event) => resolve(event.target.result);
    req.onerror = (event) => reject(event.target.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = (event) => reject(event.target.error);
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = (event) => reject(event.target.error);
  });
}

function wrapProject(project, name = "Default Project") {
  if (project?.schema === PROJECT_SCHEMA && project.config) {
    return {
      ...project,
      name: project.name || name,
      savedAt: project.savedAt || new Date().toISOString()
    };
  }
  return {
    schema: PROJECT_SCHEMA,
    name,
    savedAt: new Date().toISOString(),
    samplePacks: ["default-pack"],
    config: project
  };
}

async function upsertProjectSlot(project) {
  const slots = ((await idbGet(SLOTS_KEY)) ?? []);
  const idx = slots.findIndex((slot) => slot.name === project.name);
  const nextSlot = {
    name: project.name,
    savedAt: project.savedAt,
    config: project.config
  };
  if (idx >= 0) {
    slots[idx] = { ...slots[idx], ...nextSlot };
  } else {
    slots.unshift(nextSlot);
  }
  await idbSet(SLOTS_KEY, slots);
}

export async function getLocalServerMode({ refresh = false } = {}) {
  if (refresh) localModePromise = null;
  if (!localModePromise) {
    localModePromise = (async () => {
      try {
        const response = await fetch(LOCAL_MODE_URL, { cache: "no-store" });
        if (!response.ok) return DEFAULT_LOCAL_MODE;
        const data = await response.json();
        return {
          mode: data.mode === "edit-default" ? "edit-default" : "user",
          canSaveDefaultProject: Boolean(data.canSaveDefaultProject),
          preferBundledDefault: Boolean(data.preferBundledDefault)
        };
      } catch {
        return DEFAULT_LOCAL_MODE;
      }
    })();
  }
  return localModePromise;
}

async function saveBundledDefaultProject(project) {
  const response = await fetch(LOCAL_DEFAULT_PROJECT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: project.name, project })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.error || "bundled-default-save-failed");
  }
  return result;
}

/** Trigger a client-side download of `content` as a JSON file. */
export function downloadJsonFile(content, fileName = "kamorebi-rhythm-sequence.json") {
  const blob = new Blob([content], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** Save the startup project to this browser's persistent IndexedDB cache. */
export async function saveDefaultProject(project, name = "Default Project") {
  const wrapped = wrapProject(project, name);
  await idbSet(DEFAULT_PROJECT_KEY, wrapped);
  await upsertProjectSlot(wrapped);
  const result = { ok: true, project: { name: wrapped.name, savedAt: wrapped.savedAt, source: "browser" } };
  const localMode = await getLocalServerMode();
  if (!localMode.canSaveDefaultProject) return result;
  try {
    result.localSave = await saveBundledDefaultProject(wrapped);
    result.localSaved = true;
  } catch (error) {
    console.error("Bundled default project save failed", error);
    result.localSaved = false;
    result.localSaveError = error.message || "bundled-default-save-failed";
  }
  return result;
}

/** Load the startup project from this browser's persistent IndexedDB cache. */
export async function loadDefaultProject() {
  return idbGet(DEFAULT_PROJECT_KEY);
}

/** Fetch and parse a saved rhythm config JSON from `url`. Throws on non-200. */
export async function fetchSavedConfig(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}
