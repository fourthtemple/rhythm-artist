/**
 * rhythm-events.js
 *
 * Tiny typed event emitter used by RhythmEngine and RhythmAPI.
 * Keeps zero dependencies and no framework requirements.
 *
 * Supported event names (string literals):
 *   "beat"     – fires every sequencer step (16 per bar)
 *   "bar"      – fires at the start of each bar (step 0)
 *   "phrase"   – fires at bar 0 of each 32-bar phrase loop
 *   "section"  – fires when the pattern style (intensity tier) changes
 *   "play"     – engine transitions from stopped → playing
 *   "stop"     – engine transitions from playing → stopped
 *   "config"   – config was replaced via setConfig()
 */

export class RhythmEventEmitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void} unsubscribe function
   */
  on(event, handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Subscribe once — auto-removed after the first invocation.
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void} unsubscribe function
   */
  once(event, handler) {
    const wrapper = (payload) => {
      handler(payload);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }

  /**
   * Unsubscribe a specific handler.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    this._handlers.get(event)?.delete(handler);
  }

  /**
   * Remove ALL handlers for every event (or one specific event).
   * @param {string} [event]
   */
  removeAll(event) {
    if (event) this._handlers.delete(event);
    else this._handlers.clear();
  }

  /**
   * Internal – fire all handlers for an event.
   * @param {string} event
   * @param {*} payload
   */
  emit(event, payload) {
    const handlers = this._handlers.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try { handler(payload); } catch (err) { console.error(`[RhythmEvents] "${event}" handler threw:`, err); }
    }
  }
}
