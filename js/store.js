/**
 * Tiny observable state store.
 */

/**
 * Create a store holding a plain object.
 * @param {object} [initial={}] Initial state (shallow-copied).
 * @returns {{get: () => object, set: (partial: object) => void, subscribe: (fn: (state: object) => void) => () => void}}
 *   `set` shallow-merges and synchronously notifies subscribers;
 *   `subscribe` returns an unsubscribe function.
 */
export function createStore(initial = {}) {
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
        if (listeners.has(entry)) entry.fn(state);
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
