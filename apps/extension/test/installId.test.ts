import { describe, expect, it } from "vitest";
import type { KeyValueStore } from "../src/background/cache.js";
import { getInstallId, INSTALL_ID_KEY } from "../src/background/installId.js";

function memoryStore(): KeyValueStore & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys) => (keys === null ? { ...data } : Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))),
    set: async (items) => void Object.assign(data, items),
    remove: async (keys) => keys.forEach((k) => delete data[k]),
  };
}

describe("install id", () => {
  it("is created once, is a UUID, and is reused afterwards", async () => {
    const store = memoryStore();
    const first = await getInstallId(store);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(store.data[INSTALL_ID_KEY]).toBe(first);
    expect(await getInstallId(store)).toBe(first);
  });

  it("replaces a corrupted value", async () => {
    const store = memoryStore();
    store.data[INSTALL_ID_KEY] = "not-a-uuid";
    const id = await getInstallId(store, () => "3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    expect(id).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
  });
});
