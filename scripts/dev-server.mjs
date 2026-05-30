/**
 * dev-server.mjs
 * Zero-dependency dev server for rhythm-artist on http://localhost:3000
 *
 * Static file serving for the app, plus a small JSON API for browsing an
 * external sample library (configured in `sample-library.json`):
 *
 *   GET /api/sample-roots
 *       → { roots: [{ id, label, available }] }  (absolute paths stay server-side)
 *   GET /api/sample-browse?root=<id>&path=<relative/dir>
 *       → { root, path, dirs: [...], files: [{ name, rel, url }] }
 *   GET /api/sample-file?root=<id>&path=<relative/file.wav>
 *       → the raw audio bytes (for fetch + decodeAudioData / preview)
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 3000;
const LIBRARY_CONFIG = path.join(ROOT, "sample-library.json");
const AUDIO_EXTS = new Set([".wav", ".mp3", ".ogg", ".flac", ".aif", ".aiff", ".m4a"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json",
  ".wav":  "audio/wav",
  ".mp3":  "audio/mpeg",
  ".ogg":  "audio/ogg",
  ".flac": "audio/flac",
  ".aif":  "audio/aiff",
  ".aiff": "audio/aiff",
  ".m4a":  "audio/mp4",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

/** Read + resolve the configured sample roots (absolute paths). */
function loadSampleRoots() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LIBRARY_CONFIG, "utf8"));
    const roots = Array.isArray(parsed?.roots) ? parsed.roots : [];
    return roots
      .filter((r) => r && typeof r.id === "string" && typeof r.path === "string")
      .map((r) => ({ id: r.id, label: r.label || r.id, path: path.resolve(r.path) }));
  } catch {
    return [];
  }
}

function jsonResponse(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

/** Resolve a (root id, relative path) pair to a safe absolute path. */
function resolveWithinRoot(rootId, relPath) {
  const root = loadSampleRoots().find((r) => r.id === rootId);
  if (!root) return { error: "unknown-root" };
  const safeRel = path.normalize(relPath || "").replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = path.join(root.path, safeRel);
  if (!abs.startsWith(root.path)) return { error: "out-of-root" };
  return { root, abs, rel: safeRel };
}

function handleSampleRoots(res) {
  const roots = loadSampleRoots().map((r) => ({
    id: r.id,
    label: r.label,
    available: fs.existsSync(r.path)
  }));
  jsonResponse(res, 200, { roots });
}

function handleSampleBrowse(res, query) {
  const rootId = query.get("root");
  const resolved = resolveWithinRoot(rootId, query.get("path") || "");
  if (resolved.error) return jsonResponse(res, 404, { error: resolved.error });
  let entries;
  try {
    entries = fs.readdirSync(resolved.abs, { withFileTypes: true });
  } catch {
    return jsonResponse(res, 404, { error: "not-a-directory" });
  }
  const dirs = [];
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const childRel = path.join(resolved.rel, entry.name);
    if (entry.isDirectory()) {
      dirs.push({ name: entry.name, rel: childRel });
    } else if (AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) {
      files.push({
        name: entry.name,
        rel: childRel,
        url: `/api/sample-file?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(childRel)}`
      });
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  jsonResponse(res, 200, { root: rootId, path: resolved.rel, dirs, files });
}

function handleSampleFile(res, query) {
  const resolved = resolveWithinRoot(query.get("root"), query.get("path") || "");
  if (resolved.error) return jsonResponse(res, 404, { error: resolved.error });
  fs.stat(resolved.abs, (err, stat) => {
    if (err || !stat.isFile()) return jsonResponse(res, 404, { error: "not-found" });
    const ext = path.extname(resolved.abs).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    fs.createReadStream(resolved.abs).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const urlPath = url.pathname;

  // ── Sample-library JSON API ────────────────────────────────
  if (urlPath === "/api/sample-roots") return handleSampleRoots(res);
  if (urlPath === "/api/sample-browse") return handleSampleBrowse(res, url.searchParams);
  if (urlPath === "/api/sample-file") return handleSampleFile(res, url.searchParams);

  // ── Static files ───────────────────────────────────────────
  const staticPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(ROOT, decodeURIComponent(staticPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end(`404 Not Found: ${urlPath}`);
      } else {
        res.writeHead(500); res.end("Server Error");
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(data);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  const roots = loadSampleRoots();
  console.log(`\n  ♪  Rhythm Artist dev server\n`);
  console.log(`  →  http://localhost:${PORT}/\n`);
  if (roots.length) {
    console.log("  Sample libraries:");
    for (const r of roots) {
      console.log(`    ${fs.existsSync(r.path) ? "✓" : "✗ (missing)"}  ${r.label}  →  ${r.path}`);
    }
    console.log("");
  }
});
