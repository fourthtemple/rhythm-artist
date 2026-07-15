#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_WADSPA_ROOT = path.resolve(PROJECT_ROOT, "..", "wadspa");
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, "assets", "wadspa", "catalog.json");
const ASSET_EXTENSIONS = new Set([".js", ".json", ".wasm"]);

function readArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function scanBalancedObject(source, openIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, index + 1);
    }
  }
  return "";
}

export function extractMetaObject(source) {
  const marker = "export const meta";
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const openIndex = source.indexOf("{", markerIndex);
  if (openIndex < 0) return null;
  const objectSource = scanBalancedObject(source, openIndex);
  if (!objectSource) return null;
  return JSON.parse(objectSource);
}

const countPorts = (ports, predicate) =>
  ports.filter((port) => port && predicate(port)).length;

const isInput = (port) => port.dir === "input";
const isOutput = (port) => port.dir === "output";
const isAudio = (port) => port.type === "audio";
const isMidiLike = (port) => port.type === "midi";
const isControl = (port) => port.type === "control";

export function classifyWadspaPlugin(meta = {}) {
  const ports = Array.isArray(meta.ports) ? meta.ports : [];
  const audioInputs = countPorts(ports, (port) => isInput(port) && isAudio(port));
  const audioOutputs = countPorts(ports, (port) => isOutput(port) && isAudio(port));
  const midiInputs = countPorts(ports, (port) => isInput(port) && isMidiLike(port));
  const controlInputs = countPorts(ports, (port) => isInput(port) && isControl(port));
  const kind = midiInputs > 0 && audioOutputs > 0
    ? "instrument"
    : audioInputs > 0 && audioOutputs > 0
      ? "effect"
      : "utility";
  return { kind, audioInputs, audioOutputs, midiInputs, controlInputs };
}

export function compactParameters(meta = {}, maxParameters = 256) {
  return (Array.isArray(meta.ports) ? meta.ports : [])
    .filter((port) => isInput(port) && isControl(port))
    .slice(0, maxParameters)
    .map((port) => ({
      index: port.index,
      symbol: port.symbol,
      name: port.name || port.symbol,
      min: port.min,
      max: port.max,
      default: port.default,
      integer: Boolean(port.integer),
      enumeration: Boolean(port.enumeration),
      logarithmic: Boolean(port.logarithmic),
      scalePoints: Array.isArray(port.scalePoints)
        ? port.scalePoints
            .filter((point) => point && typeof point === "object")
            .map((point) => ({
              label: typeof point.label === "string" ? point.label : String(point.value),
              value: point.value
            }))
        : []
    }));
}

function pluginEntry(wadspaRoot, pluginDir) {
  const indexPath = path.join(pluginDir, "dist", "index.js");
  const source = fs.readFileSync(indexPath, "utf8");
  const meta = extractMetaObject(source);
  if (!meta) return null;
  const classification = classifyWadspaPlugin(meta);
  const slug = path.basename(pluginDir);
  const distPath = path.join(pluginDir, "dist");
  const wasmFile = fs.readdirSync(distPath).find((file) => path.extname(file) === ".wasm") || "";
  return {
    id: `wadspa:${slug}`,
    slug,
    kind: classification.kind,
    name: meta.name || meta.label || slug,
    label: meta.label || slug,
    uri: meta.uri || "",
    modulePath: path.relative(wadspaRoot, indexPath).split(path.sep).join("/"),
    assetPath: `plugins/${slug}`,
    processorFile: "processor.js",
    wasmFile,
    audioInputs: classification.audioInputs,
    audioOutputs: classification.audioOutputs,
    midiInputs: classification.midiInputs,
    controlInputs: classification.controlInputs,
    parameters: compactParameters(meta)
  };
}

function copyPluginAssets(wadspaRoot, outputRoot, plugins) {
  const pluginsOutput = path.join(outputRoot, "plugins");
  fs.rmSync(pluginsOutput, { recursive: true, force: true });
  fs.mkdirSync(pluginsOutput, { recursive: true });
  plugins.forEach((plugin) => {
    if (!plugin.slug || plugin.kind === "error") return;
    const sourceDir = path.join(wadspaRoot, "plugins", plugin.slug, "dist");
    if (!fs.existsSync(sourceDir)) return;
    const targetDir = path.join(pluginsOutput, plugin.slug);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.readdirSync(sourceDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && ASSET_EXTENSIONS.has(path.extname(entry.name)))
      .forEach((entry) => {
        fs.copyFileSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
      });
  });
}

export function buildWadspaCatalog({ wadspaRoot = DEFAULT_WADSPA_ROOT } = {}) {
  const pluginsRoot = path.join(wadspaRoot, "plugins");
  const plugins = fs.readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(pluginsRoot, entry.name))
    .filter((pluginDir) => fs.existsSync(path.join(pluginDir, "dist", "index.js")))
    .map((pluginDir) => {
      try {
        return pluginEntry(wadspaRoot, pluginDir);
      } catch (error) {
        return {
          id: `wadspa:${path.basename(pluginDir)}`,
          slug: path.basename(pluginDir),
          kind: "error",
          name: path.basename(pluginDir),
          label: path.basename(pluginDir),
          error: error.message || "catalog-error"
        };
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  const summary = plugins.reduce((acc, plugin) => {
    acc.total += 1;
    acc[plugin.kind] = (acc[plugin.kind] || 0) + 1;
    return acc;
  }, { total: 0, instrument: 0, effect: 0, utility: 0, error: 0 });

  return {
    schema: "rhythm-artist/wadspa-catalog@1",
    generatedAt: new Date().toISOString(),
    sourceRoot: "~/wadspa",
    summary,
    plugins
  };
}

async function main() {
  const wadspaRoot = path.resolve(readArg("root", process.env.WADSPA_ROOT || DEFAULT_WADSPA_ROOT));
  const output = path.resolve(readArg("out", DEFAULT_OUTPUT));
  const catalog = buildWadspaCatalog({ wadspaRoot });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  copyPluginAssets(wadspaRoot, path.dirname(output), catalog.plugins);
  fs.writeFileSync(output, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Wrote ${catalog.summary.total} WADSPA plugins to ${path.relative(PROJECT_ROOT, output)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
