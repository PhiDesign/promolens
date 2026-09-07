import { describe, expect, it, vi } from "vitest";
import type { KeyValueStore } from "../src/background/cache.js";
import type { FetchLike } from "../src/background/history.js";
import { dataApiFetch, RedditAuth, TOKEN_KEY, toDataApiUrl } from "../src/background/redditAuth.js";

function memoryStore(): KeyValueStore & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys) => (keys === null ? { ...data } : Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))),
    set: async (items) => void Object.assign(data, items),
    remove: async (keys) => keys.forEach((k) => delete data[k]),
  };
}

function fakeReddit(opts: { expiresIn?: number; failRefresh?: boolean } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let tokenCounter = 0;
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/api/v1/access_token")) {
      const form = new URLSearchParams(String(init?.body));
      if (form.get("grant_type") === "refresh_token" && opts.failRefresh) return { status: 400, ok: false, json: async () => ({ error: "invalid_grant" }) };
      tokenCounter++;
      return {
        status: 200,
        ok: true,
        json: async () => ({ access_token: `at-${tokenCounter}`, refresh_token: form.get("grant_type") === "authorization_code" ? "rt-1" : undefined, expires_in: opts.expiresIn ?? 3600, scope: "identity read history" }),
      };
    }
    if (url.includes("/api/v1/me")) return { status: 200, ok: true, json: async () => ({ name: "maya_writes" }) };
    if (url.includes("/revoke_token")) return { status: 204, ok: true, json: async () => ({}) };
    return { status: 200, ok: true, json: async () => ({ ok: true, url }) };
  };
  return { fetchFn, calls };
}

const REDIRECT = "https://abc.chromiumapp.org/oauth";

function makeAuth(store = memoryStore(), reddit = fakeReddit(), now = { t: 1_000_000 }) {
  const auth = new RedditAuth(store, {
    clientId: "client123",
    redirectUrl: REDIRECT,
    launch: async (authUrl) => {
      const state = new URL(authUrl).searchParams.get("state");
      return `${REDIRECT}?state=${state}&code=code-xyz`;
    },
    fetchFn: reddit.fetchFn,
    now: () => now.t,
    randomState: () => "fixed-state",
  });
  return { auth, store, reddit, now };
}

describe("RedditAuth", () => {
  it("logs in with the code grant, stores tokens and the username", async () => {
    const { auth, store, reddit } = makeAuth();
    const status = await auth.login();
    expect(status).toMatchObject({ configured: true, loggedIn: true, username: "maya_writes" });
    const tokenCall = reddit.calls.find((c) => c.url.includes("access_token"));
    const headers = tokenCall?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${btoa("client123:")}`); // installed app: empty secret
    expect(String(tokenCall?.init?.body)).toContain("grant_type=authorization_code");
    expect(String(tokenCall?.init?.body)).toContain(`redirect_uri=${encodeURIComponent(REDIRECT)}`);
    expect((store.data[TOKEN_KEY] as { refreshToken: string }).refreshToken).toBe("rt-1");
    expect(await auth.getAccessToken()).toBe("at-1");
  });

  it("asks Reddit for the right scopes and a permanent token", async () => {
    let seen = "";
    const auth = new RedditAuth(memoryStore(), {
      clientId: "c",
      redirectUrl: REDIRECT,
      launch: async (u) => {
        seen = u;
        return `${REDIRECT}?state=fixed-state&code=x`;
      },
      fetchFn: fakeReddit().fetchFn,
      randomState: () => "fixed-state",
    });
    await auth.login();
    const p = new URL(seen).searchParams;
    expect(p.get("scope")).toBe("identity read history");
    expect(p.get("duration")).toBe("permanent");
    expect(p.get("response_type")).toBe("code");
  });

  it("rejects a response whose state does not match, and Reddit errors", async () => {
    const bad = new RedditAuth(memoryStore(), { clientId: "c", redirectUrl: REDIRECT, launch: async () => `${REDIRECT}?state=other&code=x`, fetchFn: fakeReddit().fetchFn, randomState: () => "fixed-state" });
    await expect(bad.login()).rejects.toThrow(/state mismatch/);
    const denied = new RedditAuth(memoryStore(), { clientId: "c", redirectUrl: REDIRECT, launch: async () => `${REDIRECT}?error=access_denied&state=fixed-state`, fetchFn: fakeReddit().fetchFn, randomState: () => "fixed-state" });
    await expect(denied.login()).rejects.toThrow(/access_denied/);
  });

  it("refreshes silently when the token is about to expire, and logs out when refresh fails", async () => {
    const { auth, now, reddit } = makeAuth(memoryStore(), fakeReddit({ expiresIn: 120 }));
    await auth.login();
    now.t += 90_000; // inside the 60 s margin
    expect(await auth.getAccessToken()).toBe("at-2");
    expect(reddit.calls.filter((c) => String(c.init?.body).includes("refresh_token")).length).toBe(1);

    const failing = makeAuth(memoryStore(), fakeReddit({ expiresIn: 120, failRefresh: true }));
    await failing.auth.login();
    failing.now.t += 90_000;
    expect(await failing.auth.getAccessToken()).toBeUndefined();
    expect((await failing.auth.status()).loggedIn).toBe(false);
  });

  it("logout revokes and forgets the tokens", async () => {
    const { auth, store, reddit } = makeAuth();
    await auth.login();
    await auth.logout();
    expect(store.data[TOKEN_KEY]).toBeUndefined();
    expect(reddit.calls.some((c) => c.url.includes("revoke_token"))).toBe(true);
    expect((await auth.status()).loggedIn).toBe(false);
  });

  it("is not configured without a client id", async () => {
    const auth = new RedditAuth(memoryStore(), { clientId: "", redirectUrl: REDIRECT, launch: async () => "", fetchFn: fakeReddit().fetchFn });
    expect((await auth.status()).configured).toBe(false);
    await expect(auth.login()).rejects.toThrow(/not configured/);
  });
});

describe("dataApiFetch", () => {
  it("rewrites listing URLs to oauth.reddit.com without .json and adds the bearer token", async () => {
    expect(toDataApiUrl("https://www.reddit.com/user/maya/submitted.json?limit=40&raw_json=1")).toBe("https://oauth.reddit.com/user/maya/submitted?limit=40&raw_json=1");
    expect(toDataApiUrl("https://www.reddit.com/r/x/comments/abc.json?raw_json=1")).toBe("https://oauth.reddit.com/r/x/comments/abc?raw_json=1");
    expect(toDataApiUrl("https://example.com/a.json")).toBe("https://example.com/a.json");

    const { auth, reddit } = makeAuth();
    await auth.login();
    const wrapped = dataApiFetch(auth, reddit.fetchFn);
    await wrapped("https://www.reddit.com/user/maya/about.json?raw_json=1", { credentials: "include", headers: { accept: "application/json" } });
    const call = reddit.calls[reddit.calls.length - 1];
    expect(call?.url).toBe("https://oauth.reddit.com/user/maya/about?raw_json=1");
    expect((call?.init?.headers as Record<string, string>).authorization).toBe("Bearer at-1");
    expect(call?.init?.credentials).toBe("omit");
  });

  it("answers 401 without a network call when not logged in", async () => {
    const { auth, reddit } = makeAuth();
    const before = reddit.calls.length;
    const res = await dataApiFetch(auth, reddit.fetchFn)("https://www.reddit.com/user/x/about.json");
    expect(res.status).toBe(401);
    expect(reddit.calls.length).toBe(before);
  });

  it("reports an unauthorized answer so the UI can ask for a new login", async () => {
    const { auth } = makeAuth();
    await auth.login();
    const onUnauthorized = vi.fn();
    const raw: FetchLike = async () => ({ status: 401, ok: false, json: async () => ({}) });
    await dataApiFetch(auth, raw, onUnauthorized)("https://www.reddit.com/user/x/about.json");
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
