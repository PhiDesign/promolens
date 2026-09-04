import { describe, expect, it } from "vitest";
import { fetchAuthorHistory, HistoryCache, type FetchLike } from "../src/background/history.js";
import type { KeyValueStore } from "../src/background/cache.js";

function fakeReddit(status: Record<string, number> = {}, opts: { suspended?: boolean } = {}): { fetchFn: FetchLike; urls: string[]; inits: RequestInit[] } {
  const urls: string[] = [];
  const inits: RequestInit[] = [];
  const listing = (children: unknown[]) => ({ data: { children: children.map((c) => ({ data: c })) } });
  const fetchFn: FetchLike = async (url, init) => {
    urls.push(url);
    inits.push(init ?? {});
    const path = url.split("/user/")[1] ?? "";
    const endpoint = ((path.split("?")[0] ?? "").split("/")[1] ?? "").split(".")[0] ?? "";
    const code = status[endpoint] ?? 200;
    const body = path.includes("about.json")
      ? { data: { created_utc: Date.now() / 1000 - 40 * 86400, link_karma: 12, comment_karma: 30, is_suspended: !!opts.suspended } }
      : path.includes("submitted.json")
        ? listing([
            { id: "a1", subreddit: "SEO", title: "Rankforge fixed my intent", is_self: false, url: "https://rankforge.io/?ref=x", domain: "rankforge.io", created_utc: 1, permalink: "/r/SEO/comments/a1/" },
            { id: "a2", subreddit: "blogging", title: "A self post", is_self: true, selftext: "x".repeat(500), domain: "self.blogging", created_utc: 2 },
            { title: "missing subreddit" },
          ])
        : listing([
            { subreddit: "SEO", body: "Try https://rankforge.io and also http://www.example.com/path", created_utc: 3, link_title: "Some thread" },
            { body: "no subreddit" },
          ]);
    return { status: code, ok: code < 300, json: async () => body };
  };
  return { fetchFn, urls, inits };
}

describe("fetchAuthorHistory", () => {
  it("parses public listings into a compact summary using the user's own session", async () => {
    const { fetchFn, urls, inits } = fakeReddit();
    const h = await fetchAuthorHistory("u/maya_writes", fetchFn);
    expect(h.available).toBe(true);
    expect(h.author).toBe("maya_writes");
    expect(urls.some((u) => u.includes("/user/maya_writes/submitted.json"))).toBe(true);
    expect(inits.every((i) => i.credentials === "include")).toBe(true);
    expect(h.submissions).toHaveLength(2);
    expect(h.submissions[0]).toMatchObject({ id: "a1", subreddit: "SEO", domain: "rankforge.io" });
    expect(h.submissions[1]?.domain).toBeUndefined(); // self.* is not an outbound domain
    expect(h.submissions[1]?.excerpt).toHaveLength(300);
    expect(h.comments).toHaveLength(1);
    expect(h.comments[0]?.linkDomains).toEqual(["rankforge.io", "example.com"]);
    expect(h.accountAgeDays).toBeGreaterThan(39);
    expect(h.linkKarma).toBe(12);
  });

  it("reports unavailable for private/suspended, missing and rate-limited profiles", async () => {
    expect((await fetchAuthorHistory("x", fakeReddit({ submitted: 403 }).fetchFn)).reason).toBe("private_or_suspended");
    expect((await fetchAuthorHistory("x", fakeReddit({ about: 404 }).fetchFn)).reason).toBe("not_found");
    expect((await fetchAuthorHistory("x", fakeReddit({ comments: 429 }).fetchFn)).reason).toBe("rate_limited");
    expect((await fetchAuthorHistory("x", fakeReddit({}, { suspended: true }).fetchFn)).reason).toBe("private_or_suspended");
    expect((await fetchAuthorHistory("[deleted]", fakeReddit().fetchFn)).reason).toBe("no_author");
  });
});

describe("HistoryCache", () => {
  function memoryStore(): KeyValueStore & { data: Record<string, unknown> } {
    const data: Record<string, unknown> = {};
    return {
      data,
      get: async (keys) => (keys === null ? { ...data } : Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))),
      set: async (items) => void Object.assign(data, items),
      remove: async (keys) => keys.forEach((k) => delete data[k]),
    };
  }

  it("stores per author and expires", async () => {
    let t = 1_000_000;
    const cache = new HistoryCache(memoryStore(), () => t);
    const h = await fetchAuthorHistory("Maya_Writes", fakeReddit().fetchFn, () => t);
    await cache.put(h);
    expect(await cache.get("maya_writes")).toBeTruthy();
    t += 7 * 60 * 60 * 1000;
    expect(await cache.get("maya_writes")).toBeUndefined();
  });

  it("clear removes only history keys", async () => {
    const store = memoryStore();
    store.data["promolens:settings"] = { enabled: true };
    const cache = new HistoryCache(store);
    await cache.put({ author: "a", fetchedAt: Date.now(), available: true, submissions: [], comments: [] });
    expect(await cache.clear()).toBe(1);
    expect(store.data["promolens:settings"]).toBeTruthy();
  });
});
