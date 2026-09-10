import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/server.js";
import { LicenseClient } from "../src/services/license.js";
import { QuotaStore } from "../src/services/quota.js";
import { RateLimiter } from "../src/services/rateLimit.js";

let server: Server;
let base: string;
const INSTALL = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const GOOD_KEY = "GOOD-KEY-1234-5678";

const config = loadConfig({
  PORT: "0",
  ALLOWED_ORIGINS: "chrome-extension://*",
  RATE_LIMIT_PER_MINUTE: "1000",
  MAX_BODY_BYTES: "65536",
  REQUEST_TIMEOUT_MS: "3000",
  ANALYSIS_PROVIDER: "mock",
  QUOTA_ENABLED: "true",
  FREE_INITIAL: "2",
  FREE_MONTHLY: "1",
  PLUS_MONTHLY: "100",
  LEMONSQUEEZY_PRODUCT_ID: "1350697",
});

const fakeLs: typeof fetch = async (url, init) => {
  const form = new URLSearchParams(String(init?.body));
  const ok = form.get("license_key") === GOOD_KEY;
  // Lemon Squeezy answers activate with `activated`, validate with `valid`.
  const flag = String(url).endsWith("/activate") ? { activated: true } : { valid: true };
  const body = ok
    ? { ...flag, error: null, license_key: { status: "active" }, instance: { id: "inst_1" }, meta: { product_id: 1350697 } }
    : { valid: false, error: "license_key not found." };
  return new Response(JSON.stringify(body), { status: 200 });
};

beforeAll(async () => {
  server = createApp(config, {
    log: () => undefined,
    rateLimiter: new RateLimiter(1000, 60_000),
    quota: new QuotaStore({ freeInitial: 2, freeMonthly: 1, plusMonthly: 100 }),
    license: new LicenseClient({ productId: 1350697, fetchFn: fakeLs }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const post = (n: number) => ({
  post: { title: `Post number ${n}`, body: "I'm the founder of HabitLoop. Try it at https://habitloop.app", links: ["https://habitloop.app"] },
  localSignals: [],
});

async function analyze(n: number, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/v1/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-promolens-install": INSTALL, ...headers },
    body: JSON.stringify(post(n)),
  });
}

describe("hosted tier", () => {
  it("requires an install id when metering is on", async () => {
    const res = await fetch(`${base}/api/v1/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(post(0)) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("missing_install_id");
  });

  it("reports the free allowance, meters analyses, and answers 402 when it is used up", async () => {
    const q0 = (await (await fetch(`${base}/api/v1/quota`, { headers: { "x-promolens-install": INSTALL } })).json()) as { plan: string; limit: number; remaining: number; licensed: boolean };
    expect(q0).toMatchObject({ plan: "free", limit: 2, remaining: 2, licensed: false });

    const r1 = await analyze(1);
    expect(r1.status).toBe(200);
    expect(r1.headers.get("x-promolens-quota-used")).toBe("1");
    expect(r1.headers.get("x-promolens-quota-limit")).toBe("2");
    expect(r1.headers.get("x-promolens-quota-plan")).toBe("free");
    expect((await analyze(2)).status).toBe(200);

    const r3 = await analyze(3);
    expect(r3.status).toBe(402);
    const body = (await r3.json()) as { error: { code: string; details: { quota: { remaining: number } } } };
    expect(body.error.code).toBe("quota_exceeded");
    expect(body.error.details.quota.remaining).toBe(0);
  });

  it("a cached repeat does not cost an analysis? (it does - one click, one analysis, keeps the rule simple)", async () => {
    // Documented behaviour: the server-side content cache saves model cost, but
    // the allowance counts clicks. The extension caches results itself for 24 h,
    // so a user re-opening the same post is not charged twice in practice.
    expect((await analyze(1)).status).toBe(402);
  });

  it("rejects bad licence keys with a helpful message and activates good ones", async () => {
    const bad = await fetch(`${base}/api/v1/license`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-promolens-install": INSTALL },
      body: JSON.stringify({ licenseKey: "NOPE-NOPE-NOPE-NOPE" }),
    });
    expect(bad.status).toBe(402);
    expect(((await bad.json()) as { error: { code: string; message: string } }).error).toMatchObject({ code: "license_not_found" });

    const good = await fetch(`${base}/api/v1/license`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-promolens-install": INSTALL },
      body: JSON.stringify({ licenseKey: GOOD_KEY }),
    });
    expect(good.status).toBe(200);
    expect((await good.json()) as object).toMatchObject({ plan: "plus", limit: 100, licensed: true });

    // Now analyses flow again on the Plus allowance
    const r = await analyze(4);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-promolens-quota-plan")).toBe("plus");

    // Detach -> back to free (and over the free limit)
    const off = await fetch(`${base}/api/v1/license`, { method: "DELETE", headers: { "x-promolens-install": INSTALL } });
    expect((await off.json()) as object).toMatchObject({ plan: "free", licensed: false });
    expect((await analyze(5)).status).toBe(402);
  });

  it("CORS preflight allows the install/licence headers", async () => {
    const res = await fetch(`${base}/api/v1/quota`, {
      method: "OPTIONS",
      headers: { origin: "chrome-extension://abc", "access-control-request-headers": "x-promolens-install" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toMatch(/X-PromoLens-Install/);
  });
});
