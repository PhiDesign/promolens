/**
 * Reddit OAuth for an "installed app" (no client secret), run from the
 * background worker with chrome.identity.launchWebAuthFlow.
 *
 * Flow: authorize (code, permanent duration) -> exchange code for access +
 * refresh tokens -> store both -> refresh silently when expired.
 *
 * `dataApiFetch` wraps the existing history/post fetchers: it rewrites
 * www.reddit.com/...json URLs to oauth.reddit.com and adds the bearer token,
 * so the parsing code does not change between the two access paths.
 *
 * Everything external (identity flow, fetch, clock, storage) is injected for
 * tests. Tokens are stored in chrome.storage.local under one key; logging out
 * revokes them at Reddit and deletes them.
 */
import { REDDIT_AUTHORIZE_URL, REDDIT_OAUTH_API, REDDIT_SCOPES, REDDIT_TOKEN_URL } from "../shared/redditApp.js";
import type { KeyValueStore } from "./cache.js";
import type { FetchLike } from "./history.js";

export const TOKEN_KEY = "promolens:reddit-auth";
const EXPIRY_MARGIN_MS = 60_000;

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token stops being valid. */
  expiresAt: number;
  scope: string;
  username?: string;
}

export interface RedditAuthStatus {
  configured: boolean;
  loggedIn: boolean;
  username?: string;
  scope?: string;
}

export interface RedditAuthDeps {
  clientId: string;
  redirectUrl: string;
  /** chrome.identity.launchWebAuthFlow: opens the consent page, resolves with the redirect URL. */
  launch: (authUrl: string) => Promise<string>;
  fetchFn: FetchLike;
  now?: () => number;
  randomState?: () => string;
}

export class RedditAuth {
  private readonly now: () => number;
  private readonly randomState: () => string;
  private refreshing: Promise<StoredTokens | undefined> | undefined;

  constructor(
    private readonly store: KeyValueStore,
    private readonly deps: RedditAuthDeps,
  ) {
    this.now = deps.now ?? Date.now;
    this.randomState = deps.randomState ?? (() => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
  }

  get configured(): boolean {
    return this.deps.clientId.trim().length > 0;
  }

  async status(): Promise<RedditAuthStatus> {
    const t = await this.load();
    return { configured: this.configured, loggedIn: !!t, username: t?.username, scope: t?.scope };
  }

  /** Interactive login. Resolves with the username when Reddit granted the scopes. */
  async login(): Promise<RedditAuthStatus> {
    if (!this.configured) throw new Error("Reddit app is not configured (REDDIT_CLIENT_ID is empty)");
    const state = this.randomState();
    const url =
      `${REDDIT_AUTHORIZE_URL}?client_id=${encodeURIComponent(this.deps.clientId)}` +
      `&response_type=code&state=${encodeURIComponent(state)}` +
      `&redirect_uri=${encodeURIComponent(this.deps.redirectUrl)}` +
      `&duration=permanent&scope=${encodeURIComponent(REDDIT_SCOPES.join(" "))}`;
    const redirected = await this.deps.launch(url);
    const params = new URL(redirected).searchParams;
    if (params.get("error")) throw new Error(`Reddit refused the login: ${params.get("error")}`);
    if (params.get("state") !== state) throw new Error("Login response did not match the request (state mismatch)");
    const code = params.get("code");
    if (!code) throw new Error("Login response carried no authorization code");

    const tokens = await this.tokenRequest({ grant_type: "authorization_code", code, redirect_uri: this.deps.redirectUrl });
    tokens.username = await this.whoAmI(tokens.accessToken);
    await this.store.set({ [TOKEN_KEY]: tokens });
    return { configured: true, loggedIn: true, username: tokens.username, scope: tokens.scope };
  }

  /** Revoke at Reddit (best effort) and forget the tokens. */
  async logout(): Promise<void> {
    const t = await this.load();
    if (t) {
      try {
        await this.deps.fetchFn("https://www.reddit.com/api/v1/revoke_token", {
          method: "POST",
          headers: { authorization: this.basicAuth(), "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: t.refreshToken ?? t.accessToken, token_type_hint: t.refreshToken ? "refresh_token" : "access_token" }).toString(),
        });
      } catch {
        /* revocation is best effort */
      }
    }
    await this.store.remove([TOKEN_KEY]);
  }

  /** A valid access token, refreshing silently if needed; undefined when not logged in. */
  async getAccessToken(): Promise<string | undefined> {
    const t = await this.load();
    if (!t) return undefined;
    if (t.expiresAt - EXPIRY_MARGIN_MS > this.now()) return t.accessToken;
    if (!t.refreshToken) {
      await this.store.remove([TOKEN_KEY]);
      return undefined;
    }
    if (!this.refreshing) {
      this.refreshing = this.tokenRequest({ grant_type: "refresh_token", refresh_token: t.refreshToken })
        .then(async (next) => {
          const merged: StoredTokens = { ...next, refreshToken: next.refreshToken ?? t.refreshToken, username: t.username };
          await this.store.set({ [TOKEN_KEY]: merged });
          return merged;
        })
        .catch(async () => {
          await this.store.remove([TOKEN_KEY]); // refresh token revoked or expired: user must log in again
          return undefined;
        })
        .finally(() => {
          this.refreshing = undefined;
        });
    }
    return (await this.refreshing)?.accessToken;
  }

  private async load(): Promise<StoredTokens | undefined> {
    const found = (await this.store.get([TOKEN_KEY]))[TOKEN_KEY] as StoredTokens | undefined;
    return found && typeof found.accessToken === "string" && typeof found.expiresAt === "number" ? found : undefined;
  }

  private basicAuth(): string {
    // Installed apps authenticate with "client_id:" and an empty secret.
    return `Basic ${btoa(`${this.deps.clientId}:`)}`;
  }

  private async tokenRequest(form: Record<string, string>): Promise<StoredTokens> {
    const res = await this.deps.fetchFn(REDDIT_TOKEN_URL, {
      method: "POST",
      headers: { authorization: this.basicAuth(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    const body = (await res.json().catch(() => undefined)) as
      | { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string }
      | undefined;
    if (res.status !== 200 || !body?.access_token) {
      throw new Error(`Reddit token request failed (HTTP ${res.status}${body?.error ? `, ${body.error}` : ""})`);
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: this.now() + (body.expires_in ?? 3600) * 1000,
      scope: body.scope ?? REDDIT_SCOPES.join(" "),
    };
  }

  private async whoAmI(accessToken: string): Promise<string | undefined> {
    try {
      const res = await this.deps.fetchFn(`${REDDIT_OAUTH_API}/api/v1/me`, { headers: { authorization: `Bearer ${accessToken}` } });
      const body = (await res.json()) as { name?: string };
      return typeof body.name === "string" ? body.name : undefined;
    } catch {
      return undefined;
    }
  }
}

/**
 * Turn any www.reddit.com/...json listing URL into the equivalent Data API
 * call. Same paths, same JSON shapes; only the host and the auth differ.
 */
export function toDataApiUrl(url: string): string {
  const u = new URL(url);
  if (u.hostname !== "www.reddit.com" && u.hostname !== "reddit.com") return url;
  u.hostname = "oauth.reddit.com";
  u.pathname = u.pathname.replace(/\.json$/i, "");
  return u.toString();
}

/**
 * A FetchLike that speaks to the Data API with the stored token. Requests are
 * sent without cookies (the token is the identity). A 401 answer clears the
 * token so the popup can ask the user to log in again.
 */
export function dataApiFetch(auth: RedditAuth, raw: FetchLike, onUnauthorized?: () => void): FetchLike {
  return async (url, init) => {
    const token = await auth.getAccessToken();
    if (!token) return { status: 401, ok: false, json: async () => ({ error: "not_logged_in" }) };
    const headers = { ...((init?.headers as Record<string, string>) ?? {}), authorization: `Bearer ${token}`, accept: "application/json" };
    const res = await raw(toDataApiUrl(url), { ...init, headers, credentials: "omit" });
    if (res.status === 401) onUnauthorized?.();
    return res;
  };
}
