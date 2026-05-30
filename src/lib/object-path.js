// Pure helpers for reading and writing nested object values by a dotted
// string path (e.g. "patterns.jazz.bpm"). These have no dependency on editor
// state, which keeps them trivial to unit test in isolation.

/**
 * Read the value at `path` within `root`, returning `undefined` if any
 * segment along the way is missing. Does not throw on absent intermediates.
 */
export function getPathValue(root, path) {
  return path.split(".").reduce((target, key) => target?.[key], root);
}

/**
 * Write `value` at `path` within `root`, mutating the object in place. The
 * parent objects along the path are assumed to already exist. Returns `root`
 * for convenient chaining.
 */
export function setPathValue(root, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((next, key) => next[key], root);
  target[last] = value;
  return root;
}
