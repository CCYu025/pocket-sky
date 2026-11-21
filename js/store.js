/**
 * Tiny observable state store.
 */

/**
 * Create a store holding a plain object.
 * @param {object} [initial={}] Initial state (shallow-copied).
 * @param {object} [options]
 * @param {(error: *) => void} [options.onError] Called with anything a subscriber throws.
 *   Default rethrows asynchronously (`queueMicrotask(() => { throw e; })`) so the
 *   failure surfaces globally without breaking `set` or other subscribers.
 * @returns {{get: () => object, set: (partial: object) => void, subscribe: (fn: (state: object) => void) => () => void}}
 *   `set` shallow-merges and synchronously notifies subscribers (a throwing subscriber is isolated, see `onError`);
 *   `subscribe` returns an unsubscribe function.
 */
export function createStore(initial = {}, { onError = (e) => queueMicrotask(() => { throw e; }) } = {}) {
  let state = { ...initial };
  const listeners = new Set();

  return {
    /**
     * Current state snapshot.
     * @returns {object}
     */
    get() {
      return state;
    },
    /**
     * Shallow-merge a partial into state and notify subscribers synchronously.
     * @param {object} partial
     * @returns {void}
     */
    set(partial) {
      state = { ...state, ...partial };
      for (const entry of [...listeners]) {
        // A subscriber removed earlier in this pass is skipped.
        if (!listeners.has(entry)) continue;
        try {
          entry.fn(state);
        } catch (e) {
          onError(e);
        }
      }
    },
    /**
     * Register a listener called with the new state after each `set`.
     * @param {(state: object) => void} fn
     * @returns {() => void} Unsubscribe function (idempotent).
     */
    subscribe(fn) {
      const entry = { fn };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
  };
}
