import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheKey, createCache, TTL, MAX_ENTRY_CHARS } from "../../js/cache.js";

/** Minimal in-memory Storage fake. */
class FakeStorage {
  constructor() {
    this.map = new Map();
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

/** Controllable clock. */
function clock(start = 1_000_000) {
  let t = start;
  const fn = () => t;
  fn.advance = (ms) => {
    t += ms;
  };
  fn.set = (v) => {
    t = v;
  };
  return fn;
}

test("TTL constants", () => {
  assert.equal(TTL.forecast, 15 * 60 * 1000);
  assert.equal(TTL.air, 30 * 60 * 1000);
  assert.equal(TTL.geocoding, 30 * 24 * 60 * 60 * 1000);
});

test("cacheKey format", () => {
  assert.equal(cacheKey("forecast", 25.033, 121.5654), "om:v1:forecast:25.03,121.57");
  assert.equal(cacheKey("air", -33.8688, 151.2093), "om:v1:air:-33.87,151.21");
  assert.equal(cacheKey("forecast", 0, 0), "om:v1:forecast:0.00,0.00");
});

test("cacheKey rounding: toFixed(2) on doubles (24.155 -> 24.16, 1.005 -> 1.00)", () => {
  // Documented behaviour: rounding is toFixed(2) on the binary double.
  assert.equal(cacheKey("forecast", 24.155, 0), "om:v1:forecast:24.16,0.00");
  assert.equal(cacheKey("forecast", 24.16, 0), "om:v1:forecast:24.16,0.00");
  assert.equal(cacheKey("forecast", 24.154, 0), "om:v1:forecast:24.15,0.00");
  assert.equal(cacheKey("forecast", 1.005, 0), "om:v1:forecast:1.00,0.00");
  // Nearby points collapse to one key.
  assert.equal(cacheKey("forecast", 24.1601, 1), cacheKey("forecast", 24.1649, 1));
});

test("get returns null for a missing key", () => {
  const c = createCache({ storage: new FakeStorage(), now: clock() });
  assert.equal(c.get("om:v1:forecast:1.00,1.00"), null);
});

test("fresh vs stale by injected clock; stale still returned", () => {
  const now = clock(5000);
  const c = createCache({ storage: new FakeStorage(), now });
  const key = cacheKey("forecast", 1, 2);
  c.set(key, { t: 20 }, TTL.forecast);

  let r = c.get(key);
  assert.deepEqual(r, { value: { t: 20 }, savedAt: 5000, fresh: true });

  now.advance(TTL.forecast); // exactly at TTL is still fresh
  assert.equal(c.get(key).fresh, true);

  now.advance(1);
  r = c.get(key);
  assert.equal(r.fresh, false);
  assert.deepEqual(r.value, { t: 20 });
  assert.equal(r.savedAt, 5000);
});

test("set overwrites and refreshes savedAt", () => {
  const now = clock(1000);
  const c = createCache({ storage: new FakeStorage(), now });
  const key = cacheKey("air", 1, 1);
  c.set(key, 1, 100);
  now.advance(500);
  assert.equal(c.get(key).fresh, false);
  c.set(key, 2, 100);
  const r = c.get(key);
  assert.equal(r.value, 2);
  assert.equal(r.fresh, true);
  assert.equal(r.savedAt, 1500);
});

test("remove deletes an entry", () => {
  const c = createCache({ storage: new FakeStorage(), now: clock() });
  const key = cacheKey("air", 1, 1);
  c.set(key, "x", 1000);
  c.remove(key);
  assert.equal(c.get(key), null);
  c.remove(key); // removing again is fine
});

test("eviction keeps maxLocationsPerApi, oldest savedAt first", () => {
  const storage = new FakeStorage();
  const now = clock(1000);
  const c = createCache({ storage, now, maxLocationsPerApi: 3 });
  const keys = [1, 2, 3, 4, 5].map((i) => cacheKey("forecast", i, i));
  for (const k of keys.slice(0, 3)) {
    c.set(k, k, TTL.forecast);
    now.advance(10);
  }
  assert.equal(storage.length, 3);
  c.set(keys[3], "4", TTL.forecast);
  assert.equal(c.get(keys[0]), null, "oldest evicted");
  assert.notEqual(c.get(keys[1]), null);
  assert.notEqual(c.get(keys[2]), null);
  assert.notEqual(c.get(keys[3]), null);
  now.advance(10);
  c.set(keys[4], "5", TTL.forecast);
  assert.equal(c.get(keys[1]), null);
  assert.equal(storage.length, 3);
});

test("re-setting an existing key makes it newest (not evicted next)", () => {
  const storage = new FakeStorage();
  const now = clock(1000);
  const c = createCache({ storage, now, maxLocationsPerApi: 2 });
  const [a, b, d] = [1, 2, 3].map((i) => cacheKey("forecast", i, i));
  c.set(a, "a", 1000);
  now.advance(1);
  c.set(b, "b", 1000);
  now.advance(1);
  c.set(a, "a2", 1000); // a is now newest
  now.advance(1);
  c.set(d, "d", 1000);
  assert.equal(c.get(b), null);
  assert.equal(c.get(a).value, "a2");
  assert.notEqual(c.get(d), null);
});

test("new key is kept even when savedAt ties with older entries", () => {
  const storage = new FakeStorage();
  const c = createCache({ storage, now: clock(1000), maxLocationsPerApi: 2 });
  const keys = [1, 2, 3].map((i) => cacheKey("forecast", i, i));
  for (const k of keys) c.set(k, k, 1000);
  assert.equal(storage.length, 2);
  assert.notEqual(c.get(keys[2]), null);
});

test("eviction is isolated per api and ignores foreign keys", () => {
  const storage = new FakeStorage();
  const now = clock(1000);
  const c = createCache({ storage, now, maxLocationsPerApi: 2 });
  storage.setItem("unrelated", "keep me");
  const air = [1, 2].map((i) => cacheKey("air", i, i));
  for (const k of air) {
    c.set(k, k, 1000);
    now.advance(1);
  }
  const fc = [1, 2, 3, 4].map((i) => cacheKey("forecast", i, i));
  for (const k of fc) {
    c.set(k, k, 1000);
    now.advance(1);
  }
  // forecast trimmed to the two newest, air untouched.
  assert.equal(c.get(fc[0]), null);
  assert.equal(c.get(fc[1]), null);
  assert.notEqual(c.get(fc[2]), null);
  assert.notEqual(c.get(fc[3]), null);
  for (const k of air) assert.notEqual(c.get(k), null);
  assert.equal(storage.getItem("unrelated"), "keep me");
});

test("default maxLocationsPerApi is 5", () => {
  const storage = new FakeStorage();
  const now = clock(1000);
  const c = createCache({ storage, now });
  for (let i = 0; i < 8; i++) {
    c.set(cacheKey("forecast", i, i), i, 1000);
    now.advance(1);
  }
  assert.equal(storage.length, 5);
  assert.equal(c.get(cacheKey("forecast", 2, 2)), null);
  assert.notEqual(c.get(cacheKey("forecast", 3, 3)), null);
});

test("corrupt entries are evicted first", () => {
  const storage = new FakeStorage();
  const now = clock(1000);
  const c = createCache({ storage, now, maxLocationsPerApi: 2 });
  const bad = cacheKey("forecast", 9, 9);
  storage.setItem(bad, "{not json");
  const a = cacheKey("forecast", 1, 1);
  const b = cacheKey("forecast", 2, 2);
  c.set(a, "a", 1000);
  c.set(b, "b", 1000);
  assert.equal(storage.getItem(bad), null);
  assert.notEqual(c.get(a), null);
  assert.notEqual(c.get(b), null);
});

test("corrupt JSON entry returns null from get", () => {
  const storage = new FakeStorage();
  const c = createCache({ storage, now: clock() });
  const key = cacheKey("forecast", 1, 1);
  storage.setItem(key, "{not json");
  assert.equal(c.get(key), null);
  storage.setItem(key, "null");
  assert.equal(c.get(key), null);
  storage.setItem(key, '{"value":1}'); // missing savedAt
  assert.equal(c.get(key), null);
  storage.setItem(key, "42");
  assert.equal(c.get(key), null);
});

test("undefined storage degrades to a no-op", () => {
  const c = createCache({ storage: undefined, now: clock() });
  assert.doesNotThrow(() => c.set("om:v1:forecast:1.00,1.00", 1, 1000));
  assert.equal(c.get("om:v1:forecast:1.00,1.00"), null);
  assert.doesNotThrow(() => c.remove("om:v1:forecast:1.00,1.00"));
  assert.doesNotThrow(() => createCache({}));
});

test("storage that throws on getItem/setItem/removeItem never throws out", () => {
  const boom = () => {
    throw new Error("SecurityError");
  };
  const storage = { getItem: boom, setItem: boom, removeItem: boom, key: boom, length: 0 };
  const c = createCache({ storage, now: clock() });
  const key = cacheKey("forecast", 1, 1);
  assert.doesNotThrow(() => c.set(key, 1, 1000));
  assert.equal(c.get(key), null);
  assert.doesNotThrow(() => c.remove(key));
});

test("quota error on setItem evicts the oldest entry in the namespace and retries", () => {
  const storage = new FakeStorage();
  const now = clock(1000);
  const c = createCache({ storage, now });
  const a = cacheKey("forecast", 1, 1);
  const b = cacheKey("forecast", 2, 2);
  const other = cacheKey("air", 1, 1);
  c.set(a, "a", 1000);
  now.advance(1);
  c.set(b, "b", 1000);
  c.set(other, "air", 1000);
  const realSet = storage.setItem.bind(storage);
  let failures = 1;
  storage.setItem = (k, v) => {
    if (failures-- > 0) {
      const e = new Error("quota");
      e.name = "QuotaExceededError";
      throw e;
    }
    realSet(k, v);
  };
  now.advance(1);
  const key = cacheKey("forecast", 3, 3);
  assert.doesNotThrow(() => c.set(key, "new", 1000));
  assert.equal(c.get(a), null, "oldest evicted");
  assert.equal(c.get(b).value, "b");
  assert.equal(c.get(key).value, "new");
  assert.equal(c.get(other).value, "air", "other namespace untouched");
});

test("quota error: if the retry still fails, nothing throws and only the evicted entry is gone", () => {
  const storage = new FakeStorage();
  const now = clock(1000);
  const c = createCache({ storage, now, maxLocationsPerApi: 1 });
  const a = cacheKey("forecast", 1, 1);
  const other = cacheKey("air", 1, 1);
  c.set(a, "a", 1000);
  c.set(other, "air", 1000);
  storage.setItem = () => {
    throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
  };
  assert.doesNotThrow(() => c.set(cacheKey("forecast", 2, 2), "new", 1000));
  assert.equal(c.get(a), null, "the one evicted entry is gone");
  assert.equal(c.get(other).value, "air");
  assert.equal(c.get(cacheKey("forecast", 2, 2)), null);
});

test("quota error with nothing to evict leaves the existing entry for the same key intact", () => {
  const storage = new FakeStorage();
  const c = createCache({ storage, now: clock() });
  const key = cacheKey("forecast", 1, 1);
  c.set(key, "old", 1000);
  storage.setItem = () => {
    throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
  };
  assert.doesNotThrow(() => c.set(key, "new", 1000));
  assert.equal(c.get(key).value, "old");
});

test("savedAt in the future is never fresh", () => {
  const storage = new FakeStorage();
  const now = clock(10_000);
  const c = createCache({ storage, now });
  const key = cacheKey("forecast", 1, 1);
  c.set(key, "v", 1000);
  now.set(5_000); // clock moved backwards: savedAt (10_000) is in the future
  assert.equal(c.get(key).fresh, false);
  assert.equal(c.get(key).value, "v");
  now.set(10_000);
  assert.equal(c.get(key).fresh, true);
});

test("cacheKey never contains -0.00", () => {
  assert.equal(cacheKey("forecast", -0.001, -0), "om:v1:forecast:0.00,0.00");
  assert.equal(cacheKey("forecast", -0.004, 0.004), "om:v1:forecast:0.00,0.00");
  assert.equal(cacheKey("forecast", -0.01, 1), "om:v1:forecast:-0.01,1.00");
});

test("eviction failure (removeItem throws) does not throw", () => {
  const storage = new FakeStorage();
  const now = clock(1000);
  const c = createCache({ storage, now, maxLocationsPerApi: 1 });
  c.set(cacheKey("forecast", 1, 1), 1, 1000);
  now.advance(1);
  storage.removeItem = () => {
    throw new Error("nope");
  };
  assert.doesNotThrow(() => c.set(cacheKey("forecast", 2, 2), 2, 1000));
});

test("non-serialisable value does not throw", () => {
  const c = createCache({ storage: new FakeStorage(), now: clock() });
  const cyc = {};
  cyc.self = cyc;
  const key = cacheKey("forecast", 1, 1);
  assert.doesNotThrow(() => c.set(key, cyc, 1000));
  assert.equal(c.get(key), null);
});

/** Fill a forecast namespace with n entries and return their keys. */
function seed(c, now, n) {
  const keys = [];
  for (let i = 0; i < n; i++) {
    const k = cacheKey("forecast", i, i);
    c.set(k, "v" + i, 1000);
    now.advance(1);
    keys.push(k);
  }
  return keys;
}

test("MAX_ENTRY_CHARS is exported", () => {
  assert.equal(MAX_ENTRY_CHARS, 1_500_000);
});

test("oversize payload is not written and evicts nothing", () => {
  const storage = new FakeStorage();
  const now = clock(1000);
  const c = createCache({ storage, now });
  const keys = seed(c, now, 5);
  let setCalls = 0;
  const realSet = storage.setItem.bind(storage);
  storage.setItem = (k, v) => { setCalls++; realSet(k, v); };
  assert.doesNotThrow(() => c.set(cacheKey("forecast", 99, 99), "x".repeat(MAX_ENTRY_CHARS + 1), 1000));
  assert.equal(setCalls, 0, "no write attempted");
  for (const k of keys) assert.notEqual(c.get(k), null, "entry kept");
  assert.equal(c.get(cacheKey("forecast", 99, 99)), null);
});

test("non-quota error (SecurityError) gives up immediately and evicts nothing", () => {
  const storage = new FakeStorage();
  const now = clock(1000);
  const c = createCache({ storage, now });
  const keys = seed(c, now, 3);
  storage.setItem = () => {
    const e = new Error("denied");
    e.name = "SecurityError";
    throw e;
  };
  assert.doesNotThrow(() => c.set(cacheKey("forecast", 99, 99), "new", 1000));
  for (const k of keys) assert.notEqual(c.get(k), null, "entry kept");
});

test("quota detected via legacy code 22 / Firefox name / code 1014", () => {
  for (const err of [{ code: 22 }, { name: "NS_ERROR_DOM_QUOTA_REACHED" }, { code: 1014 }]) {
    const storage = new FakeStorage();
    const now = clock(1000);
    const c = createCache({ storage, now });
    const [a] = seed(c, now, 2);
    const realSet = storage.setItem.bind(storage);
    let fail = 1;
    storage.setItem = (k, v) => {
      if (fail-- > 0) throw Object.assign(new Error("q"), err);
      realSet(k, v);
    };
    const key = cacheKey("forecast", 99, 99);
    c.set(key, "new", 1000);
    assert.equal(c.get(a), null, "oldest evicted for " + JSON.stringify(err));
    assert.equal(c.get(key).value, "new");
  }
});

// ---- per-api limits -------------------------------------------------------------------------

test("default limits: geocoding keeps 30 entries (a multi-variant search must not evict the cache), other apis keep 5", () => {
  const storage = new FakeStorage();
  const now = clock(1000);
  const c = createCache({ storage, now });
  const geo = (i) => `om:v1:geocoding:zh:8:q${i}`;
  for (let i = 0; i < 32; i++) {
    c.set(geo(i), i, 1000);
    now.advance(1);
  }
  const kept = [...Array(32).keys()].filter((i) => c.get(geo(i)));
  assert.equal(kept.length, 30);
  assert.deepEqual([kept[0], kept.at(-1)], [2, 31], "oldest two evicted");
  for (let i = 0; i < 8; i++) {
    c.set(cacheKey("forecast", i, i), i, 1000);
    now.advance(1);
  }
  assert.equal(storage.length, 30 + 5, "forecast is still trimmed to 5 and does not touch geocoding");
});

test("a place search writes up to 4 variant entries without pushing out earlier searches", () => {
  const storage = new FakeStorage();
  const now = clock(1000);
  const c = createCache({ storage, now });
  for (let s = 0; s < 5; s++) {
    for (const v of ["", "臺", "市", "臺市"]) {
      c.set(`om:v1:geocoding:zh:8:s${s}${v}`, [], 1000);
      now.advance(1);
    }
  }
  assert.equal(storage.length, 20, "5 searches x 4 variants all stay (the old limit of 5 kept barely one search)");
  assert.notEqual(c.get("om:v1:geocoding:zh:8:s0"), null);
});

test("maxLocationsPerApi object: per-api overrides, `default` for the rest, unnamed falls back to 5", () => {
  const storage = new FakeStorage();
  const now = clock(1000);
  const c = createCache({ storage, now, maxLocationsPerApi: { air: 2, default: 3 } });
  for (let i = 0; i < 6; i++) {
    c.set(cacheKey("air", i, i), i, 1000);
    c.set(cacheKey("forecast", i, i), i, 1000);
    c.set(`om:v1:geocoding:zh:8:q${i}`, i, 1000);
    now.advance(1);
  }
  const count = (ns) => [...Array(storage.length).keys()].filter((i) => storage.key(i).startsWith(`om:v1:${ns}:`)).length;
  assert.deepEqual([count("air"), count("forecast"), count("geocoding")], [2, 3, 3]);
  const d = createCache({ storage: new FakeStorage(), now, maxLocationsPerApi: { air: 2 } });
  for (let i = 0; i < 8; i++) d.set(cacheKey("forecast", i, i), i, 1000);
  assert.equal(d.get(cacheKey("forecast", 2, 2)), null);
  assert.notEqual(d.get(cacheKey("forecast", 3, 3)), null, "unnamed api keeps the default of 5");
});

test("a number still applies to every api; invalid values fall back to the default", () => {
  const now = clock(1000);
  const s1 = new FakeStorage();
  const c = createCache({ storage: s1, now, maxLocationsPerApi: 2 });
  for (let i = 0; i < 5; i++) { c.set(`om:v1:geocoding:zh:8:q${i}`, i, 1000); now.advance(1); }
  assert.equal(s1.length, 2, "the number wins over the geocoding default");
  const s2 = new FakeStorage();
  const bad = createCache({ storage: s2, now, maxLocationsPerApi: { forecast: 0, default: "x" } });
  for (let i = 0; i < 8; i++) { bad.set(cacheKey("forecast", i, i), i, 1000); now.advance(1); }
  assert.equal(s2.length, 5);
});
