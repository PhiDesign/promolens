/**
 * Background service worker (Manifest V3).
 *
 * Responsibilities:
 *  - result cache in chrome.storage.local (hash -> result, TTL from settings)
 *  - talking to the optional local API (max 2 concurrent requests)
 *  - answering messages from the content script and the popup
 *
 * It never sees provider secrets and never logs post content.
 */
import { loadSettings } from "../shared/settings.js";
import type {
  CacheClearResponse,
  CacheGetResponse,
  EnrichResponse,
  HistoryResponse,
  Message,
  PostGetResponse,
  RedditStatusResponse,
  SimpleResponse,
} from "../shared/messages.js";
import { REDDIT_CLIENT_ID } from "../shared/redditApp.js";
import { ApiClient, ApiError } from "./apiClient.js";
import { chromeLocalStore, memoryStore, ResultCache } from "./cache.js";
import { fetchAuthorHistory, HistoryCache, type FetchLike } from "./history.js";
import { fetchPostPage, normalizePermalink } from "./postFetch.js";
import { dataApiFetch, RedditAuth } from "./redditAuth.js";

const rawFetch: FetchLike = (url, init) => fetch(url, init);

/** Official Data API login. Dormant until REDDIT_CLIENT_ID is set (see shared/redditApp.ts). */
const redditAuth = new RedditAuth(chromeLocalStore(), {
  clientId: REDDIT_CLIENT_ID,
  redirectUrl: typeof chrome !== "undefined" && chrome.identity ? chrome.identity.getRedirectURL("oauth") : "",
  launch: (authUrl) =>
    new Promise<string>((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirect) => {
        if (chrome.runtime.lastError || !redirect) reject(new Error(chrome.runtime.lastError?.message ?? "Login window was closed"));
        else resolve(redirect);
      });
    }),
  fetchFn: rawFetch,
});

/**
 * Which way to read Reddit: the official Data API when the user is logged in
 * and has not switched it off, otherwise the page session (public pages the
 * user could open themselves).
 */
async function redditFetch(): Promise<{ fetchFn: FetchLike; via: "data-api" | "session" }> {
  const settings = await loadSettings();
  if (settings.dataApiEnabled && redditAuth.configured && (await redditAuth.status()).loggedIn) {
    return { fetchFn: dataApiFetch(redditAuth, rawFetch), via: "data-api" };
  }
  return { fetchFn: rawFetch, via: "session" };
}

/** Fetched post pages, kept briefly in worker memory so a second click does not refetch. */
const postPageCache = new Map<string, { at: number; response: PostGetResponse }>();
const POST_PAGE_TTL_MS = 10 * 60 * 1000;

const cache = new ResultCache(chromeLocalStore());
// History summaries contain excerpts of other people's posts: memory only, never on disk.
const historyCache = new HistoryCache(memoryStore());
/** In-flight history fetches, so two quick clicks on the same author share one request. */
const historyInFlight = new Map<string, Promise<HistoryResponse>>();
// A large language model can take 10-40 s per post (big prompt: criteria,
// post, comments, author history); the mock answers in ms. Must exceed the
// API's own LLM_TIMEOUT_MS so the server's answer (or 502) arrives first.
const API_TIMEOUT_MS = 55_000;
const api = new ApiClient(API_TIMEOUT_MS, 2);

async function ttlMs(): Promise<number> {
  const settings = await loadSettings();
  return settings.cacheTtlHours * 60 * 60 * 1000;
}

async function handle(message: Message): Promise<unknown> {
  switch (message.type) {
    case "CACHE_GET": {
      const result = await cache.get(message.hash, await ttlMs());
      const response: CacheGetResponse = { ok: true, result };
      return response;
    }
    case "CACHE_PUT": {
      await cache.put(message.hash, message.result, await ttlMs());
      const response: SimpleResponse = { ok: true };
      return response;
    }
    case "CACHE_CLEAR": {
      const removed = (await cache.clear()) + (await historyCache.clear());
      const response: CacheClearResponse = { ok: true, removed };
      return response;
    }
    case "POST_GET": {
      const settings = await loadSettings();
      if (!settings.feedEnabled) {
        const response: PostGetResponse = { ok: false, reason: "disabled" };
        return response;
      }
      const key = normalizePermalink(message.permalink) ?? message.permalink;
      const hit = postPageCache.get(key);
      if (hit && hit.at + POST_PAGE_TTL_MS > Date.now()) return hit.response;
      const { fetchFn } = await redditFetch();
      const response = await fetchPostPage(message.permalink, fetchFn);
      if (response.ok) postPageCache.set(key, { at: Date.now(), response });
      return response;
    }
    case "REDDIT_STATUS": {
      const s = await redditAuth.status();
      const response: RedditStatusResponse = { ok: true, configured: s.configured, loggedIn: s.loggedIn, username: s.username };
      return response;
    }
    case "REDDIT_LOGIN": {
      try {
        const s = await redditAuth.login();
        const response: RedditStatusResponse = { ok: true, configured: true, loggedIn: true, username: s.username, message: `Logged in as u/${s.username ?? "?"}` };
        return response;
      } catch (err) {
        const response: RedditStatusResponse = { ok: false, configured: redditAuth.configured, loggedIn: false, message: err instanceof Error ? err.message : "Login failed" };
        return response;
      }
    }
    case "REDDIT_LOGOUT": {
      await redditAuth.logout();
      historyCache.clear().catch(() => undefined);
      postPageCache.clear();
      const response: RedditStatusResponse = { ok: true, configured: redditAuth.configured, loggedIn: false, message: "Logged out" };
      return response;
    }
    case "HISTORY_GET": {
      const settings = await loadSettings();
      if (!settings.historyEnabled) {
        const response: HistoryResponse = { ok: false, reason: "disabled" };
        return response;
      }
      const author = message.author.trim();
      const cachedHistory = await historyCache.get(author);
      if (cachedHistory) {
        const response: HistoryResponse = { ok: true, history: cachedHistory };
        return response;
      }
      const key = author.toLowerCase();
      let pending = historyInFlight.get(key);
      if (!pending) {
        pending = redditFetch()
          .then(({ fetchFn }) => fetchAuthorHistory(author, fetchFn))
          .then(async (history): Promise<HistoryResponse> => {
            // Cache successes for hours; cache "unavailable" briefly so a private
            // profile is not re-fetched on every click, but retried later.
            await historyCache.put(history.available ? history : { ...history, fetchedAt: Date.now() - 5 * 60 * 60 * 1000 });
            return { ok: true, history };
          })
          .catch((err): HistoryResponse => ({ ok: false, reason: err instanceof Error ? err.message : "fetch_failed" }))
          .finally(() => historyInFlight.delete(key));
        historyInFlight.set(key, pending);
      }
      return pending;
    }
    case "ENRICH": {
      const settings = await loadSettings();
      if (!settings.apiEnabled) {
        const response: EnrichResponse = { ok: false, reason: "api_disabled" };
        return response;
      }
      try {
        const result = await api.analyze(settings.apiBaseUrl, message.post, message.localSignals, message.hash);
        await cache.put(message.hash, result, await ttlMs());
        const response: EnrichResponse = { ok: true, result };
        return response;
      } catch (err) {
        const response: EnrichResponse = { ok: false, reason: err instanceof ApiError ? err.reason : "unknown" };
        return response;
      }
    }
    case "API_HEALTH": {
      const settings = await loadSettings();
      const status = await api.health(message.baseUrl ?? settings.apiBaseUrl);
      const response: SimpleResponse = status;
      return response;
    }
    default:
      return { ok: false, reason: "unknown_message" };
  }
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handle(message)
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, reason: "background_error" }));
  return true; // keep the channel open for the async response
});

// Housekeeping when the worker (re)starts: drop expired cache entries.
const prune = () => ttlMs().then((ttl) => cache.prune(ttl)).catch(() => undefined);
chrome.runtime.onInstalled.addListener(() => void prune());
chrome.runtime.onStartup.addListener(() => void prune());
