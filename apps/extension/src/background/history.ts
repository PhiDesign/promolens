/**
 * Public author history, fetched on demand.
 *
 * Only runs when the user clicks "analyse" on a post and the history check is
 * enabled. It reads the author's *public* profile listing (the same pages you
 * could open in a tab) using the browser's own Reddit session, keeps a compact
 * summary (titles, subreddits, domains, short excerpts, dates) and caches it
 * for a few hours per author. Nothing is crawled in the background and no
 * profile is fetched for posts the user did not click.
 *
 * Note for public release: this uses Reddit's unofficial JSON listings. The
 * proper route is a registered Reddit API application with OAuth; see
 * docs/privacy.md and docs/architecture.md.
 */
import type { AuthorHistory, HistoryComment, HistorySubmission } from "@promolens/shared/light";
import type { KeyValueStore } from "./cache.js";

export const HISTORY_PREFIX = "promolens:history:";
export const HISTORY_TTL_MS = 6 * 60 * 60 * 1000;
const LIMIT = 40;
const EXCERPT_CHARS = 300;

export type FetchLike = (url: string, init?: RequestInit) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

interface Listing {
  data?: { children?: { data?: Record<string, unknown> }[] };
}

export async function fetchAuthorHistory(author: string, fetchFn: FetchLike, now: () => number = Date.now): Promise<AuthorHistory> {
  const name = author.replace(/^u\//i, "").trim();
  const base: AuthorHistory = { author: name, fetchedAt: now(), available: false, submissions: [], comments: [] };
  if (!name || name === "[deleted]") return { ...base, reason: "no_author" };

  const get = async (path: string): Promise<{ status: number; body: unknown }> => {
    const res = await fetchFn(`https://www.reddit.com/user/${encodeURIComponent(name)}/${path}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    let body: unknown = undefined;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    return { status: res.status, body };
  };

  let about: { status: number; body: unknown }, submitted: { status: number; body: unknown }, comments: { status: number; body: unknown };
  try {
    [about, submitted, comments] = await Promise.all([
      get("about.json?raw_json=1"),
      get(`submitted.json?limit=${LIMIT}&raw_json=1`),
      get(`comments.json?limit=${LIMIT}&raw_json=1`),
    ]);
  } catch (err) {
    // Network failure or per-request timeout: report it rather than throwing,
    // so the analysis continues with lower confidence.
    return { ...base, reason: err instanceof Error && /abort|timeout/i.test(err.name + err.message) ? "timeout" : "fetch_failed" };
  }

  const worst = Math.max(about.status, submitted.status, comments.status);
  if (worst === 429) return { ...base, reason: "rate_limited" };
  if (submitted.status === 404 || about.status === 404) return { ...base, reason: "not_found" };
  if (submitted.status === 403 || about.status === 403) return { ...base, reason: "private_or_suspended" };
  if (!(submitted.status >= 200 && submitted.status < 300)) return { ...base, reason: `http_${submitted.status}` };

  const aboutData = ((about.body as { data?: Record<string, unknown> })?.data ?? {}) as Record<string, unknown>;
  if (aboutData.is_suspended === true) return { ...base, reason: "private_or_suspended" };

  const subs = listingItems(submitted.body).map(toSubmission).filter((s): s is HistorySubmission => !!s);
  const cmts = listingItems(comments.body).map(toComment).filter((c): c is HistoryComment => !!c);

  const createdUtc = typeof aboutData.created_utc === "number" ? aboutData.created_utc : undefined;
  return {
    ...base,
    available: true,
    accountAgeDays: createdUtc !== undefined ? Math.max(0, (now() / 1000 - createdUtc) / 86400) : undefined,
    linkKarma: typeof aboutData.link_karma === "number" ? aboutData.link_karma : undefined,
    commentKarma: typeof aboutData.comment_karma === "number" ? aboutData.comment_karma : undefined,
    submissions: subs,
    comments: cmts,
    truncated: subs.length >= LIMIT || cmts.length >= LIMIT,
  };
}

function listingItems(body: unknown): Record<string, unknown>[] {
  const children = (body as Listing)?.data?.children;
  if (!Array.isArray(children)) return [];
  return children.map((c) => c?.data).filter((d): d is Record<string, unknown> => !!d && typeof d === "object");
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function toSubmission(d: Record<string, unknown>): HistorySubmission | undefined {
  const title = str(d.title);
  const subreddit = str(d.subreddit);
  if (!title || !subreddit) return undefined;
  const isSelf = d.is_self === true;
  const url = !isSelf ? str(d.url) : undefined;
  const domain = !isSelf ? str(d.domain) : undefined;
  return {
    id: str(d.id),
    subreddit,
    title: title.slice(0, 300),
    domain: domain && !/^self\./i.test(domain) ? domain.toLowerCase() : undefined,
    url,
    excerpt: str(d.selftext)?.slice(0, EXCERPT_CHARS),
    createdUtc: typeof d.created_utc === "number" ? d.created_utc : undefined,
    permalink: str(d.permalink),
  };
}

const URL_RE = /https?:\/\/([^\s/)\]]+)/gi;

function toComment(d: Record<string, unknown>): HistoryComment | undefined {
  const body = str(d.body);
  const subreddit = str(d.subreddit);
  if (!body || !subreddit) return undefined;
  const linkDomains = new Set<string>();
  for (const m of body.matchAll(URL_RE)) {
    const host = m[1];
    if (host) linkDomains.add(host.toLowerCase().replace(/^www\./, ""));
  }
  return {
    subreddit,
    excerpt: body.slice(0, EXCERPT_CHARS),
    createdUtc: typeof d.created_utc === "number" ? d.created_utc : undefined,
    linkDomains: [...linkDomains],
    postTitle: str(d.link_title)?.slice(0, 200),
  };
}

/** Per-author cache so repeated clicks on the same author's posts do not refetch. */
export class HistoryCache {
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  private key(author: string): string {
    return `${HISTORY_PREFIX}${author.toLowerCase()}`;
  }

  async get(author: string, ttlMs = HISTORY_TTL_MS): Promise<AuthorHistory | undefined> {
    const key = this.key(author);
    const found = (await this.store.get([key]))[key] as AuthorHistory | undefined;
    if (!found || typeof found.fetchedAt !== "number") return undefined;
    if (found.fetchedAt + ttlMs <= this.now()) {
      await this.store.remove([key]);
      return undefined;
    }
    return found;
  }

  async put(history: AuthorHistory): Promise<void> {
    await this.store.set({ [this.key(history.author)]: history });
  }

  async clear(): Promise<number> {
    const all = await this.store.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(HISTORY_PREFIX));
    if (keys.length) await this.store.remove(keys);
    return keys.length;
  }
}
