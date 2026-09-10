import { describe, expect, it } from "vitest";
import { LicenseClient } from "../../api/src/services/license.js";
import { MockProvider } from "../../api/src/services/providers/mock.js";
import { buildRuntime, handle, type Env } from "../src/index.js";
import type { KvLike } from "../src/kvQuota.js";

const ID = "5d1a2f2e-7b1c-4c1f-9e3b-2a0f6c1d8e90";
const GOOD_KEY = "AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD";

function fakeKv(): KvLike & { map: Map<string, { value: string; ttl?: number }> } {
  const map = new Map<string, { value: string; ttl?: number }>();
  return {
    map,
    async get(key) {
      const e = map.get(key);
      return e ? JSON.parse(e.value) : null;
    },
    async put(key, value, options) {
      map.set(key, { value, ttl: options?.expirationTtl });
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

const fakeLs: typeof fetch = async (url, init) => {
  const form = new URLSearchParams(String(init?.body));
  const ok = form.get("license_key") === GOOD_KEY;
  const flag = String(url).endsWith("/activate") ? { activated: true } : { valid: true };
  const body = ok ? { ...flag, error: null, license_key: { status: "active" }, instance: { id: "inst_1" }, meta: { product_id: 1350697 } } : { valid: false, error: "license_key not found." };
  return new Response(JSON.stringify(body), { status: 200 });
};

function makeRuntime(kv: KvLike, extra: Record<string, string> = {}) {
  const env: Env = {
    USAGE: kv,
    ANALYSIS_PROVIDER: "mock",
    QUOTA_ENABLED: "true",
    FREE_INITIAL: "2",
    FREE_MONTHLY: "1",
    PLUS_MONTHLY: "100",
    LEMONSQUEEZY_PRODUCT_ID: "1350697",
    ALLOWED_ORIGINS: "chrome-extension://*",
    ...extra,
  };
  return buildRuntime(env, { provider: new MockProvider(), license: new LicenseClient({ productId: 1350697, fetchFn: fakeLs }) });
}

const post = { title: "I built a habit tracker", body: "I'm the founder of HabitLoop. Try it at https://habitloop.app", links: ["https://habitloop.app"] };

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://promolens-api.example.workers.dev${path}`, {
    method,
    headers: { "content-type": "application/json", origin: "chrome-extension://abc", "x-promolens-install": ID, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("worker: hosted tier on KV", () => {
  it("serves health with CORS for an allowed origin", async () => {
    const rt = makeRuntime(fakeKv());
    const res = await handle(req("GET", "/api/v1/health"), rt);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("chrome-extension://abc");
    expect((await res.json()).provider).toBe("mock");
  });

  it("answers preflight, and refuses it for a foreign origin", async () => {
    const rt = makeRuntime(fakeKv());
    expect((await handle(req("OPTIONS", "/api/v1/analyze"), rt)).status).toBe(204);
    expect((await handle(req("OPTIONS", "/api/v1/analyze", undefined, { origin: "https://evil.example" }), rt)).status).toBe(403);
  });

  it("meters analyses per install, persists to KV with an expiry, and walls at 402", async () => {
    const kv = fakeKv();
    const rt = makeRuntime(kv);
    const q0 = await (await handle(req("GET", "/api/v1/quota"), rt)).json();
    expect(q0).toMatchObject({ plan: "free", used: 0, limit: 2, licensed: false });

    const a1 = await handle(req("POST", "/api/v1/analyze", { post }), rt);
    expect(a1.status).toBe(200);
    expect(a1.headers.get("x-promolens-quota-used")).toBe("1");
    expect(kv.map.get(`install:${ID}`)?.ttl).toBeGreaterThan(0);

    // Same content again is served from the cache but still counts (the extension caches on its side).
    await handle(req("POST", "/api/v1/analyze", { post: { ...post, title: "Another" } }), rt);
    const a3 = await handle(req("POST", "/api/v1/analyze", { post: { ...post, title: "Third" } }), rt);
    expect(a3.status).toBe(402);
    expect((await a3.json()).error.code).toBe("quota_exceeded");
    const q = await (await handle(req("GET", "/api/v1/quota"), rt)).json();
    expect(q).toMatchObject({ used: 2, remaining: 0 });
  });

  it("refunds the reservation when the provider fails", async () => {
    const kv = fakeKv();
    const env: Env = { USAGE: kv, ANALYSIS_PROVIDER: "mock", QUOTA_ENABLED: "true", FREE_INITIAL: "2", LEMONSQUEEZY_PRODUCT_ID: "1350697" };
    const rt = buildRuntime(env, {
      provider: { name: "boom", analyze: async () => { throw new Error("down"); } },
      license: new LicenseClient({ productId: 1350697, fetchFn: fakeLs }),
    });
    const res = await handle(req("POST", "/api/v1/analyze", { post }), rt);
    expect(res.status).toBe(502);
    const q = await (await handle(req("GET", "/api/v1/quota"), rt)).json();
    expect(q.used).toBe(0);
  });

  it("activates a Plus licence (Lemon Squeezy 'activated' flag), raises the limit, and detaches", async () => {
    const kv = fakeKv();
    const rt = makeRuntime(kv);
    const bad = await handle(req("POST", "/api/v1/license", { licenseKey: "AAAAAAAA-BBBBBBBB-CCCCCCCC-EEEEEEEE" }), rt);
    expect(bad.status).toBe(402);
    expect((await bad.json()).error.code).toBe("license_not_found");

    const ok = await handle(req("POST", "/api/v1/license", { licenseKey: GOOD_KEY }), rt);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ plan: "plus", limit: 100, licensed: true });
    // Plus records must not expire on their own.
    expect(kv.map.get(`install:${ID}`)?.ttl).toBeUndefined();

    const a = await handle(req("POST", "/api/v1/analyze", { post }), rt);
    expect(a.headers.get("x-promolens-quota-plan")).toBe("plus");

    const off = await handle(req("DELETE", "/api/v1/license"), rt);
    expect(await off.json()).toMatchObject({ plan: "free", licensed: false });
  });

  it("rejects a missing install id, bad JSON and oversized bodies", async () => {
    const rt = makeRuntime(fakeKv(), { MAX_BODY_BYTES: "200" });
    expect((await handle(req("GET", "/api/v1/quota", undefined, { "x-promolens-install": "nope" }), rt)).status).toBe(400);
    const badJson = new Request("https://x/api/v1/analyze", { method: "POST", headers: { "content-type": "application/json", "x-promolens-install": ID }, body: "{" });
    expect((await handle(badJson, rt)).status).toBe(400);
    const big = await handle(req("POST", "/api/v1/analyze", { post: { ...post, body: "x".repeat(500) } }), rt);
    expect(big.status).toBe(413);
  });
});
