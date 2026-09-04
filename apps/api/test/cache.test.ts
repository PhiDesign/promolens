import { describe, expect, it } from "vitest";
import { analyzePost } from "@promolens/shared";
import { MemoryCache } from "../src/services/cache.js";
import { RateLimiter } from "../src/services/rateLimit.js";

const result = analyzePost({ title: "x" });

describe("MemoryCache", () => {
  it("returns entries until they expire", async () => {
    let now = 1_000;
    const cache = new MemoryCache(100, () => now);
    await cache.set("h1", result, 500);
    expect((await cache.get("h1"))?.result).toBe(result);
    now = 1_499;
    expect(await cache.get("h1")).toBeDefined();
    now = 1_500;
    expect(await cache.get("h1")).toBeUndefined();
    expect(await cache.size()).toBe(0);
  });

  it("evicts the oldest entry when full", async () => {
    const cache = new MemoryCache(2);
    await cache.set("a", result, 10_000);
    await cache.set("b", result, 10_000);
    await cache.set("c", result, 10_000);
    expect(await cache.get("a")).toBeUndefined();
    expect(await cache.get("c")).toBeDefined();
  });

  it("clears everything", async () => {
    const cache = new MemoryCache();
    await cache.set("a", result, 10_000);
    await cache.clear();
    expect(await cache.size()).toBe(0);
  });
});

describe("RateLimiter", () => {
  it("allows up to the limit inside the window, then blocks until it slides", () => {
    let now = 0;
    const rl = new RateLimiter(2, 1000, () => now);
    expect(rl.check("k").allowed).toBe(true);
    expect(rl.check("k").allowed).toBe(true);
    const blocked = rl.check("k");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    now = 1001;
    expect(rl.check("k").allowed).toBe(true);
  });

  it("keeps clients separate", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("b").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
  });
});
