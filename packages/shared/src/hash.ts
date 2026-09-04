/**
 * Content hashing for change detection and cache keys.
 *
 * This is NOT a security hash. FNV-1a is used because it is tiny, synchronous
 * and works identically in the browser, a service worker and Node.
 */
function fnv1a32(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function hashString(input: string): string {
  const a = fnv1a32(input, 0x811c9dc5);
  const b = fnv1a32(input, 0x9747b28c);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * Hash only the fields that affect the analysis. Upvotes change constantly and
 * only affect reach, so they are excluded to avoid re-analysing the same post.
 */
export function hashPostContent(post: {
  id?: string;
  title: string;
  body?: string;
  author?: string;
  subreddit?: string;
  links?: string[];
  outboundDomains?: string[];
  visibleComments?: { text: string; author?: string }[];
  isDetailPage?: boolean;
  authorHistory?: { fetchedAt: number; available: boolean; submissions: unknown[]; comments: unknown[] };
}): string {
  const h = post.authorHistory;
  const parts = [
    "v2",
    h ? `h:${h.available ? 1 : 0}:${h.fetchedAt}:${h.submissions.length}:${h.comments.length}` : "h:none",
    post.id ?? "",
    post.title,
    post.body ?? "",
    post.author ?? "",
    post.subreddit ?? "",
    (post.links ?? []).join("|"),
    (post.outboundDomains ?? []).join("|"),
    post.isDetailPage ? "detail" : "feed",
    (post.visibleComments ?? []).map((c) => `${c.author ?? ""}:${c.text}`).join(""),
  ];
  return hashString(parts.join(" "));
}
