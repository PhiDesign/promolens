/**
 * Reddit adapter - THE ONLY FILE THAT KNOWS ABOUT REDDIT'S MARKUP.
 *
 * www.reddit.com renders posts as <shreddit-post> custom elements that carry
 * most post data as attributes, with the title and text body as slotted light
 * DOM children. Those attributes are the most stable hooks we have, so this
 * adapter prefers them over class names or nested selectors.
 *
 * If Reddit changes its interface, update the SELECTORS/ATTRS tables and the
 * functions below; nothing else in the extension should need to change.
 */
import type { PostInput, VisibleComment } from "@promolens/shared/light";
import { extractUrls, MAX_BODY_CHARS, MAX_COMMENT_CHARS, MAX_COMMENTS, MAX_LINKS, MAX_TITLE_CHARS } from "@promolens/shared/light";

export const SELECTORS = {
  post: "shreddit-post",
  /** Title link in the feed, <h1> on the detail page. Both use slot="title". */
  title: '[slot="title"]',
  body: '[slot="text-body"]',
  creditBar: '[slot="credit-bar"]',
  /** Reddit's "..." menu at the top-right of a post; our button goes just before it. */
  overflowMenu: "shreddit-post-overflow-menu",
  comment: "shreddit-comment",
  commentBody: '[slot="comment"]',
} as const;

export const ATTRS = {
  id: "id",
  permalink: "permalink",
  title: "post-title",
  author: "author",
  subredditPrefixed: "subreddit-prefixed-name",
  subreddit: "subreddit-name",
  score: "score",
  commentCount: "comment-count",
  created: "created-timestamp",
  domain: "domain",
  contentHref: "content-href",
  postType: "post-type",
  commentAuthor: "author",
  commentDepth: "depth",
} as const;

/** Marker attribute we add to processed posts to avoid duplicate rings. */
export const PROCESSED_ATTR = "data-promolens";
export const RING_SLOT = "title";
/** Tag name of the injected ring host element. */
export const RING_TAG = "promolens-ring";

const SUPPORTED_POST_TYPES = new Set(["text", "link", "crosspost", "poll", ""]);

export function findPostElements(root: ParentNode): HTMLElement[] {
  const list: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches(SELECTORS.post)) list.push(root);
  root.querySelectorAll?.(SELECTORS.post).forEach((el) => list.push(el as HTMLElement));
  return list;
}

export function findTitleElement(post: HTMLElement): HTMLElement | null {
  // Our ring host shares the title slot, so exclude it explicitly.
  return post.querySelector<HTMLElement>(`${SELECTORS.title}:not(${RING_TAG})`);
}

/** Stable key for a post element: Reddit id, else permalink, else title. */
export function getPostKey(post: HTMLElement): string {
  return (
    post.getAttribute(ATTRS.id) ||
    post.getAttribute(ATTRS.permalink) ||
    findTitleElement(post)?.textContent?.trim() ||
    ""
  );
}

/**
 * Insert the ring host next to the title. The title is slotted into Reddit's
 * shadow DOM, so the host is given the same slot name and placed before the
 * title element; the ring then renders inline at the start of the title line.
 */
/**
 * Preferred spot: the post header, just left of Reddit's "..." overflow menu
 * (top-right of the post). Falls back to the title line when that menu is not
 * found, so the button still appears if Reddit changes its header markup.
 */
export function mountRing(post: HTMLElement, host: HTMLElement): boolean {
  const creditBar = post.querySelector<HTMLElement>(SELECTORS.creditBar);
  const menu = creditBar?.querySelector<HTMLElement>(SELECTORS.overflowMenu);
  if (creditBar && menu) {
    // Feed cards wrap the menu in a fixed 32px box; the post page puts it in a
    // flex row. Insert beside the nearest ancestor that sits in a flex row so
    // the button lands to the left of the menu, never stacked above it.
    let anchor: HTMLElement = menu;
    const view = post.ownerDocument.defaultView;
    while (anchor.parentElement && anchor.parentElement !== creditBar) {
      const display = view?.getComputedStyle(anchor.parentElement).display ?? "";
      if (display.includes("flex")) break;
      anchor = anchor.parentElement;
    }
    host.removeAttribute("slot");
    host.dataset.placement = "header";
    anchor.parentElement?.insertBefore(host, anchor);
    return true;
  }
  const title = findTitleElement(post);
  if (!title || !title.parentNode) return false;
  host.setAttribute("slot", RING_SLOT);
  host.dataset.placement = "title";
  title.parentNode.insertBefore(host, title);
  return true;
}

export function isDetailPage(url: string = location.href): boolean {
  return /\/comments\/[a-z0-9]+/i.test(url);
}

/**
 * The main post of a post page (not the related/recommended posts Reddit
 * lists further down). Matched by permalink id, falling back to the post
 * that carries the <h1> title.
 */
export function findDetailPostElement(root: ParentNode, url: string = location.href): HTMLElement | null {
  // Only the opened post renders its title as an <h1>; feed cards use a link.
  // During Reddit's client-side transition the URL changes before the page
  // does, and the feed card shares the same id - so the <h1> is required.
  const posts = findPostElements(root).filter((el) => el.querySelector(`h1${SELECTORS.title}`));
  if (!posts.length) return null;
  const m = /\/comments\/([a-z0-9]+)/i.exec(url);
  const id = m?.[1]?.toLowerCase();
  if (id) {
    const byId = posts.find((el) => {
      const own = (el.getAttribute(ATTRS.id) ?? "").toLowerCase().replace(/^t3_/, "");
      const link = (el.getAttribute(ATTRS.permalink) ?? "").toLowerCase();
      return own === id || link.includes(`/comments/${id}`);
    });
    if (byId) return byId;
  }
  return posts[0] ?? null;
}

function parseInteger(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function ageHoursFrom(timestamp: string | null): number | undefined {
  if (!timestamp) return undefined;
  const t = Date.parse(timestamp);
  if (!Number.isFinite(t)) return undefined;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

function absoluteUrl(href: string): string | undefined {
  try {
    return new URL(href, location.origin).toString();
  } catch {
    return undefined;
  }
}

/** innerText respects CSS visibility; textContent is the fallback (e.g. in tests). */
function visibleText(el: HTMLElement | null | undefined): string | undefined {
  if (!el) return undefined;
  const raw = typeof el.innerText === "string" ? el.innerText : el.textContent ?? "";
  const text = raw.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text || undefined;
}

function isRedditHost(host: string): boolean {
  return /(^|\.)reddit\.com$|(^|\.)redd\.it$/i.test(host);
}

/**
 * Extract only visible, necessary information from a post element.
 * Returns null when the element cannot be parsed (the caller shows an
 * "analysis unavailable" state and moves on).
 */
export function extractPost(post: HTMLElement, opts: { includeComments?: boolean } = {}): PostInput | null {
  try {
    const postType = post.getAttribute(ATTRS.postType) ?? "";
    if (!SUPPORTED_POST_TYPES.has(postType)) {
      // Images, videos, galleries: still analyse title/links but note the type.
    }
    const titleEl = findTitleElement(post);
    const title = (post.getAttribute(ATTRS.title) || titleEl?.textContent || "").trim().slice(0, MAX_TITLE_CHARS);
    if (!title) return null;

    const bodyEl = post.querySelector<HTMLElement>(SELECTORS.body);
    const body = visibleText(bodyEl)?.slice(0, MAX_BODY_CHARS) || undefined;

    const links = new Set<string>();
    bodyEl?.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
      const u = absoluteUrl(a.getAttribute("href") ?? "");
      if (u && /^https?:/.test(u)) links.add(u);
    });
    // URLs written out in the visible text (feed excerpts flatten links to text).
    for (const u of extractUrls(body ?? "")) links.add(u);
    const contentHref = post.getAttribute(ATTRS.contentHref);
    if (contentHref) {
      const u = absoluteUrl(contentHref);
      if (u) {
        try {
          if (!isRedditHost(new URL(u).hostname)) links.add(u);
        } catch {
          /* ignore */
        }
      }
    }

    const outboundDomains = new Set<string>();
    const domainAttr = post.getAttribute(ATTRS.domain);
    if (domainAttr && !/^self\./i.test(domainAttr) && !isRedditHost(domainAttr)) outboundDomains.add(domainAttr.toLowerCase());
    for (const u of links) {
      try {
        const h = new URL(u).hostname.toLowerCase();
        if (!isRedditHost(h)) outboundDomains.add(h.replace(/^www\./, ""));
      } catch {
        /* ignore */
      }
    }

    const permalink = post.getAttribute(ATTRS.permalink);
    const url = permalink ? absoluteUrl(permalink) : undefined;
    const author = post.getAttribute(ATTRS.author) ?? undefined;
    const subreddit = post.getAttribute(ATTRS.subreddit) ?? post.getAttribute(ATTRS.subredditPrefixed)?.replace(/^r\//, "") ?? undefined;
    const creditText = post.querySelector(SELECTORS.creditBar)?.textContent ?? "";
    const brandAffiliateLabel = /brand affiliate/i.test(creditText) || undefined;

    const detail = isDetailPage();
    const input: PostInput = {
      id: post.getAttribute(ATTRS.id) ?? undefined,
      url,
      title,
      body,
      author,
      subreddit,
      upvotes: parseInteger(post.getAttribute(ATTRS.score)),
      commentsCount: parseInteger(post.getAttribute(ATTRS.commentCount)),
      ageHours: ageHoursFrom(post.getAttribute(ATTRS.created)),
      outboundDomains: [...outboundDomains].slice(0, MAX_LINKS),
      links: [...links].slice(0, MAX_LINKS),
      brandAffiliateLabel,
      isDetailPage: detail,
    };
    if (detail && opts.includeComments !== false) {
      input.visibleComments = extractVisibleComments(document, author);
    }
    return input;
  } catch {
    return null;
  }
}

/** Visible comments on a detail page (public, already on screen). */
export function extractVisibleComments(root: ParentNode, postAuthor?: string): VisibleComment[] {
  const out: VisibleComment[] = [];
  const op = postAuthor?.toLowerCase();
  root.querySelectorAll<HTMLElement>(SELECTORS.comment).forEach((c) => {
    if (out.length >= MAX_COMMENTS) return;
    const text = visibleText(c.querySelector<HTMLElement>(SELECTORS.commentBody));
    if (!text || text === "[deleted]" || text === "[removed]") return;
    const author = c.getAttribute(ATTRS.commentAuthor) ?? undefined;
    const depth = parseInteger(c.getAttribute(ATTRS.commentDepth));
    out.push({
      author,
      text: text.slice(0, MAX_COMMENT_CHARS),
      isOp: op !== undefined && author?.toLowerCase() === op,
      depth: depth !== undefined && depth >= 0 ? depth : undefined,
    });
  });
  return out;
}
