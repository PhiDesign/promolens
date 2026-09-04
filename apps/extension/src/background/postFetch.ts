/**
 * Fetch one post's full public content (body, links, top comments) without
 * navigating to it - used when the user clicks the PromoLens button on a feed
 * card. Same approach and same caveats as history.ts: Reddit's public JSON
 * listing, the user's own session, only on click, one post at a time.
 */
import { MAX_BODY_CHARS, MAX_COMMENT_CHARS, MAX_COMMENTS, MAX_LINKS, type PostInput, type VisibleComment } from "@promolens/shared/light";
import type { FetchLike } from "./history.js";

export type PostFetchResult = { ok: true; post: PostInput } | { ok: false; reason: string };

const URL_RE = /https?:\/\/[^\s<>()"'\]]+/gi;
const NON_PRODUCT = /(^|\.)(reddit\.com|redd\.it|redditmedia\.com|redditstatic\.com|imgur\.com|i\.redd\.it|v\.redd\.it|preview\.redd\.it)$/i;

export async function fetchPostPage(permalink: string, fetchFn: FetchLike): Promise<PostFetchResult> {
  const path = normalizePermalink(permalink);
  if (!path) return { ok: false, reason: "no_permalink" };

  let status = 0;
  let body: unknown;
  try {
    const res = await fetchFn(`https://www.reddit.com${path}.json?raw_json=1&limit=${MAX_COMMENTS}&depth=2&sort=top`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    status = res.status;
    body = await res.json().catch(() => undefined);
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
  if (status === 429) return { ok: false, reason: "rate_limited" };
  if (status === 403) return { ok: false, reason: "forbidden" };
  if (status === 404) return { ok: false, reason: "not_found" };
  if (status < 200 || status >= 300) return { ok: false, reason: `http_${status}` };

  const listings = Array.isArray(body) ? (body as unknown[]) : [];
  const postData = firstChild(listings[0]);
  if (!postData) return { ok: false, reason: "malformed" };
  const post = toPost(postData, path);
  if (!post) return { ok: false, reason: "malformed" };
  post.visibleComments = collectComments(listings[1], post.author).slice(0, MAX_COMMENTS);
  post.commentsCount = post.commentsCount ?? post.visibleComments.length;
  return { ok: true, post };
}

export function normalizePermalink(permalink: string): string | null {
  try {
    const url = permalink.startsWith("http") ? new URL(permalink) : new URL(permalink, "https://www.reddit.com");
    const m = /^(\/r\/[^/]+\/comments\/[a-z0-9]+)/i.exec(url.pathname) ?? /^(\/(?:user|u)\/[^/]+\/comments\/[a-z0-9]+)/i.exec(url.pathname);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

function firstChild(listing: unknown): Record<string, unknown> | undefined {
  const children = (listing as { data?: { children?: { data?: unknown }[] } })?.data?.children;
  const data = Array.isArray(children) ? children[0]?.data : undefined;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function toPost(d: Record<string, unknown>, path: string): PostInput | undefined {
  const title = str(d.title);
  if (!title) return undefined;
  const selftext = (str(d.selftext) ?? "").slice(0, MAX_BODY_CHARS);
  const isSelf = d.is_self === true;
  const outbound = !isSelf ? str(d.url) : undefined;
  const links = new Set<string>();
  if (outbound) links.add(outbound);
  for (const m of selftext.matchAll(URL_RE)) links.add(m[0].replace(/[.,;:!?)]+$/, ""));
  const domains = new Set<string>();
  for (const l of links) {
    try {
      const host = new URL(l).hostname.toLowerCase().replace(/^www\./, "");
      if (!NON_PRODUCT.test(host)) domains.add(host);
    } catch {
      /* ignore bad url */
    }
  }
  const created = num(d.created_utc);
  const id = str(d.name) ?? (str(d.id) ? `t3_${str(d.id)}` : undefined);
  return {
    id,
    url: `https://www.reddit.com${str(d.permalink) ?? path}`,
    title: title.slice(0, 600),
    body: selftext || undefined,
    author: str(d.author),
    subreddit: str(d.subreddit),
    upvotes: num(d.score),
    commentsCount: num(d.num_comments),
    ageHours: created !== undefined ? Math.max(0, (Date.now() / 1000 - created) / 3600) : undefined,
    links: [...links].slice(0, MAX_LINKS),
    outboundDomains: [...domains].slice(0, MAX_LINKS),
    brandAffiliateLabel: d.is_created_from_ads_ui === true || /brand affiliate/i.test(String(d.author_flair_text ?? "")) || undefined,
    isDetailPage: true,
  };
}

function collectComments(listing: unknown, postAuthor: string | undefined): VisibleComment[] {
  const out: VisibleComment[] = [];
  const walk = (node: unknown, depth: number) => {
    const children = (node as { data?: { children?: unknown[] } })?.data?.children;
    if (!Array.isArray(children)) return;
    for (const child of children) {
      const c = child as { kind?: string; data?: Record<string, unknown> };
      if (c.kind !== "t1" || !c.data) continue;
      const body = str(c.data.body);
      if (!body || body === "[deleted]" || body === "[removed]") continue;
      const author = str(c.data.author);
      out.push({
        author,
        text: body.slice(0, MAX_COMMENT_CHARS),
        depth,
        isOp: !!author && !!postAuthor && author === postAuthor,
      });
      if (out.length >= MAX_COMMENTS) return;
      if (depth < 2 && c.data.replies && typeof c.data.replies === "object") walk(c.data.replies, depth + 1);
    }
  };
  walk(listing, 0);
  return out;
}
