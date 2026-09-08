/**
 * PromoLens scoring engine.
 *
 * Turns detected Signals into the four displayed concepts:
 *   promotional likelihood (0-100), disclosure, confidence, reach.
 *
 * Design rules (see docs/architecture.md):
 *  - Correlated signals are discounted so we do not double count.
 *  - Every category has a cap, so many similar signals cannot alone create a
 *    high score.
 *  - Style-only evidence (narrative, language, engagement) is capped at 39
 *    unless at least one behavioural category contributes.
 *  - Reach never adds promotion points.
 *  - Confidence is computed separately from the score.
 */
import {
  BEHAVIORAL_CATEGORIES,
  CATEGORY_CAPS,
  CONFIRMED_PROMOTION_FLOOR,
  CORRELATION_DISCOUNT,
  STYLE_ONLY_CAP,
  UNVERIFIED_DISCOUNT,
  getCriterion,
} from "./criteria.js";
import { detectAll } from "./detectors.js";
import { scoreLabel } from "./labels.js";
import type {
  AnalysisResult,
  ConfidenceLevel,
  DisclosureStatus,
  PostInput,
  Reach,
  Signal,
  UndisclosedRisk,
} from "./types.js";
import { ANALYSIS_VERSION } from "./types.js";

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** A signal plus the weight it actually contributed after discounts and caps. */
export interface WeightedSignal {
  signal: Signal;
  effectiveWeight: number;
}

/**
 * Apply verification and correlation discounts. Returns the per-signal
 * effective weights before category caps.
 */
export function applyDiscounts(signals: Signal[]): WeightedSignal[] {
  const promo = signals.filter((s) => s.affects.includes("promotion") && s.weight !== 0);

  // Verification discount
  const weighted: WeightedSignal[] = promo.map((signal) => {
    let w = signal.weight;
    let requires = false;
    try {
      requires = getCriterion(signal.id).requiresVerification;
    } catch {
      requires = false;
    }
    if (requires && !signal.verified) w = w * UNVERIFIED_DISCOUNT;
    return { signal, effectiveWeight: w };
  });

  // Correlation discount: strongest in each group counts fully.
  const groups = new Map<string, WeightedSignal[]>();
  for (const ws of weighted) {
    const g = ws.signal.correlationGroup;
    if (!g) continue;
    const list = groups.get(g) ?? [];
    list.push(ws);
    groups.set(g, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => Math.abs(b.effectiveWeight) - Math.abs(a.effectiveWeight));
    for (let i = 1; i < list.length; i++) {
      list[i]!.effectiveWeight = list[i]!.effectiveWeight * CORRELATION_DISCOUNT;
    }
  }
  return weighted;
}

export interface ScoreBreakdown {
  score: number;
  perCategory: Record<string, number>;
  weighted: WeightedSignal[];
  styleOnlyCapApplied: boolean;
}

/** Sum weights per category, apply caps, then the style-only cap, then clamp. */
export function computePromoScore(signals: Signal[]): ScoreBreakdown {
  const weighted = applyDiscounts(signals);
  const perCategory: Record<string, number> = {};
  for (const ws of weighted) {
    perCategory[ws.signal.category] = (perCategory[ws.signal.category] ?? 0) + ws.effectiveWeight;
  }
  // Category caps
  for (const [cat, sum] of Object.entries(perCategory)) {
    const cap = CATEGORY_CAPS[cat];
    if (cap === undefined) continue;
    perCategory[cat] = cap >= 0 ? Math.min(sum, cap) : Math.max(sum, cap);
  }

  let positive = 0;
  let negative = 0;
  let stylePositive = 0;
  let behavioralPositive = 0;
  for (const [cat, sum] of Object.entries(perCategory)) {
    if (sum >= 0) {
      positive += sum;
      if (BEHAVIORAL_CATEGORIES.has(cat)) behavioralPositive += sum;
      else stylePositive += sum;
    } else negative += sum;
  }

  // Weak/style signals must never independently create a high score.
  let styleOnlyCapApplied = false;
  if (behavioralPositive < 8 && stylePositive > STYLE_ONLY_CAP) {
    positive = behavioralPositive + STYLE_ONLY_CAP;
    styleOnlyCapApplied = true;
  }

  let score = clampScore(positive + negative);

  // When the author confirms a connection AND asks readers to act (link or
  // call to action), promotion is confirmed by the author's own words.
  // Counter-signals still matter for *how* it is promoted, but the post
  // cannot reasonably be called "unlikely promotional".
  const ids = new Set(signals.map((s) => s.id));
  const selfConnection = [...SELF_CONNECTION_IDS].some((id) => ids.has(id));
  const asksToAct = signals.some((s) => ASK_IDS.has(s.id));
  if (selfConnection && asksToAct) score = Math.max(score, CONFIRMED_PROMOTION_FLOOR);

  return { score, perCategory, weighted, styleOnlyCapApplied };
}

/** Signals that are a genuine ask of the reader (used for the confirmed-promotion floor). */
export const ASK_IDS: ReadonlySet<string> = new Set([
  "cta.direct",
  "cta.coupon",
  "cta.signup-benefit",
  "cta.comment-interested",
  "cta.dm-request",
  "cta.repeated-links",
  "link.product-link",
  "link.affiliate-params",
  "workflow.only-product-linked",
]);

/** Signals in which the author confirms a product connection. */
export const SELF_CONNECTION_IDS: ReadonlySet<string> = new Set([
  "disclosure.creator",
  "disclosure.employment",
  "disclosure.material-benefit",
  "disclosure.affiliate",
  "community.author-admission",
]);

const CLEAR_IDS = new Set([
  "disclosure.creator",
  "disclosure.employment",
  "disclosure.material-benefit",
  "disclosure.affiliate",
  "disclosure.brand-affiliate-label",
]);
const UNCLEAR_IDS = new Set([
  "disclosure.unclear-working-on",
  "disclosure.unclear-involved",
  "disclosure.friends-product",
  "disclosure.buried",
  "disclosure.comments-only",
  "community.author-admission",
]);

export function computeDisclosure(signals: Signal[], score: number): DisclosureStatus {
  const ids = new Set(signals.map((s) => s.id));
  const hasClear = [...CLEAR_IDS].some((id) => ids.has(id));
  const buried = ids.has("disclosure.buried");
  if (hasClear && !buried) return "clear";
  if (hasClear && buried) return "unclear";
  if ([...UNCLEAR_IDS].some((id) => ids.has(id))) return "unclear";

  // Something to disclose? Only when there is commercial/product evidence
  // *and* the post reads as at least somewhat promotional. A single medium
  // signal on an otherwise organic post ("X mentioned next to GitHub") is not
  // a missing disclosure - there is nothing to disclose.
  const commercial = signals.some(
    (s) =>
      s.affects.includes("promotion") &&
      s.weight >= 8 &&
      ["direct-cta", "links", "workflow", "account", "community-evidence", "comment-behavior"].includes(s.category),
  );
  if ((commercial && score >= 20) || score >= 40) return "missing";
  return "unknown";
}

export function computeUndisclosedRisk(score: number, disclosure: DisclosureStatus): UndisclosedRisk {
  if (disclosure === "clear") return "low";
  if (score >= 60) return "high";
  if (score >= 40) return "medium";
  return "low";
}

/**
 * Confidence reflects *how much evidence we had*, not how high the score is.
 * Points come from signal strength and verification, plus a bonus for evidence
 * spread across independent sources. Missing sources cap the level.
 */
export function computeConfidence(signals: Signal[], weighted: WeightedSignal[], post: PostInput): ConfidenceLevel {
  let points = 0;
  const sources = new Set<string>();
  let hasVerifiedVeryStrong = false;

  for (const ws of weighted) {
    const s = ws.signal;
    let requires = false;
    try {
      requires = getCriterion(s.id).requiresVerification;
    } catch {
      /* unknown id from API: treat as not requiring verification */
    }
    const unverified = requires && !s.verified;
    let p = 0;
    switch (s.strength) {
      case "very-strong": p = 3; break;
      case "strong": p = 2; break;
      case "medium": p = 1; break;
      case "weak": p = 0.25; break;
      case "counter": p = 1; break;
      default: p = 0;
    }
    if (unverified) p = 0.25;
    if (s.strength === "very-strong" && !unverified) hasVerifiedVeryStrong = true;
    points += p;
    sources.add(s.evidenceSource);
  }
  points += Math.max(0, sources.size - 1) * 0.5;

  let level: ConfidenceLevel = points < 2.5 ? "low" : points < 6 ? "medium" : "high";

  // Without comments/history, only a verified very strong signal (e.g. an
  // explicit self-disclosure or affiliate parameters) justifies "high".
  if (!post.isDetailPage && !hasVerifiedVeryStrong && level === "high") level = "medium";

  // Coordinated / copied accusations reduce trust in comment evidence.
  if (signals.some((s) => s.id === "community.coordinated-accusations")) {
    level = level === "high" ? "medium" : "low";
  }
  return level;
}

/**
 * Reach is approximate: it uses visible votes, comments and age. A proper
 * implementation compares against similar posts in the same subreddit, which
 * needs data we do not have yet (see docs/architecture.md, "Roadmap").
 */
export function computeReach(post: PostInput): Reach {
  const up = post.upvotes;
  const comments = post.commentsCount;
  const age = post.ageHours;
  if (typeof up !== "number" && typeof comments !== "number") {
    return { level: "low", explanation: "Vote and comment counts were not visible" };
  }
  const votes = up ?? 0;
  const perHour = age && age > 0 ? votes / age : undefined;
  const members = post.subredditSubscribers;
  let level: Reach["level"] = "low";
  if (members && members >= 1000) {
    // Relative to the community: 300 upvotes is a big deal in a 20k-member
    // subreddit and background noise in a 20M one. Per-thousand-members
    // thresholds, with absolute floors so a small community's "high" is
    // still a real audience.
    const perThousand = (votes / members) * 1000;
    const commentsPerThousand = ((comments ?? 0) / members) * 1000;
    if ((perThousand >= 2 && votes >= 50) || (commentsPerThousand >= 0.5 && (comments ?? 0) >= 30) || votes >= 5000) level = "high";
    else if ((perThousand >= 0.4 && votes >= 15) || (commentsPerThousand >= 0.1 && (comments ?? 0) >= 10) || votes >= 500) level = "medium";
  } else {
    if (votes >= 1000 || (perHour !== undefined && perHour >= 150) || (comments ?? 0) >= 300) level = "high";
    else if (votes >= 100 || (perHour !== undefined && perHour >= 25) || (comments ?? 0) >= 50) level = "medium";
  }

  const parts: string[] = [];
  if (typeof up === "number") parts.push(`${up.toLocaleString("en-US")} upvotes`);
  if (typeof comments === "number") parts.push(`${comments.toLocaleString("en-US")} comments`);
  let explanation = parts.join(" and ");
  if (age !== undefined) explanation += ` on a ${formatAge(age)} post`;
  if (members && members >= 1000) explanation += ` in a ${formatMembers(members)}-member community`;
  explanation += " (approximate; reach is not evidence of promotion)";
  return { level, explanation };
}

function formatMembers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  return `${Math.round(n / 1000)}k`;
}

function formatAge(hours: number): string {
  if (hours < 1) return "less-than-an-hour-old";
  if (hours < 48) return `${Math.round(hours)}-hour-old`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days}-day-old`;
  return `${Math.round(days / 30)}-month-old`;
}

/** Pick the three strongest human-readable reasons. */
export function pickReasons(weighted: WeightedSignal[], signals: Signal[], disclosure: DisclosureStatus, score: number): string[] {
  // Strongest evidence first. For an organic-looking result, lead with what
  // made it organic (the counter-signals) rather than the promotional hints
  // they outweighed, so the reasons agree with the verdict.
  const organic = score < 40;
  const ranked = [...weighted]
    .filter((ws) => Math.abs(ws.effectiveWeight) >= 2)
    .sort((a, b) => {
      if (organic && Math.sign(a.effectiveWeight) !== Math.sign(b.effectiveWeight)) return a.effectiveWeight < 0 ? -1 : 1;
      return Math.abs(b.effectiveWeight) - Math.abs(a.effectiveWeight);
    });

  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const ws of ranked) {
    const text = ws.signal.explanation;
    if (seen.has(text)) continue;
    seen.add(text);
    reasons.push(text);
    if (reasons.length === 3) break;
  }

  // Disclosure context is always worth a reason when promotion is plausible.
  if (reasons.length < 3 && disclosure === "missing" && score >= 40 && !reasons.some((r) => /disclos/i.test(r))) {
    reasons.push("No author-product connection is disclosed");
  }

  // Fill with availability notes so low-evidence results explain themselves.
  if (reasons.length < 3) {
    for (const s of signals) {
      if (s.category !== "availability") continue;
      if (reasons.length >= 3) break;
      if (s.id === "availability.profile-history-unavailable") reasons.push("Limited evidence: author history was not available");
      else if (s.id === "availability.comments-unavailable") reasons.push("Limited evidence: comments were not visible");
    }
  }
  return reasons.slice(0, 3);
}

/** Score an already-detected list of signals. */
export function scoreSignals(signals: Signal[], post: PostInput, source: AnalysisResult["source"] = "local"): AnalysisResult {
  const breakdown = computePromoScore(signals);
  const disclosure = computeDisclosure(signals, breakdown.score);
  const confidence = computeConfidence(signals, breakdown.weighted, post);
  const reach = computeReach(post);
  const reasons = pickReasons(breakdown.weighted, signals, disclosure, breakdown.score);
  return {
    promoLikelihood: breakdown.score,
    label: scoreLabel(breakdown.score),
    disclosure,
    undisclosedRisk: computeUndisclosedRisk(breakdown.score, disclosure),
    confidence,
    reach,
    reasons,
    signals,
    analysisVersion: ANALYSIS_VERSION,
    source,
  };
}

/** Full local analysis: detect signals, then score. */
export function analyzePost(post: PostInput, source: AnalysisResult["source"] = "local"): AnalysisResult {
  const { signals } = detectAll(post);
  return scoreSignals(signals, post, source);
}
