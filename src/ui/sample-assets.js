const DB_NAME = "rhythm-artist";
const DB_STORE = "kv";
const HANDLE_MAP_KEY = "sampleFileHandles";
const FOLDER_HANDLE_KEY = "sampleDirHandle";

export const SAMPLE_SOURCE_BUNDLED = "bundled-sample";
export const SAMPLE_SOURCE_BROWSER_HANDLE = "browser-file-handle";
export const SAMPLE_SOURCE_LOCAL_FILE = "local-file";

export const supportsPersistentFileHandles = () =>
  typeof window !== "undefined" && "showOpenFilePicker" in window && "indexedDB" in window;

export const supportsPersistentDirectoryHandles = () =>
  typeof window !== "undefined" && "showDirectoryPicker" in window && "indexedDB" in window;

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

const makeHandleId = () => {
  if (globalThis.crypto?.randomUUID) return `fh_${globalThis.crypto.randomUUID()}`;
  return `fh_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

async function loadHandleMap() {
  const map = await idbGet(HANDLE_MAP_KEY);
  return map && typeof map === "object" ? map : {};
}

async function ensureReadPermission(handle, { requestPermission = false } = {}) {
  let permission = "granted";
  if (handle?.queryPermission) {
    permission = await handle.queryPermission({ mode: "read" });
  }
  if (permission !== "granted" && requestPermission && handle?.requestPermission) {
    permission = await handle.requestPermission({ mode: "read" });
  }
  if (permission !== "granted") throw new Error("sample-permission-required");
  return handle;
}

const pathParts = (path = "") => String(path).split(/[\\/]+/).filter(Boolean);
const fileNameFromPath = (path = "") => pathParts(path).pop() || "";
const lookupName = (name = "") => String(name || "")
  .normalize("NFC")
  .replace(/[\u2018\u2019\u0060\u00b4]/g, "'")
  .toLowerCase();

async function fileHandleAtPath(dirHandle, path) {
  const parts = pathParts(path);
  if (!parts.length) return null;
  let cursor = dirHandle;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = await cursor.getDirectoryHandle(parts[index]);
  }
  return {
    handle: await cursor.getFileHandle(parts[parts.length - 1]),
    path: parts.join("/")
  };
}

async function findFileHandleByName(dirHandle, fileName, depth = 0, prefix = "", state = { seen: 0, max: 20000 }) {
  const expected = lookupName(fileName);
  if (!expected || depth > 8) return null;
  for await (const [name, handle] of dirHandle.entries()) {
    state.seen += 1;
    if (state.seen > state.max) return null;
    if (state.seen % 200 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    if (name.startsWith(".")) continue;
    const childPath = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file" && lookupName(name) === expected) {
      return { handle, path: childPath };
    }
    if (handle.kind === "directory") {
      const found = await findFileHandleByName(handle, fileName, depth + 1, childPath, state);
      if (found) return found;
    }
  }
  return null;
}

export async function findSampleFileHandleInDirectory(dirHandle, { path = "", fileName = "" } = {}) {
  if (!dirHandle) throw new Error("sample-folder-not-found");
  const expectedName = fileName || fileNameFromPath(path);
  let found = null;
  const primaryPath = path || expectedName;
  const candidatePaths = [primaryPath];
  const parts = pathParts(primaryPath);
  if (parts.length > 1) candidatePaths.push(parts.slice(1).join("/"));
  for (const candidate of candidatePaths.filter(Boolean)) {
    try {
      found = await fileHandleAtPath(dirHandle, candidate);
      if (found) break;
    } catch {
      // Try the next path shape, then fall back to filename search.
    }
  }
  if (!found) found = await findFileHandleByName(dirHandle, expectedName);
  if (!found) throw new Error("sample-file-not-found-in-folder");
  return found;
}

export async function storeSampleFolderHandle(handle) {
  if (!handle) throw new Error("missing-folder-handle");
  await idbSet(FOLDER_HANDLE_KEY, handle);
  return { name: handle.name || "Samples" };
}

export async function getStoredSampleFolderHandle() {
  let handle = await idbGet(FOLDER_HANDLE_KEY);
  if (handle?.handle) handle = handle.handle;
  return handle || null;
}

export async function getSampleFolderHandle({ requestPermission = false, promptForFolder = false } = {}) {
  let handle = await getStoredSampleFolderHandle();
  if (handle) {
    try {
      return await ensureReadPermission(handle, { requestPermission });
    } catch (error) {
      if (!promptForFolder) throw error;
    }
  }
  if (!promptForFolder || !supportsPersistentDirectoryHandles()) {
    throw new Error(handle ? "sample-folder-permission-required" : "sample-folder-not-found");
  }
  const picked = await window.showDirectoryPicker({ mode: "read" });
  await storeSampleFolderHandle(picked);
  return ensureReadPermission(picked, { requestPermission: true });
}

export async function resolveSampleFromFolder({
  path = "",
  fileName = "",
  requestPermission = false,
  promptForFolder = false
} = {}) {
  const dirHandle = await getSampleFolderHandle({ requestPermission, promptForFolder });
  const found = await findSampleFileHandleInDirectory(dirHandle, { path, fileName });
  const file = await found.handle.getFile();
  return {
    file,
    handle: found.handle,
    url: URL.createObjectURL(file),
    label: file.name,
    path: found.path
  };
}

export async function storeFileHandle(handle, { label = handle?.name || "Sample", path = handle?.name || "" } = {}) {
  if (!handle) throw new Error("missing-file-handle");
  const handles = await loadHandleMap();
  const handleId = makeHandleId();
  handles[handleId] = {
    handle,
    label,
    path,
    savedAt: new Date().toISOString()
  };
  await idbSet(HANDLE_MAP_KEY, handles);
  return {
    source: SAMPLE_SOURCE_BROWSER_HANDLE,
    handleId,
    label,
    path,
    relinkRequired: false
  };
}

export async function resolveFileHandleSample(handleId, { requestPermission = false } = {}) {
  const handles = await loadHandleMap();
  const entry = handles[handleId];
  if (!entry?.handle) throw new Error("sample-handle-not-found");
  const handle = await ensureReadPermission(entry.handle, { requestPermission });
  const file = await handle.getFile();
  return {
    file,
    url: URL.createObjectURL(file),
    label: entry.label || file.name,
    path: entry.path || file.name
  };
}

export function bundledSampleReference({ url, label, root = null, path = null }) {
  return {
    source: SAMPLE_SOURCE_BUNDLED,
    url,
    label,
    root,
    path,
    relinkRequired: false
  };
}

export function localFileReference({ label, path = null }) {
  return {
    source: SAMPLE_SOURCE_LOCAL_FILE,
    label,
    path,
    relinkRequired: true
  };
}
