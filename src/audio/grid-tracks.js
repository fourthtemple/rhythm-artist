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
 * @param {string[]} deps.defaultIds Always-on default grid track ids.
 * @param {(id: string) => boolean} deps.isInstanceId
 * @param {(id: string) => any} deps.getTrackDef Resolve a track id to its def (or null).
 * @param {(id: string) => string} deps.baseTrackId
 * @returns {string[]} Ordered grid track ids.
 */
export function reconcileGridTrackIds(config, { registryIds, defaultIds, isInstanceId, getTrackDef, baseTrackId }) {
  const wanted = new Set(defaultIds);
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
  return next;
}
