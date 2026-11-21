/**
 * localStorage-backed cache with TTL, stale-while-revalidate reads and
 * per-API eviction. All storage failures degrade to a no-op.
 */

const PREFIX = "om:v1:";

/**
 * Default time-to-live values in milliseconds.
 * @type {{forecast: number, air: number, geocoding: number}}
 */
export const TTL = Object.freeze({
  forecast: 15 * 60 * 1000,
  air: 30 * 60 * 1000,
  geocoding: 30 * 24 * 60 * 60 * 1000,
});

/**
 * Build a cache key. Coordinates are rounded with `Number.prototype.toFixed(2)`,
 * so nearby points share a key. toFixed operates on the binary double, so
 * rounding at exact midpoints depends on representation: 24.155 -> "24.16"
 * (its double is slightly above .155) while 1.005 -> "1.00" (slightly below).
 * @param {string} api Namespace, e.g. "forecast".
 * @param {number} lat
 * @param {number} lon
 * @returns {string} `om:v1:{api}:{lat},{lon}`
 */
export function cacheKey(api, lat, lon) {
  return `${PREFIX}${api}:${lat.toFixed(2)},${lon.toFixed(2)}`;
}

/**
 * Namespace prefix ("om:v1:{api}:") of a cache key, or null if not ours.
 * @param {string} key
 * @returns {string|null}
 */
function namespaceOf(key) {
  if (typeof key !== "string" || !key.startsWith(PREFIX)) return null;
  const i = key.indexOf(":", PREFIX.length);
  return i === -1 ? null : key.slice(0, i + 1);
}

/**
 * Parse a stored entry; null when missing or corrupt.
 * @param {string|null} raw
 * @returns {{value: *, savedAt: number, ttlMs: number}|null}
 */
function parseEntry(raw) {
  if (typeof raw !== "string") return null;
  try {
    const e = JSON.parse(raw);
    if (!e || typeof e !== "object" || typeof e.savedAt !== "number" || !("value" in e)) return null;
    return { value: e.value, savedAt: e.savedAt, ttlMs: typeof e.ttlMs === "number" ? e.ttlMs : 0 };
  } catch {
    return null;
  }
}

/**
 * Create a cache over a Storage-like object.
 * @param {object} [options]
 * @param {Storage|undefined} [options.storage] getItem/setItem/removeItem/key/length; may be undefined or throw.
 * @param {() => number} [options.now] Clock returning epoch ms.
 * @param {number} [options.maxLocationsPerApi=5] Max keys kept per api namespace.
 * @returns {{get: (key: string) => ({value: *, savedAt: number, fresh: boolean}|null), set: (key: string, value: *, ttlMs: number) => void, remove: (key: string) => void}}
 */
export function createCache({ storage, now = () => Date.now(), maxLocationsPerApi = 5 } = {}) {
  /**
   * Collect all storage keys within an api namespace prefix.
   * @param {string} ns
   * @returns {string[]}
   */
  function keysIn(ns) {
    const out = [];
    const n = storage.length;
    for (let i = 0; i < n; i++) {
      const k = storage.key(i);
      if (typeof k === "string" && k.startsWith(ns)) out.push(k);
    }
    return out;
  }

  return {
    /**
     * Read an entry. Stale entries are still returned (`fresh: false`).
     * @param {string} key
     * @returns {{value: *, savedAt: number, fresh: boolean}|null} null when missing, corrupt or storage fails.
     */
    get(key) {
      if (!storage) return null;
      try {
        const e = parseEntry(storage.getItem(key));
        if (!e) return null;
        return { value: e.value, savedAt: e.savedAt, fresh: now() - e.savedAt <= e.ttlMs };
      } catch {
        return null;
      }
    },
    /**
     * Write an entry and evict the oldest in the same api namespace so at most
     * `maxLocationsPerApi` remain. Never throws.
     * @param {string} key
     * @param {*} value JSON-serialisable value.
     * @param {number} ttlMs Time-to-live in ms.
     * @returns {void}
     */
    set(key, value, ttlMs) {
      if (!storage) return;
      try {
        storage.setItem(key, JSON.stringify({ value, savedAt: now(), ttlMs }));
      } catch {
        return;
      }
      try {
        const ns = namespaceOf(key);
        if (!ns) return;
        const entries = keysIn(ns).map((k) => {
          const e = parseEntry(storage.getItem(k));
          return { k, savedAt: e ? e.savedAt : -Infinity };
        });
        if (entries.length <= maxLocationsPerApi) return;
        // Oldest first (corrupt entries first of all); the just-written key
        // loses ties so it is never the one evicted.
        entries.sort((a, b) => {
          if (a.savedAt !== b.savedAt) return a.savedAt < b.savedAt ? -1 : 1;
          return (a.k === key) - (b.k === key);
        });
        for (const { k } of entries.slice(0, entries.length - maxLocationsPerApi)) {
          storage.removeItem(k);
        }
      } catch {
        /* eviction is best-effort */
      }
    },
    /**
     * Delete an entry. Never throws.
     * @param {string} key
     * @returns {void}
     */
    remove(key) {
      if (!storage) return;
      try {
        storage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}
