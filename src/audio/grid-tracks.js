// Pure grid-track id logic.
//
// The sequencer grid is driven by a list of track ids (`state.gridTrackIds`).
// Some are base registry voices ("eightOhEightClap"); others are independent
// *instances* of an instanceable voice ("eightOhEightClap~ab12"). These helpers
// own the ordering, reconciliation and labeling rules for that id list as pure
// functions — they take everything they need as arguments and never touch the
// editor's `state`, the DOM, or the audio engine, so they're trivially testable.

/** Per-track config maps that mirror the grid-track id list. */
export const TRACK_CONFIG_MAP_KEYS = [
  "trackShapes",
  "trackBusSends",
  "trackReverbSends",
  "trackLevels",
  "trackPans",
  "trackOptionDefaults",
  "trackDefaultVelocities",
  "trackSamples",
  "trackStepCounts"
];

/**
 * Order grid track ids by registry order, keeping each instance directly after
 * its base voice (and after earlier instances of the same base). Unknown ids
 * sink to the end.
 *
 * @param {string[]} ids
 * @param {object} deps
 * @param {string[]} deps.registryIds Base voice ids in registry order.
 * @param {(id: string) => string} deps.baseTrackId Map an id to its base voice id.
 * @param {(id: string) => boolean} deps.isInstanceId Whether an id is an instance.
 * @returns {string[]} A new, ordered array.
 */
export function orderGridTrackIds(ids, { registryIds, baseTrackId, isInstanceId }) {
  const rank = (id) => {
    const idx = registryIds.indexOf(baseTrackId(id));
    return idx === -1 ? registryIds.length : idx;
  };
  return [...ids].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    // Same base: the base id comes before its instances; instances keep their
    // relative order via id comparison for a stable layout.
    const aInstance = isInstanceId(a);
    const bInstance = isInstanceId(b);
    if (aInstance !== bInstance) return aInstance ? 1 : -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/**
 * Compute the visible grid-track id list for a loaded config: the default
 * tracks, plus any registry track that actually has notes in the loaded bars,
 * plus any *instance* track referenced by the bars or per-track config maps.
 *
 * @param {object} config The editor config (patterns + per-track maps).
 * @param {object} deps
 * @param {string[]} deps.registryIds Base voice ids in registry order.
 * @param {string[]} deps.defaultIds Default grid track ids.
 * @param {string[]} [deps.hiddenIds] Track ids the user removed from the grid.
 * @param {(id: string) => boolean} deps.isInstanceId
 * @param {(id: string) => any} deps.getTrackDef Resolve a track id to its def (or null).
 * @param {(id: string) => string} deps.baseTrackId
 * @returns {string[]} Ordered grid track ids.
 */
export function reconcileGridTrackIds(config, { registryIds, defaultIds, hiddenIds = [], isInstanceId, getTrackDef, baseTrackId }) {
  const wanted = new Set(defaultIds);
  const hidden = new Set(hiddenIds);
  const loadedBars = config?.patterns?.jazz?.bars ?? [];
  registryIds.forEach((id) => {
    const hasNotes = loadedBars.some((bar) => Array.isArray(bar?.[id]) && bar[id].length > 0);
    if (hasNotes) wanted.add(id);
  });
  // Surface instance tracks referenced in bars or per-track config maps so
  // added 808 instances come back visible after a reload.
  const instanceIds = new Set();
  loadedBars.forEach((bar) => {
    Object.keys(bar || {}).forEach((key) => {
      if (isInstanceId(key) && getTrackDef(key)) instanceIds.add(key);
    });
  });
  TRACK_CONFIG_MAP_KEYS.forEach((mapKey) => {
    Object.keys(config?.[mapKey] || {}).forEach((key) => {
      if (isInstanceId(key) && getTrackDef(key)) instanceIds.add(key);
    });
  });
  instanceIds.forEach((id) => wanted.add(id));
  hidden.forEach((id) => wanted.delete(id));
  return orderGridTrackIds([...wanted], { registryIds, baseTrackId, isInstanceId });
}

/**
 * A display label for a track id: the base label, plus a 1-based ordinal suffix
 * for instances (e.g. "808 Clap 2"), based on its position among same-base peers.
 *
 * @param {string} id
 * @param {string[]} gridTrackIds Current grid id list (for peer ordering).
 * @param {object} deps
 * @param {Record<string, string>} deps.trackLabels Base id → label map.
 * @param {(id: string) => string} deps.baseTrackId
 * @param {(id: string) => boolean} deps.isInstanceId
 * @returns {string}
 */
export function instanceLabelFor(id, gridTrackIds, { trackLabels, baseTrackId, isInstanceId }) {
  const base = trackLabels[baseTrackId(id)] || baseTrackId(id);
  if (!isInstanceId(id)) return base;
  const peers = gridTrackIds.filter((g) => baseTrackId(g) === baseTrackId(id));
  const index = peers.indexOf(id);
  return index >= 0 ? `${base} ${index + 1}` : base;
}

/**
 * Immutably drop a track id from every per-track config map. Returns a shallow
 * clone of `config` with replaced maps (only the maps that actually changed).
 *
 * @param {object} config
 * @param {string} trackId
 * @returns {object} A new config object.
 */
export function removeTrackFromConfigMaps(config, trackId) {
  const next = { ...config };
  TRACK_CONFIG_MAP_KEYS.forEach((mapKey) => {
    if (next?.[mapKey]?.[trackId] !== undefined) {
      const map = { ...next[mapKey] };
      delete map[trackId];
      next[mapKey] = map;
    }
  });
  if (next?.trackPluginSources?.[trackId] !== undefined) {
    const map = { ...next.trackPluginSources };
    delete map[trackId];
    next.trackPluginSources = map;
  }
  if (next?.trackPluginParams?.[trackId] !== undefined) {
    const map = { ...next.trackPluginParams };
    delete map[trackId];
    next.trackPluginParams = map;
  }
  if (next?.trackAutomationParams && typeof next.trackAutomationParams === "object") {
    const map = { ...next.trackAutomationParams };
    delete map[`grid:${trackId}`];
    delete map[`piano:${trackId}`];
    delete map[`wave:${trackId}`];
    next.trackAutomationParams = map;
  }
  if (next?.trackAutomationCurves && typeof next.trackAutomationCurves === "object") {
    const map = { ...next.trackAutomationCurves };
    delete map[`grid:${trackId}`];
    delete map[`piano:${trackId}`];
    delete map[`wave:${trackId}`];
    next.trackAutomationCurves = map;
  }
  return next;
}

const replaceIdInUniqueArray = (value, oldId, newId) => {
  if (!Array.isArray(value)) return value;
  const seen = new Set();
  const out = [];
  value.forEach((id) => {
    const nextId = id === oldId ? newId : id;
    if (seen.has(nextId)) return;
    seen.add(nextId);
    out.push(nextId);
  });
  return out;
};

const uniqueArray = (value) => {
  if (!Array.isArray(value)) return value;
  return [...new Set(value.filter(Boolean))];
};

const replaceKeyInMap = (value, oldId, newId) => {
  if (!value || typeof value !== "object" || value[oldId] === undefined) return value;
  const next = { ...value };
  next[newId] = next[oldId];
  delete next[oldId];
  return next;
};

const replaceLaneKeyTrackId = (key, oldId, newId) => {
  const oldGrid = `grid:${oldId}`;
  const oldPiano = `piano:${oldId}`;
  const oldWave = `wave:${oldId}`;
  if (key === oldGrid) return `grid:${newId}`;
  if (key === oldPiano) return `piano:${newId}`;
  if (key === oldWave) return `wave:${newId}`;
  return key;
};

const replaceLaneKeysInMap = (value, oldId, newId) => {
  if (!value || typeof value !== "object") return value;
  let changed = false;
  const next = {};
  Object.entries(value).forEach(([key, mapValue]) => {
    const nextKey = replaceLaneKeyTrackId(key, oldId, newId);
    if (nextKey !== key) changed = true;
    next[nextKey] = mapValue;
  });
  return changed ? next : value;
};

const replaceMidiControlTrackId = (map, oldId, newId) => {
  if (!map || typeof map !== "object") return map;
  const oldPrefix = `track.${oldId}.`;
  const newPrefix = `track.${newId}.`;
  let changed = false;
  const next = {};
  Object.entries(map).forEach(([paramId, mapping]) => {
    const targetId = paramId.startsWith(oldPrefix)
      ? `${newPrefix}${paramId.slice(oldPrefix.length)}`
      : paramId;
    if (targetId !== paramId) changed = true;
    next[targetId] = mapping;
  });
  return changed ? next : map;
};

/**
 * Immutably rename a track id across the project config. This keeps notes,
 * per-track mix/sample/shape maps, piano-roll lane heights, MIDI maps, and
 * visual lane order together when the UI changes a row's instrument.
 *
 * @param {object} config
 * @param {string} oldId
 * @param {string} newId
 * @returns {object}
 */
export function replaceTrackIdInConfig(config, oldId, newId) {
  if (!config || !oldId || !newId || oldId === newId) return config;
  const next = { ...config };

  const bars = config.patterns?.jazz?.bars;
  if (Array.isArray(bars)) {
    next.patterns = { ...(config.patterns || {}) };
    next.patterns.jazz = { ...(config.patterns?.jazz || {}) };
    next.patterns.jazz.bars = bars.map((bar) => {
      if (!bar || typeof bar !== "object" || !(oldId in bar)) return bar;
      const row = { ...bar };
      const oldHits = Array.isArray(row[oldId]) ? row[oldId] : [];
      const existing = Array.isArray(row[newId]) ? row[newId] : [];
      row[newId] = existing.length ? [...existing, ...oldHits] : oldHits;
      delete row[oldId];
      return row;
    });
  }

  TRACK_CONFIG_MAP_KEYS.forEach((mapKey) => {
    next[mapKey] = replaceKeyInMap(next[mapKey], oldId, newId);
  });

  [
    "trackViewTrackIds",
    "hiddenGridTrackIds",
    "pianoRollTracks",
    "soloTracks",
    "mutedTracks"
  ].forEach((arrayKey) => {
    next[arrayKey] = replaceIdInUniqueArray(next[arrayKey], oldId, newId);
  });

  next.pianoRollLaneHeights = replaceKeyInMap(next.pianoRollLaneHeights, oldId, newId);
  next.pianoRollAutomationHeights = replaceKeyInMap(next.pianoRollAutomationHeights, oldId, newId);
  next.trackAutomationParams = replaceLaneKeysInMap(next.trackAutomationParams, oldId, newId);
  next.trackAutomationCurves = replaceLaneKeysInMap(next.trackAutomationCurves, oldId, newId);
  next.midiNoteMap = replaceKeyInMap(next.midiNoteMap, oldId, newId);
  next.midiControlMap = replaceMidiControlTrackId(next.midiControlMap, oldId, newId);

  if (Array.isArray(next.editorLaneOrder)) {
    next.editorLaneOrder = uniqueArray(
      next.editorLaneOrder.map((key) => replaceLaneKeyTrackId(key, oldId, newId))
    );
  }

  return next;
}
