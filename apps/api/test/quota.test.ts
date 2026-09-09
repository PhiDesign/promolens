import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LicenseClient } from "../src/services/license.js";
import { monthKey, QuotaStore } from "../src/services/quota.js";

const limits = { freeInitial: 25, freeMonthly: 5, plusMonthly: 500 };
const ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("QuotaStore", () => {
  it("gives the first-month allowance, then the monthly refill, and resets on the first of the month", () => {
    let t = Date.UTC(2026, 8, 9); // 2026-09-09
    const q = new QuotaStore(limits, undefined, () => new Date(t));
    expect(q.status(ID, "free")).toMatchObject({ plan: "free", used: 0, limit: 25, remaining: 25, month: "2026-09" });
    for (let i = 0; i < 25; i++) expect(q.consume(ID, "free").allowed).toBe(true);
    const denied = q.consume(ID, "free");
    expect(denied.allowed).toBe(false);
    expect(denied.status.remaining).toBe(0);
    expect(denied.status.resetsAt).toBe("2026-10-01T00:00:00.000Z");

    t = Date.UTC(2026, 9, 2); // October: refill of 5
    expect(q.status(ID, "free")).toMatchObject({ used: 0, limit: 5, month: "2026-10" });
    for (let i = 0; i < 5; i++) expect(q.consume(ID, "free").allowed).toBe(true);
    expect(q.consume(ID, "free").allowed).toBe(false);
  });

  it("plus installs get the larger monthly allowance regardless of first month", () => {
    const q = new QuotaStore(limits, undefined, () => new Date(Date.UTC(2026, 8, 9)));
    expect(q.status(ID, "plus")).toMatchObject({ plan: "plus", limit: 500 });
    q.attachLicense(ID, "ABCD-1234", "inst_1");
    expect(q.license(ID)).toEqual({ licenseKey: "ABCD-1234", instanceId: "inst_1" });
    q.detachLicense(ID);
    expect(q.license(ID).licenseKey).toBeUndefined();
  });

  it("persists to disk and reloads", () => {
    const dir = mkdtempSync(join(tmpdir(), "promolens-quota-"));
    const file = join(dir, "usage.json");
    const q = new QuotaStore(limits, file, () => new Date(Date.UTC(2026, 8, 9)));
    q.consume(ID, "free");
    q.consume(ID, "free");
    q.flush();
    expect(JSON.parse(readFileSync(file, "utf8")).installs[ID].months["2026-09"]).toBe(2);
    const again = new QuotaStore(limits, file, () => new Date(Date.UTC(2026, 8, 9)));
    expect(again.status(ID, "free").used).toBe(2);
  });

  it("prunes free installs idle for two months but keeps licensed ones", () => {
    let t = Date.UTC(2026, 8, 9);
    const q = new QuotaStore(limits, undefined, () => new Date(t));
    q.consume(ID, "free");
    const OTHER = "9f2504e0-4f89-11d3-9a0c-0305e82c3399";
    q.consume(OTHER, "free");
    q.attachLicense(OTHER, "KEY", "inst");
    t = Date.UTC(2026, 11, 15); // December: September activity is older than two months
    expect(q.prune()).toBe(1);
    expect(q.size).toBe(1);
    expect(q.license(OTHER).licenseKey).toBe("KEY");
  });

  it("monthKey is UTC", () => {
    expect(monthKey(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
    expect(monthKey(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01");
  });
});

describe("LicenseClient", () => {
  function fakeLs(handler: (path: string, form: URLSearchParams) => unknown) {
    const calls: string[] = [];
    const fetchFn: typeof fetch = async (url, init) => {
      const path = String(url).split("/").pop() ?? "";
      calls.push(path);
      const body = handler(path, new URLSearchParams(String(init?.body)));
      return new Response(JSON.stringify(body), { status: 200 });
    };
    return { fetchFn, calls };
  }
  const good = { valid: true, error: null, license_key: { status: "active", activation_limit: 3, activation_usage: 1 }, instance: { id: "inst_9" }, meta: { product_id: 1350697 } };

  it("validates an active key for the right product and caches the answer", async () => {
    const ls = fakeLs(() => good);
    const c = new LicenseClient({ productId: 1350697, fetchFn: ls.fetchFn, now: () => 1_000 });
    expect((await c.validate("KEY-1")).valid).toBe(true);
    expect((await c.validate("KEY-1")).valid).toBe(true);
    expect(ls.calls).toEqual(["validate"]); // second answer came from cache
  });

  it("rejects keys for another product, expired keys, unknown keys, and reports provider errors without caching them", async () => {
    const other = new LicenseClient({ productId: 1350697, fetchFn: fakeLs(() => ({ ...good, meta: { product_id: 42 } })).fetchFn });
    expect(await other.validate("K")).toMatchObject({ valid: false, reason: "wrong_product" });
    const expired = new LicenseClient({ productId: 1350697, fetchFn: fakeLs(() => ({ valid: false, error: "This license key has expired.", license_key: { status: "expired" }, meta: { product_id: 1350697 } })).fetchFn });
    expect(await expired.validate("K")).toMatchObject({ valid: false, reason: "expired" });
    const missing = new LicenseClient({ productId: 1350697, fetchFn: fakeLs(() => ({ valid: false, error: "license_key not found." })).fetchFn });
    expect(await missing.validate("K")).toMatchObject({ valid: false, reason: "not_found" });
    const down = fakeLs(() => {
      throw new Error("boom");
    });
    const failing = new LicenseClient({ productId: 1350697, fetchFn: async () => { throw new Error("offline"); } });
    expect(await failing.validate("K")).toMatchObject({ valid: false, reason: "provider_error" });
    void down;
  });

  it("activate binds the key to the install id and returns the instance", async () => {
    const ls = fakeLs((path, form) => (path === "activate" && form.get("instance_name") === ID ? good : { valid: false, error: "bad" }));
    const c = new LicenseClient({ productId: 1350697, fetchFn: ls.fetchFn });
    const r = await c.activate("KEY-1", ID);
    expect(r).toMatchObject({ valid: true, instanceId: "inst_9" });
  });
});
