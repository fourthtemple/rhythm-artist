/**
 * dev-server.mjs
 * Zero-dependency static dev server for rhythm-artist.
 *
 * User mode only serves the app and bundled assets. Project persistence lives
 * in the user's browser storage.
 *
 * Edit-default mode is a local authoring tool: it loads the bundled default
 * project and allows saving that one JSON file back into assets/projects.
 */

import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HOST = "127.0.0.1";
const LOCAL_ENV_PATH = path.join(ROOT, ".rhythm-artist-dev.env");
const DEDICATED_PORT_MIN = 49152;
const DEDICATED_PORT_MAX = 65535;
const PROJECT_SCHEMA = "rhythm-artist/project@1";
const DEFAULT_PROJECT_NAME = "Default Project";
const DEFAULT_PROJECT_PATH = path.join(ROOT, "assets", "projects", "default-project.rhythm-project.json");

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

const MODE = argValue("mode", "user") === "edit-default" ? "edit-default" : "user";
const CAN_EDIT_DEFAULT = MODE === "edit-default";
const parsePort = (value) => {
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : null;
};
const explicitPortValue = argValue("port", process.env.RHYTHM_ARTIST_PORT || process.env.PORT || "");
const EXPLICIT_PORT = explicitPortValue ? parsePort(explicitPortValue) : null;

function randomDedicatedPort(exclusions = new Set()) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = crypto.randomInt(DEDICATED_PORT_MIN, DEDICATED_PORT_MAX + 1);
    if (!exclusions.has(port)) return port;
  }
  return 0;
}

function readDedicatedPort() {
  try {
    const source = fs.readFileSync(LOCAL_ENV_PATH, "utf8");
    const match = source.match(/^\s*RHYTHM_ARTIST_PORT\s*=\s*(\d+)\s*$/m);
    const port = match ? parsePort(match[1]) : null;
    return port >= DEDICATED_PORT_MIN ? port : null;
  } catch {
    return null;
  }
}

function writeDedicatedPort(port) {
  if (!port) return;
  fs.writeFileSync(LOCAL_ENV_PATH, `RHYTHM_ARTIST_PORT=${port}\n`);
}

function dedicatedPort(exclusions = new Set()) {
  const stored = readDedicatedPort();
  if (stored && !exclusions.has(stored)) return stored;
  const port = randomDedicatedPort(exclusions);
  writeDedicatedPort(port);
  return port;
}

let requestedPort = EXPLICIT_PORT ?? dedicatedPort();
let portIsExplicit = EXPLICIT_PORT !== null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".m4a": "audio/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("request-too-large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function wrapDefaultProject(payload, name = DEFAULT_PROJECT_NAME) {
  const source = payload?.schema === PROJECT_SCHEMA && payload.config
    ? payload
    : {
      schema: PROJECT_SCHEMA,
      name,
      samplePacks: ["default-pack"],
      config: payload
    };
  return {
    ...source,
    name: source.name || name,
    savedAt: new Date().toISOString()
  };
}

async function saveDefaultProject(req, res) {
  if (!CAN_EDIT_DEFAULT) {
    sendText(res, 404, "Not Found");
    return;
  }
  try {
    const body = await readJsonBody(req);
    const project = wrapDefaultProject(body.project ?? body, body.name || DEFAULT_PROJECT_NAME);
    fs.mkdirSync(path.dirname(DEFAULT_PROJECT_PATH), { recursive: true });
    fs.writeFileSync(DEFAULT_PROJECT_PATH, `${JSON.stringify(project, null, 2)}\n`);
    sendJson(res, 200, {
      ok: true,
      project: {
        name: project.name,
        savedAt: project.savedAt,
        path: "assets/projects/default-project.rhythm-project.json"
      }
    });
  } catch (error) {
    sendJson(res, error.message === "request-too-large" ? 413 : 400, {
      ok: false,
      error: error.message || "save-failed"
    });
  }
}

function safeStaticPath(urlPath) {
  const staticPath = urlPath === "/" ? "/index.html" : urlPath;
  let decoded = "";
  try {
    decoded = decodeURIComponent(staticPath);
  } catch {
    return null;
  }
  const filePath = path.join(ROOT, decoded);
  return filePath === ROOT || filePath.startsWith(`${ROOT}${path.sep}`) ? filePath : null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/__rhythm-local/mode" && req.method === "GET") {
    sendJson(res, 200, {
      mode: MODE,
      canSaveDefaultProject: CAN_EDIT_DEFAULT,
      preferBundledDefault: CAN_EDIT_DEFAULT
    });
    return;
  }

  if (url.pathname === "/__rhythm-local/default-project" && req.method === "POST") {
    void saveDefaultProject(req, res);
    return;
  }

  if (url.pathname.startsWith("/__rhythm-local/")) {
    sendText(res, 404, "Not Found");
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method Not Allowed");
    return;
  }

  const filePath = safeStaticPath(url.pathname);
  if (!filePath) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendText(res, 404, `404 Not Found: ${url.pathname}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Access-Control-Allow-Origin": "*"
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
});

function listen(port) {
  server.listen(port, HOST);
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && !portIsExplicit) {
    const takenPort = requestedPort;
    const nextPort = dedicatedPort(new Set([takenPort]));
    requestedPort = nextPort;
    console.warn(`\n  Port ${takenPort} is busy; reserved ${nextPort} for Rhythm Artist instead.`);
    listen(nextPort);
    return;
  }
  throw error;
});

server.on("listening", () => {
  const address = server.address();
  const actualPort = address && typeof address === "object" ? address.port : requestedPort;
  console.log(`\n  ♪  Rhythm Artist static dev server (${MODE} mode)\n`);
  console.log(`  →  http://localhost:${actualPort}/\n`);
  if (!portIsExplicit) {
    console.log(`  Reserved local port: ${path.relative(ROOT, LOCAL_ENV_PATH)}\n`);
  }
  if (CAN_EDIT_DEFAULT) {
    console.log("  Default-project editing enabled for this local session.\n");
  }
});

listen(requestedPort);
