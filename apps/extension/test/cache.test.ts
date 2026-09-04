import { describe, expect, it } from "vitest";
import { analyzePost } from "@promolens/shared";
import { CACHE_PREFIX, ResultCache, type KeyValueStore } from "../src/background/cache.js";

function memoryStore(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(keys) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of data) if (keys === null || keys.includes(k)) out[k] = v;
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    async remove(keys) {
      for (const k of keys) data.delete(k);
    },
  };
}

const result = analyzePost({ title: "x" });
const HOUR = 3_600_000;

describe("ResultCache (chrome.storage.local backed)", () => {
  it("stores results under a hash key and returns them before expiry", async () => {
    const store = memoryStore();
    const cache = new ResultCache(store, () => 1_000);
    await cache.put("abc", result, 24 * HOUR);
    expect(store.data.has(CACHE_PREFIX + "abc")).toBe(true);
    expect(await cache.get("abc", 24 * HOUR)).toEqual(result);
  });

  it("expires entries after the TTL (24h by default) and removes them", async () => {
    let now = 0;
    const store = memoryStore();
    const cache = new ResultCache(store, () => now);
    await cache.put("abc", result, 24 * HOUR);
    now = 23 * HOUR;
    expect(await cache.get("abc", 24 * HOUR)).toBeDefined();
    now = 24 * HOUR + 1;
    expect(await cache.get("abc", 24 * HOUR)).toBeUndefined();
    expect(store.data.size).toBe(0);
  });

  it("respects a changed TTL at read time", async () => {
    let now = 0;
    const cache = new ResultCache(memoryStore(), () => now);
    await cache.put("abc", result, 24 * HOUR);
    now = 2 * HOUR;
    expect(await cache.get("abc", 1 * HOUR)).toBeUndefined();
  });

  it("prunes expired entries and caps the total", async () => {
    let now = 0;
    const store = memoryStore();
    const cache = new ResultCache(store, () => now, 2);
    await cache.put("old", result, HOUR);
    now = 10;
    await cache.put("a", result, HOUR);
    now = 20;
    await cache.put("b", result, HOUR);
    now = 30;
    await cache.put("c", result, HOUR);
    now = HOUR + 5; // "old" expired
    const removedCount = await cache.prune(HOUR);
    expect(removedCount).toBeGreaterThanOrEqual(2);
    expect(store.data.has(CACHE_PREFIX + "old")).toBe(false);
    expect(store.data.size).toBeLessThanOrEqual(2);
  });

  it("clear removes only PromoLens cache keys", async () => {
    const store = memoryStore();
    store.data.set("promolens:settings", { enabled: true });
    const cache = new ResultCache(store);
    await cache.put("a", result, HOUR);
    await cache.put("b", result, HOUR);
    expect(await cache.clear()).toBe(2);
    expect(store.data.has("promolens:settings")).toBe(true);
  });
});
