/**
 * Author-history signals (criteria document sections 4 and 5).
 *
 * The extension fetches the author's *public* recent submissions and comments
 * when the user clicks "analyse" on a post, and attaches a compact summary as
 * `post.authorHistory`. This module turns that summary into signals:
 *
 *  - the same product/domain recurring across posts and communities
 *  - near-identical posts reposted
 *  - the author identifying as the creator/employee/affiliate elsewhere
 *    (verified: we observed the public statement ourselves)
 *  - comments that keep steering to the same product
 *  - account age / karma as weak context only
 *  - counter-signals: varied recommendations, long genuine history,
 *    the product being incidental
 *
 * Every explanation is observational ("linked example.app in 6 of 20 recent
 * posts across 5 communities"), never a label for the person. When no history
 * is available the engine says so and confidence stays low.
 */
import { CLEAR_AFFILIATE_RE, CLEAR_CREATOR_RE, CLEAR_EMPLOYMENT_RE, CREATOR_NAMED_RE, CREATOR_RELATIVE_RE, makeSignal } from "./detectors.js";
import { domainOf, escapeRegExp, normalizeWhitespace } from "./text.js";
import type { AuthorHistory, HistoryComment, HistorySubmission, PostInput, Signal } from "./types.js";

export interface HistoryTargets {
  /** Product / brand names mentioned in the post. */
  names: string[];
  /** Product domains linked from the post (no Reddit or general-purpose hosts). */
  domains: string[];
}

const NEAR_DUPLICATE_JACCARD = 0.6;

export function detectHistorySignals(post: PostInput, targets: HistoryTargets): Signal[] {
  const h = post.authorHistory;
  if (!h) return [makeSignal("availability.profile-history-unavailable")];
  if (!h.available) {
    return [
      makeSignal("availability.profile-history-unavailable", {
        explanation: `Author history could not be checked (${describeReason(h.reason)})`,
      }),
    ];
  }

  const out: Signal[] = [];
  const names = targets.names.filter((n) => n.length >= 3);
  const domains = targets.domains.map((d) => d.toLowerCase()).filter(Boolean);
  const nameRes = names.map((n) => new RegExp(`\\b${escapeRegExp(n)}\\b`, "i"));

  // Exclude the post being analysed from "other" activity.
  const currentTitle = normalizeWhitespace(post.title).toLowerCase();
  const others = h.submissions.filter((s) => {
    if (post.id && s.id && stripT3(post.id) === stripT3(s.id)) return false;
    return normalizeWhitespace(s.title).toLowerCase() !== currentTitle;
  });
  const comments = h.comments;
  const total = others.length + comments.length;

  out.push(
    makeSignal("availability.profile-history-checked", {
      explanation: `Checked ${others.length} other recent post${others.length === 1 ? "" : "s"} and ${comments.length} comment${comments.length === 1 ? "" : "s"} from the author's public profile`,
    }),
  );

  const mentionsProduct = (text: string, itemDomains: string[] = []): boolean => {
    if (nameRes.some((re) => re.test(text))) return true;
    const lower = text.toLowerCase();
    if (domains.some((d) => lower.includes(d))) return true;
    return itemDomains.some((d) => domains.includes(d.toLowerCase()));
  };
  const subDomains = (s: HistorySubmission): string[] => {
    const list: string[] = [];
    if (s.domain) list.push(s.domain.toLowerCase());
    if (s.url) {
      const d = domainOf(s.url);
      if (d) list.push(d);
    }
    return list;
  };

  const hasTargets = names.length > 0 || domains.length > 0;
  const productSubs = hasTargets ? others.filter((s) => mentionsProduct(`${s.title}\n${s.excerpt ?? ""}`, subDomains(s))) : [];
  const productComments = hasTargets ? comments.filter((c) => mentionsProduct(c.excerpt, c.linkDomains ?? [])) : [];
  const productMentions = productSubs.length + productComments.length;

  if (hasTargets && others.length + comments.length > 0) {
    // Same domain linked again and again.
    const domainHits = [
      ...others.filter((s) => subDomains(s).some((d) => domains.includes(d))),
      ...comments.filter((c) => (c.linkDomains ?? []).some((d) => domains.includes(d.toLowerCase()))),
    ];
    if (domainHits.length >= 2) {
      const subs = new Set(domainHits.map((x) => x.subreddit.toLowerCase()));
      out.push(
        makeSignal("account.repeats-domain", {
          weight: domainHits.length >= 4 ? 25 : 15,
          explanation: `The author linked ${domains[0]} in ${domainHits.length} other recent posts or comments across ${subs.size} communit${subs.size === 1 ? "y" : "ies"}`,
        }),
      );
    }

    // Same product across many communities.
    const productSubreddits = new Set(productSubs.map((s) => s.subreddit.toLowerCase()));
    if (productSubs.length >= 2 && productSubreddits.size >= 3) {
      out.push(
        makeSignal("history.cross-subreddit", {
          explanation: `The same product appears in ${productSubs.length} other recent posts across ${productSubreddits.size} communities (${[...productSubreddits].slice(0, 4).map((s) => `r/${s}`).join(", ")})`,
        }),
      );
    }

    // Most recent activity is about this one product.
    if (others.length >= 3 && productSubs.length / others.length >= 0.5) {
      out.push(
        makeSignal("account.single-product-history", {
          explanation: `${productSubs.length} of the author's ${others.length} other recent posts concern the same product`,
        }),
      );
    }

    // Near-identical posts.
    const dup = findNearDuplicate(post, productSubs.length ? productSubs : others);
    if (dup) {
      out.push(
        makeSignal("history.repeated-text", {
          explanation: `u/${h.author} published a near-identical post in r/${dup.subreddit}${dup.createdUtc ? ` (${daysAgo(dup.createdUtc)})` : ""}`,
          excerpt: dup.title.slice(0, 80),
          sourceUrl: permalinkUrl(dup.permalink),
        }),
      );
    }

    // Comments that keep steering to the product.
    if (productComments.length >= 3 && productComments.length / Math.max(1, comments.length) >= 0.4) {
      out.push(
        makeSignal("account.comments-redirect", {
          explanation: `${productComments.length} of ${comments.length} recent comments mention the same product`,
        }),
      );
    }

    // The author says elsewhere that it is their product.
    const admission = findSelfIdentification([
      ...productSubs.map((s) => ({ text: `${s.title}\n${s.excerpt ?? ""}`, where: s.subreddit, when: s.createdUtc, url: permalinkUrl(s.permalink) })),
      ...productComments.map((c) => ({ text: c.excerpt, where: c.subreddit, when: c.createdUtc, url: undefined })),
    ]);
    if (admission) {
      out.push(
        makeSignal("account.self-identified-elsewhere", {
          verified: true,
          explanation: `In r/${admission.where}${admission.when ? ` (${daysAgo(admission.when)})` : ""} u/${h.author} describes the product as their own`,
          excerpt: admission.excerpt,
          sourceUrl: admission.url,
        }),
      );
    }
  }

  // Account context: weak, never decisive (caps and the style-only rule apply).
  const age = h.accountAgeDays;
  const karma = (h.linkKarma ?? 0) + (h.commentKarma ?? 0);
  const productShare = others.length ? productSubs.length / others.length : 0;
  if (age !== undefined && age < 30) out.push(makeSignal("account.new-account", { explanation: `Account is ${Math.max(0, Math.round(age))} days old (context only)` }));
  if (h.linkKarma !== undefined && h.commentKarma !== undefined && karma < 50) {
    out.push(makeSignal("account.low-karma", { explanation: `Very low karma (${karma}) (context only)` }));
  }
  if (age !== undefined && age < 30 && karma < 50 && productShare >= 0.5 && others.length >= 2) {
    out.push(makeSignal("account.new-low-karma-product-focus"));
  }

  // Counter-signals from history.
  if (hasTargets && others.length >= 5) {
    const externalDomains = new Set(others.flatMap(subDomains).filter((d) => !/reddit\.com|redd\.it/.test(d)));
    if (externalDomains.size >= 3 && productShare < 0.3) {
      out.push(
        makeSignal("counter.varied-recommendations", {
          explanation: `The author links to ${externalDomains.size} different sites in recent posts; this product is not a recurring one`,
        }),
      );
    }
  }
  if (total >= 10 && productMentions / total <= 0.1 && (age === undefined || age >= 365)) {
    out.push(
      makeSignal("counter.genuine-history", {
        explanation: `Long public history (${total} recent items${age !== undefined ? `, account ${Math.round(age / 365)}+ years old` : ""}) with little or no mention of this product`,
      }),
    );
  }
  if (hasTargets && total >= 8 && productMentions <= 1) {
    out.push(makeSignal("counter.incidental-product", { explanation: "The product does not recur in the author's other recent posts or comments" }));
  }

  return out;
}

/** Compact, content-light text for prompts and logs. */
export function summarizeHistory(h: AuthorHistory | undefined, maxItems = 25): string {
  if (!h) return "author history: not checked";
  if (!h.available) return `author history: unavailable (${describeReason(h.reason)})`;
  const lines: string[] = [];
  lines.push(
    `author history: ${h.submissions.length} recent posts, ${h.comments.length} recent comments` +
      (h.accountAgeDays !== undefined ? `, account age ${Math.round(h.accountAgeDays)} days` : "") +
      (h.linkKarma !== undefined ? `, karma ${(h.linkKarma ?? 0) + (h.commentKarma ?? 0)}` : ""),
  );
  for (const s of h.submissions.slice(0, maxItems)) {
    lines.push(`- [post] r/${s.subreddit}${s.createdUtc ? ` ${daysAgo(s.createdUtc)}` : ""}: "${s.title.slice(0, 120)}"${s.domain ? ` -> ${s.domain}` : ""}`);
  }
  for (const c of h.comments.slice(0, Math.max(0, maxItems - Math.min(h.submissions.length, maxItems)))) {
    lines.push(`- [comment] r/${c.subreddit}${c.createdUtc ? ` ${daysAgo(c.createdUtc)}` : ""}: "${c.excerpt.slice(0, 120)}"`);
  }
  return lines.join("\n");
}

/** Text the model may quote from when citing history (titles and excerpts). */
export function historyQuoteHaystack(h: AuthorHistory | undefined): string {
  if (!h || !h.available) return "";
  return [...h.submissions.map((s) => `${s.title}\n${s.excerpt ?? ""}`), ...h.comments.map((c) => c.excerpt)].join("\n");
}

function describeReason(reason: string | undefined): string {
  switch (reason) {
    case "private_or_suspended":
      return "profile is private, suspended or deleted";
    case "not_found":
      return "profile not found";
    case "rate_limited":
      return "Reddit rate limit reached; try again later";
    case "timeout":
      return "Reddit did not answer in time";
    case "fetch_failed":
      return "Reddit could not be reached";
    case "no_author":
      return "no author name visible";
    case "disabled":
      return "history check is turned off";
    default:
      return reason ?? "unknown reason";
  }
}

function stripT3(id: string): string {
  return id.toLowerCase().replace(/^t3_/, "");
}

function daysAgo(createdUtc: number): string {
  const days = Math.max(0, Math.round((Date.now() / 1000 - createdUtc) / 86400));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

function wordSet(text: string): Set<string> {
  return new Set(
    normalizeWhitespace(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

function findNearDuplicate(post: PostInput, candidates: HistorySubmission[]): HistorySubmission | undefined {
  const title = wordSet(post.title);
  const body = wordSet((post.body ?? "").slice(0, 1500));
  for (const s of candidates) {
    const t = wordSet(s.title);
    if (title.size >= 5 && jaccard(title, t) >= NEAR_DUPLICATE_JACCARD) return s;
    if (s.excerpt && body.size >= 20) {
      const e = wordSet(s.excerpt);
      if (e.size >= 15 && jaccard(body, e) >= NEAR_DUPLICATE_JACCARD) return s;
    }
  }
  return undefined;
}

function findSelfIdentification(
  items: { text: string; where: string; when?: number; url?: string }[],
): { where: string; when?: number; excerpt: string; url?: string } | undefined {
  for (const item of items) {
    const m =
      CREATOR_NAMED_RE.exec(item.text) ??
      CREATOR_RELATIVE_RE.exec(item.text) ??
      CLEAR_CREATOR_RE.exec(item.text) ??
      CLEAR_EMPLOYMENT_RE.exec(item.text) ??
      CLEAR_AFFILIATE_RE.exec(item.text);
    if (m) {
      const start = Math.max(0, m.index - 20);
      return { where: item.where, when: item.when, excerpt: normalizeWhitespace(item.text.slice(start, start + 90)), url: item.url };
    }
  }
  return undefined;
}

/** Absolute Reddit URL for a permalink path, for attribution links. */
function permalinkUrl(permalink: string | undefined): string | undefined {
  if (!permalink) return undefined;
  if (/^https?:\/\//i.test(permalink)) return permalink;
  return `https://www.reddit.com${permalink.startsWith("/") ? "" : "/"}${permalink}`;
}

export type { HistoryComment };
