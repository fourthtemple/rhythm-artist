const ASSET_VERSION = Date.now().toString(36);
const A1_MIDI_NOTE = 33;
const loadedWorkletModules = new WeakMap();

const normalizeKey = (name) =>
  String(name).toLowerCase().replace(/[\s_()[\]-]+/g, "");

const symbolName = (name) =>
  String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const clamp = (value, min, max, fallback = 0) => {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
};

const clamp01 = (value) => clamp(value, 0, 1, 0);

function cacheBustedUrl(url) {
  const resolved = new URL(url, globalThis.location?.href ?? import.meta.url);
  resolved.searchParams.set("wadspa_v", ASSET_VERSION);
  return resolved.href;
}

function assetUrl(source, fileName) {
  const assetPath = String(source?.assetPath || `plugins/${source?.slug || ""}`)
    .replace(/^\/+|\/+$/g, "");
  const safeFile = String(fileName || "").replace(/^\/+/g, "");
  return new URL(`../../assets/wadspa/${assetPath}/${safeFile}`, import.meta.url).href;
}

function controlMap(meta) {
  const controls = new Map();
  (meta.ports || [])
    .filter((port) => port.type === "control" && port.dir === "input")
    .forEach((port) => {
      [port.name, port.symbol, port.index].forEach((alias) => {
        if (alias !== undefined && alias !== null) controls.set(normalizeKey(alias), port);
      });
    });
  return controls;
}

function portList(source = {}) {
  const ports = [];
  for (let index = 0; index < Number(source.midiInputs || 0); index += 1) {
    ports.push({ index: ports.length, symbol: index ? `MIDI_IN_${index + 1}` : "MIDI_IN", name: "MIDI In", dir: "input", type: "midi" });
  }
  for (let index = 0; index < Number(source.audioInputs || 0); index += 1) {
    ports.push({ index: ports.length, symbol: index ? `INPUT_${index + 1}` : "INPUT", name: "Audio In", dir: "input", type: "audio" });
  }
  for (let index = 0; index < Number(source.audioOutputs || 0); index += 1) {
    ports.push({ index: ports.length, symbol: index ? `OUTPUT_${index + 1}` : "OUTPUT", name: "Audio Out", dir: "output", type: "audio" });
  }
  (Array.isArray(source.parameters) ? source.parameters : []).forEach((parameter) => {
    ports.push({
      ...parameter,
      index: Number.isFinite(Number(parameter.index)) ? Number(parameter.index) : ports.length,
      symbol: parameter.symbol,
      name: parameter.name || parameter.symbol,
      dir: "input",
      type: "control"
    });
  });
  return ports;
}

function moduleForSource(source = {}) {
  const processorFile = source.processorFile || "processor.js";
  const wasmFile = source.wasmFile || "";
  return {
    meta: {
      label: source.label || source.slug || source.id,
      name: source.name || source.label || source.slug || "WADSPA Plugin",
      ports: portList(source)
    },
    processorUrl: assetUrl(source, processorFile),
    wasmUrl: assetUrl(source, wasmFile)
  };
}

function shouldScaleBySampleRate(port, value, ctx) {
  if (!ctx || !port.sampleRate || !Number.isFinite(value)) return false;
  const min = Number(port.min);
  const max = Number(port.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return true;
  return value >= Math.min(min, max) && value <= Math.max(min, max);
}

async function loadPlugin(ctx, pluginModule) {
  const { meta, wasmUrl, processorUrl } = pluginModule;
  if (!meta || !wasmUrl || !processorUrl) {
    throw new Error("WADSPA plugin module requires meta, wasmUrl, and processorUrl");
  }

  const wasmBytes = await fetch(cacheBustedUrl(wasmUrl), { cache: "no-cache" }).then((response) => {
    if (!response.ok) throw new Error(`Failed to fetch WADSPA WASM: ${response.status} ${wasmUrl}`);
    return response.arrayBuffer();
  });

  const workletUrl = cacheBustedUrl(processorUrl);
  let loaded = loadedWorkletModules.get(ctx);
  if (!loaded) {
    loaded = new Set();
    loadedWorkletModules.set(ctx, loaded);
  }
  if (!loaded.has(workletUrl)) {
    await ctx.audioWorklet.addModule(workletUrl);
    loaded.add(workletUrl);
  }

  const audioIn = meta.ports.filter((port) => port.type === "audio" && port.dir === "input");
  const audioOut = meta.ports.filter((port) => port.type === "audio" && port.dir === "output");
  const ctrlIn = meta.ports.filter((port) => port.type === "control" && port.dir === "input");
  const stereoOut = audioOut.length === 2;
  const stereoIn = stereoOut && audioIn.length === 2;
  const inputCount = audioIn.length === 0 ? 1 : (stereoIn ? 1 : audioIn.length);
  const outputCount = stereoOut ? 2 : (audioOut.length || 1);
  const workletNode = new AudioWorkletNode(ctx, `wadspa-${meta.label}`, {
    numberOfInputs: inputCount,
    numberOfOutputs: outputCount,
    outputChannelCount: Array(outputCount).fill(1),
    ...(stereoIn ? { channelCount: 2, channelCountMode: "explicit" } : {})
  });

  const inBufs = audioIn.map((port) => `_shim_input_buf_${symbolName(port.name)}`);
  const outBufs = audioOut.map((port) => `_shim_output_buf_${symbolName(port.name)}`);
  const setters = Object.fromEntries(ctrlIn.map((port) => [port.index, `_shim_set_${symbolName(port.name)}`]));
  const hasMidi = meta.ports.some((port) => port.type === "midi" && port.dir === "input");

  await new Promise((resolve, reject) => {
    const failTimer = globalThis.setTimeout(() => reject(new Error(`Timed out loading WADSPA plugin ${meta.label}`)), 5000);
    workletNode.port.onmessage = ({ data }) => {
      if (data.type === "ready") {
        globalThis.clearTimeout(failTimer);
        resolve();
      }
      if (data.type === "error") {
        globalThis.clearTimeout(failTimer);
        reject(new Error(data.message));
      }
    };
    workletNode.port.postMessage({ type: "setup", wasm: wasmBytes, inBufs, outBufs, setters }, [wasmBytes]);
  });

  let outputNode = workletNode;
  if (stereoOut) {
    const merger = ctx.createChannelMerger(2);
    workletNode.connect(merger, 0, 0);
    workletNode.connect(merger, 1, 1);
    outputNode = merger;
  }
  return new WadspaNode(workletNode, outputNode, meta, hasMidi, ctx);
}

class WadspaNode {
  constructor(workletNode, outputNode, meta, hasMidi, ctx) {
    this.node = workletNode;
    this.output = outputNode;
    this.meta = meta;
    this.hasMidi = hasMidi;
    this.ctx = ctx;
    this.controls = controlMap(meta);
  }

  set(portName, value) {
    const port = this.controls.get(normalizeKey(portName));
    if (!port) return this;
    const numeric = Number(value);
    const scaled = shouldScaleBySampleRate(port, numeric, this.ctx) ? numeric * this.ctx.sampleRate : numeric;
    this.node.port.postMessage(
      port.symbol
        ? { type: "set", symbol: port.symbol, value: scaled }
        : { type: "set", index: port.index, value: scaled }
    );
    return this;
  }

  midi(status, data1, data2 = 0) {
    if (!this.hasMidi) return this;
    this.node.port.postMessage({ type: "midi", status, data1, data2 });
    return this;
  }

  noteOn(note, velocity = 100, channel = 0) {
    return this.midi(0x90 | channel, note, velocity);
  }

  noteOff(note, channel = 0) {
    return this.midi(0x80 | channel, note, 0);
  }

  disconnect() {
    try {
      this.node.disconnect();
    } catch (_) {
      /* already disconnected */
    }
    try {
      this.output.disconnect();
    } catch (_) {
      /* already disconnected */
    }
  }
}

export function midiNoteForPitchOffset(pitch = 0) {
  return Math.round(clamp(A1_MIDI_NOTE + Number(pitch || 0), 0, 127, A1_MIDI_NOTE));
}

export class WadspaPluginHost {
  constructor({ context, engine, output, delaySend = null, reverbSend = null } = {}) {
    this.context = context;
    this.engine = engine;
    this.output = output;
    this.delaySend = delaySend;
    this.reverbSend = reverbSend;
    this.config = {};
    this.instances = new Map();
    this.pendingLoads = new Map();
    this.failedLoads = new Map();
    this.effectInstances = new Map();
    this.pendingEffectLoads = new Map();
    this.activeNotes = new Map();
  }

  setConfig(config = {}) {
    this.config = config || {};
    this.instances.forEach((entry, track) => {
      this.applyParams(track, entry);
      this.updateRoute(track, entry);
    });
    const activeEffects = new Set();
    Object.entries(this.config.trackPluginEffects || {}).forEach(([track, effects]) => {
      (Array.isArray(effects) ? effects : []).forEach((effect) => {
        if (effect?.effectId) activeEffects.add(this.effectKey(track, effect.effectId));
      });
    });
    this.effectInstances.forEach((entry, key) => {
      if (!activeEffects.has(key)) {
        entry.node.disconnect();
        this.effectInstances.delete(key);
        return;
      }
      const [track, effectId] = key.split("::");
      const effect = this.effectForTrack(track, effectId);
      if (effect) {
        this.applyEffectParams(track, effect, entry);
        this.updateEffectRoute(effect, entry);
      }
    });
  }

  sourceForTrack(track) {
    const source = this.config.trackPluginSources?.[track];
    return source && source.kind !== "effect" ? source : null;
  }

  async prepareTracks() {
    const tracks = Object.entries(this.config.trackPluginSources || {})
      .filter(([, source]) => source?.kind !== "effect")
      .map(([track]) => track);
    const effectLoads = Object.entries(this.config.trackPluginEffects || {}).flatMap(([track, effects]) =>
      (Array.isArray(effects) ? effects : []).map((effect) => this.ensureEffect(track, effect).catch(() => null))
    );
    await Promise.all([
      ...tracks.map((track) => this.ensureInstrument(track).catch(() => null)),
      ...effectLoads
    ]);
  }

  async ensureInstrument(track) {
    if (!this.context || !track) return null;
    const cached = this.instances.get(track);
    if (cached) return cached;
    if (this.pendingLoads.has(track)) return this.pendingLoads.get(track);
    const source = this.sourceForTrack(track);
    if (!source?.slug || !source?.wasmFile) return null;
    const pending = loadPlugin(this.context, moduleForSource(source))
      .then((node) => {
        const entry = this.createEntry(track, node);
        this.instances.set(track, entry);
        this.failedLoads.delete(track);
        this.pendingLoads.delete(track);
        this.applyParams(track, entry);
        this.updateRoute(track, entry);
        return entry;
      })
      .catch((error) => {
        console.warn(`Failed to load WADSPA plugin for ${track}`, error);
        this.failedLoads.set(track, error);
        this.pendingLoads.delete(track);
        return null;
      });
    this.pendingLoads.set(track, pending);
    return pending;
  }

  createEntry(track, node) {
    const outputGain = this.context.createGain();
    const levelGain = this.context.createGain();
    const dryPanner = typeof this.context.createStereoPanner === "function"
      ? this.context.createStereoPanner()
      : null;
    const delaySendGain = this.context.createGain();
    const reverbSendGain = this.context.createGain();
    outputGain.gain.value = 1;
    levelGain.gain.value = 1;
    delaySendGain.gain.value = 0;
    reverbSendGain.gain.value = 0;
    node.output.connect(outputGain);
    outputGain.connect(levelGain);
    if (dryPanner) {
      levelGain.connect(dryPanner);
      dryPanner.connect(this.output);
    } else {
      levelGain.connect(this.output);
    }
    if (this.delaySend) {
      outputGain.connect(delaySendGain);
      delaySendGain.connect(this.delaySend);
    }
    if (this.reverbSend) {
      outputGain.connect(reverbSendGain);
      reverbSendGain.connect(this.reverbSend);
    }
    return { node, outputGain, levelGain, dryPanner, delaySendGain, reverbSendGain, effectSendGains: new Map(), pendingEffectSendIds: new Set() };
  }

  updateRoute(track, entry) {
    if (!entry || !this.context) return;
    const now = this.context.currentTime;
    const level = this.engine?.trackLevel ? this.engine.trackLevel(track) : 1;
    const pan = this.engine?.trackPan ? this.engine.trackPan(track) : 0;
    const delaySend = this.engine?.trackBusSend ? this.engine.trackBusSend(track) : 0;
    const reverbSend = this.engine?.trackReverbSend ? this.engine.trackReverbSend(track) : 0;
    entry.levelGain.gain.setTargetAtTime(level, now, 0.01);
    entry.delaySendGain.gain.setTargetAtTime(delaySend, now, 0.02);
    entry.reverbSendGain.gain.setTargetAtTime(reverbSend, now, 0.02);
    if (entry.dryPanner) entry.dryPanner.pan.setTargetAtTime(pan, now, 0.01);
    this.updateInstrumentEffectSends(track, entry);
  }

  parameterValue(track, parameter) {
    const stored = this.config.trackPluginParams?.[track]?.[parameter.symbol];
    const fallback = Number.isFinite(Number(parameter.default)) ? Number(parameter.default) : 0;
    const min = Number.isFinite(Number(parameter.min)) ? Number(parameter.min) : -Infinity;
    const max = Number.isFinite(Number(parameter.max)) ? Number(parameter.max) : Infinity;
    const number = clamp(stored, min, max, fallback);
    return parameter.integer || parameter.enumeration ? Math.round(number) : number;
  }

  applyParams(track, entry = this.instances.get(track)) {
    const source = this.sourceForTrack(track);
    if (!source || !entry) return;
    (Array.isArray(source.parameters) ? source.parameters : []).forEach((parameter) => {
      if (!parameter?.symbol) return;
      entry.node.set(parameter.symbol, this.parameterValue(track, parameter));
    });
  }

  effectKey(track, effectId) {
    return `${track}::${effectId}`;
  }

  effectChainForTrack(track) {
    return Array.isArray(this.config.trackPluginEffects?.[track])
      ? this.config.trackPluginEffects[track]
      : [];
  }

  effectForTrack(track, effectId) {
    return this.effectChainForTrack(track).find((effect) => effect?.effectId === effectId) || null;
  }

  async ensureEffect(track, effect) {
    if (!this.context || !track || !effect?.effectId) return null;
    const key = this.effectKey(track, effect.effectId);
    const cached = this.effectInstances.get(key);
    if (cached) return cached;
    if (this.pendingEffectLoads.has(key)) return this.pendingEffectLoads.get(key);
    if (!effect?.slug || !effect?.wasmFile) return null;
    const pending = loadPlugin(this.context, moduleForSource(effect))
      .then((node) => {
        const entry = this.createEffectEntry(track, effect, node);
        this.effectInstances.set(key, entry);
        this.pendingEffectLoads.delete(key);
        this.applyEffectParams(track, effect, entry);
        this.updateEffectRoute(effect, entry);
        return entry;
      })
      .catch((error) => {
        console.warn(`Failed to load WADSPA effect for ${track}`, error);
        this.pendingEffectLoads.delete(key);
        return null;
      });
    this.pendingEffectLoads.set(key, pending);
    return pending;
  }

  createEffectEntry(_track, _effect, node) {
    const inputGain = this.context.createGain();
    const wetGain = this.context.createGain();
    inputGain.gain.value = 1;
    wetGain.gain.value = 1;
    inputGain.connect(node.node);
    node.output.connect(wetGain);
    wetGain.connect(this.output);
    return { node, inputGain, wetGain };
  }

  updateEffectRoute(effect, entry) {
    if (!entry || !this.context) return;
    const now = this.context.currentTime;
    entry.wetGain.gain.setTargetAtTime(effect?.bypass ? 0 : 1, now, 0.01);
  }

  effectParameterValue(track, effect, parameter) {
    const stored = this.config.trackPluginEffectParams?.[track]?.[effect.effectId]?.[parameter.symbol];
    const fallback = Number.isFinite(Number(parameter.default)) ? Number(parameter.default) : 0;
    const min = Number.isFinite(Number(parameter.min)) ? Number(parameter.min) : -Infinity;
    const max = Number.isFinite(Number(parameter.max)) ? Number(parameter.max) : Infinity;
    const number = clamp(stored, min, max, fallback);
    return parameter.integer || parameter.enumeration ? Math.round(number) : number;
  }

  applyEffectParams(track, effect, entry = this.effectInstances.get(this.effectKey(track, effect?.effectId))) {
    if (!effect || !entry) return;
    (Array.isArray(effect.parameters) ? effect.parameters : []).forEach((parameter) => {
      if (!parameter?.symbol) return;
      entry.node.set(parameter.symbol, this.effectParameterValue(track, effect, parameter));
    });
  }

  connectEffectSend(source, destination, amount, collector = null) {
    if (!this.context || !source || !destination) return null;
    const send = clamp01(amount);
    if (send <= 0.001) return null;
    const sendGain = this.context.createGain();
    sendGain.gain.value = send;
    source.connect(sendGain);
    sendGain.connect(destination);
    if (collector) collector.push(sendGain);
    return sendGain;
  }

  connectTrackEffectSends(source, track, collector = null) {
    this.effectChainForTrack(track).forEach((effect) => {
      if (!effect?.effectId || effect.bypass) return;
      const key = this.effectKey(track, effect.effectId);
      const entry = this.effectInstances.get(key);
      if (entry) {
        this.connectEffectSend(source, entry.inputGain, effect.send ?? 0.35, collector);
      } else {
        void this.ensureEffect(track, effect);
      }
    });
  }

  updateInstrumentEffectSends(track, entry) {
    if (!entry?.outputGain) return;
    const chain = this.effectChainForTrack(track).filter((effect) => effect?.effectId && !effect.bypass);
    const activeIds = new Set(chain.map((effect) => effect.effectId));
    entry.effectSendGains.forEach((sendGain, effectId) => {
      if (activeIds.has(effectId)) return;
      try { sendGain.disconnect(); } catch (_) { /* already disconnected */ }
      entry.effectSendGains.delete(effectId);
    });
    chain.forEach((effect) => {
      const existing = entry.effectSendGains.get(effect.effectId);
      if (existing) {
        existing.gain.setTargetAtTime(clamp01(effect.send ?? 0.35), this.context.currentTime, 0.01);
        return;
      }
      if (entry.pendingEffectSendIds.has(effect.effectId)) return;
      entry.pendingEffectSendIds.add(effect.effectId);
      void this.ensureEffect(track, effect).then((effectEntry) => {
        entry.pendingEffectSendIds.delete(effect.effectId);
        if (!effectEntry || entry.effectSendGains.has(effect.effectId) || !this.effectForTrack(track, effect.effectId)) return;
        const sendGain = this.context.createGain();
        sendGain.gain.value = clamp01(effect.send ?? 0.35);
        entry.outputGain.connect(sendGain);
        sendGain.connect(effectEntry.inputGain);
        entry.effectSendGains.set(effect.effectId, sendGain);
      });
    });
  }

  playNotes(track, notes, { time = this.context?.currentTime || 0, duration = 0.25, velocity = 0.7 } = {}) {
    const entry = this.instances.get(track);
    if (!entry) {
      void this.ensureInstrument(track);
      return false;
    }
    this.applyParams(track, entry);
    this.updateRoute(track, entry);
    const startDelay = Math.max(0, (time - this.context.currentTime) * 1000);
    const noteDuration = Math.max(0.025, duration);
    const midiVelocity = Math.max(1, Math.min(127, Math.round(clamp01(velocity) * 127)));
    const safeNotes = [...new Set((Array.isArray(notes) ? notes : [notes])
      .map((note) => Math.round(Number(note)))
      .filter((note) => Number.isFinite(note) && note >= 0 && note <= 127))];
    if (!safeNotes.length) return false;
    const active = this.activeNotes.get(track) || new Set();
    this.activeNotes.set(track, active);
    globalThis.setTimeout(() => {
      safeNotes.forEach((note) => {
        active.add(note);
        entry.node.noteOn(note, midiVelocity);
      });
      globalThis.setTimeout(() => {
        safeNotes.forEach((note) => {
          active.delete(note);
          entry.node.noteOff(note);
        });
      }, noteDuration * 1000);
    }, startDelay);
    return true;
  }

  stopAllNotes() {
    this.activeNotes.forEach((notes, track) => {
      const entry = this.instances.get(track);
      if (!entry) return;
      notes.forEach((note) => entry.node.noteOff(note));
      notes.clear();
    });
  }
}
