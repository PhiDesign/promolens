/**
 * Analysis pipeline for one post record (runs when the user clicks):
 *   extract -> author history (public, optional) -> hash -> page/persistent cache
 *          -> local rule-based score
 *          -> optional API enrichment (language-model witness)
 *          -> cache store
 *
 * With deeper analysis enabled the ring stays in the analysing state until the
 * final result, so the user sees one number, not a local score that later
 * jumps. If the API fails, the local result is shown instead.
 *
 * Every step checks the cancel token so results for posts that disappeared are
 * ignored, and every failure degrades to the local result instead of nothing.
 */
import { analyzePost, hashPostContent, type AnalysisResult, type AuthorHistory } from "@promolens/shared/light";
import { extractPost } from "../reddit/adapter.js";
import type { CacheGetResponse, EnrichResponse, HistoryResponse, PostGetResponse } from "../shared/messages.js";
import { PLUS_CHECKOUT_URL, PLUS_MONTHLY_ANALYSES, PLUS_PRICE_LABEL } from "../shared/hostedApp.js";
import type { Settings } from "../shared/settings.js";
import type { MessageLine } from "../ui/popover.js";
import { send } from "./bridge.js";
import { debug, warn } from "./debug.js";
import type { CancelToken } from "./queue.js";
import type { PostRecord } from "./scanner.js";

/** Results already computed on this page, keyed by content hash. */
const pageCache = new Map<string, AnalysisResult>();

export function clearPageCache(): void {
  pageCache.clear();
}

export async function analyzeRecord(record: PostRecord, settings: Settings, token: CancelToken): Promise<void> {
  try {
    await runPipeline(record, settings, token);
  } catch (err) {
    // Whatever happens, never leave a ring spinning forever.
    warn("analysis failed for", record.key, err);
    record.status = "error";
    record.ring.setError();
  }
}

async function runPipeline(record: PostRecord, settings: Settings, token: CancelToken): Promise<void> {
  if (token.cancelled || !record.el.isConnected) {
    debug("skip (cancelled or detached)", record.key);
    return;
  }
  record.status = "analyzing";
  record.ring.setAnalyzing();
  const started = performance.now();

  let post = extractPost(record.el);
  if (!post) {
    warn("could not extract post", record.key);
    record.status = "error";
    record.ring.setError();
    return;
  }
  debug("extracted", record.key, { bodyChars: post.body?.length ?? 0, links: post.links?.length ?? 0, comments: post.visibleComments?.length ?? 0, detail: !!post.isDetailPage });

  // 0. Feed card: fetch the full post in the background (body, links, top
  //    comments) so the score rests on the same data as on the post page.
  if (!post.isDetailPage && post.url) {
    const fetched = await send<PostGetResponse>({ type: "POST_GET", permalink: post.url });
    if (token.cancelled || !record.el.isConnected) return;
    if (fetched?.ok) {
      post = { ...fetched.post, id: fetched.post.id ?? post.id, brandAffiliateLabel: post.brandAffiliateLabel || fetched.post.brandAffiliateLabel };
      debug("fetched post page", record.key, { bodyChars: post.body?.length ?? 0, comments: post.visibleComments?.length ?? 0 });
    } else if (fetched && !fetched.ok && fetched.reason === "rate_limited") {
      warn("post fetch rate limited", record.key);
      record.status = "error";
      record.ring.setError("PromoLens: Reddit is rate-limiting requests; wait a minute and press to try again");
      return;
    } else {
      // Fall back to what the card shows; the availability notes lower confidence.
      debug("post fetch unavailable", record.key, fetched ? fetched.reason : "no response");
    }
  }

  // 1. The author's public posting history (only because the user clicked).
  if (settings.historyEnabled && post.author) {
    const history = await send<HistoryResponse>({ type: "HISTORY_GET", author: post.author });
    if (token.cancelled || !record.el.isConnected) return;
    if (history?.ok) {
      post.authorHistory = history.history;
      debug("history", record.key, history.history.available ? `${history.history.submissions.length} posts, ${history.history.comments.length} comments` : history.history.reason);
    } else {
      post.authorHistory = unavailableHistory(post.author, history ? history.reason : "no response");
      debug("history unavailable", record.key, post.authorHistory.reason);
    }
  } else if (post.author) {
    post.authorHistory = unavailableHistory(post.author, "disabled");
  }

  const hash = hashPostContent(post);
  record.hash = hash;

  // 2. Same content already analysed on this page?
  const known = pageCache.get(hash);
  if (known && (known.source === "api" || !settings.apiEnabled)) {
    finish(record, known, token);
    return;
  }

  // 3. Local rule-based score - synchronous, a few milliseconds, and it never
  //    depends on the background worker being awake.
  let result: AnalysisResult;
  try {
    result = analyzePost(post, "local");
  } catch (err) {
    warn("local analysis threw", record.key, err);
    record.status = "error";
    record.ring.setError();
    return;
  }
  if (token.cancelled || !record.el.isConnected) return;
  pageCache.set(hash, result);
  debug("local result", record.key, result.promoLikelihood, result.disclosure, result.confidence, `${Math.round(performance.now() - started)}ms`);
  // Without deeper analysis this is the final answer. With it, keep the ring
  // in the analysing state so the user sees a single number.
  if (!settings.apiEnabled) {
    record.ring.setResult(result);
    record.status = "done";
  }

  // 4. Persistent cache (24h by default) - may hold an API-enriched result.
  const cached = await send<CacheGetResponse>({ type: "CACHE_GET", hash });
  debug("cache lookup", record.key, cached ? (cached.result ? "hit" : "miss") : "no response", `${Math.round(performance.now() - started)}ms`);
  if (token.cancelled || !record.el.isConnected) return;
  if (cached?.result && (cached.result.source === "api" || !settings.apiEnabled)) {
    pageCache.set(hash, cached.result);
    finish(record, cached.result, token);
    return;
  }

  // 5. Deeper analysis through the local API (language-model witness).
  if (settings.apiEnabled) {
    const enriched = await send<EnrichResponse>({ type: "ENRICH", hash, post, localSignals: result.signals });
    debug("enrich", record.key, enriched ? (enriched.ok ? "ok" : enriched.reason) : "no response", `${Math.round(performance.now() - started)}ms`);
    if (token.cancelled || !record.el.isConnected) return;
    if (enriched?.ok) {
      pageCache.set(hash, enriched.result);
      finish(record, enriched.result, token);
      return; // background worker already cached it
    }
    if (enriched?.reason === "quota_exceeded") {
      // Out of included analyses: say so instead of quietly showing a rules-only
      // score the user would mistake for the real thing. Nothing is cached, so a
      // click after upgrading runs the full analysis.
      record.ring.setNotice("Included analyses used up", quotaNoticeLines(), "PromoLens: this month's included analyses are used up");
      record.status = "error";
      return;
    }
    // API unavailable or malformed: show the local result (its confidence
    // already reflects the limited evidence) and say why in the card footer.
    result = withEnrichFailure(result, enriched ? enriched.reason : "no_response");
    pageCache.set(hash, result);
  }

  if (!cached?.result) void send({ type: "CACHE_PUT", hash, result });
  finish(record, result, token);
}

export function quotaNoticeLines(): MessageLine[] {
  return [
    `You have used this month's free analyses. PromoLens Plus gives ${PLUS_MONTHLY_ANALYSES} a month for ${PLUS_PRICE_LABEL}.`,
    { text: "Upgrade to PromoLens Plus", href: PLUS_CHECKOUT_URL },
    "Or open the PromoLens toolbar popup and add your own OpenAI API key (unlimited, billed by OpenAI).",
  ];
}

/** Attach a zero-weight note explaining why deeper analysis did not happen. */
function withEnrichFailure(result: AnalysisResult, reason: string): AnalysisResult {
  return {
    ...result,
    signals: [
      ...result.signals.filter((s) => s.id !== "api.enrich-failed"),
      {
        id: "api.enrich-failed",
        category: "availability",
        explanation: `Deeper analysis was not applied (${describeEnrichFailure(reason)})`,
        weight: 0,
        evidenceSource: "api",
        verified: true,
        affects: ["confidence"],
        strength: "info",
      },
    ],
  };
}

export function describeEnrichFailure(reason: string): string {
  if (reason === "api_disabled") return "deeper analysis is switched off";
  if (reason === "no_key") return "no API key has been added yet";
  if (reason === "quota_exceeded") return "this month's included analyses are used up; upgrade to Plus or add your own key in the popup";
  if (reason === "bad_key") return "the provider rejected the API key";
  if (reason === "timeout") return "the API took too long to answer";
  if (reason === "invalid_response" || reason === "invalid_json") return "the API returned an unexpected answer";
  if (reason === "no_response") return "the background worker did not answer";
  if (/^http_5/.test(reason)) return "the API reported a server error";
  if (/^http_429/.test(reason)) return "the API is rate limited";
  if (/^http_/.test(reason)) return `the API answered ${reason.replace("_", " ")}`;
  if (reason === "unreachable" || reason === "network") return "the API is not running or not reachable";
  return reason.replace(/_/g, " ");
}

function unavailableHistory(author: string, reason: string): AuthorHistory {
  return { author, fetchedAt: Date.now(), available: false, reason, submissions: [], comments: [] };
}

function finish(record: PostRecord, result: AnalysisResult, token: CancelToken): void {
  if (token.cancelled || !record.el.isConnected) return;
  record.ring.setResult(result);
  record.status = "done";
}
