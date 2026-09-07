/**
 * Core PromoLens types shared by the extension and the API.
 *
 * Vocabulary (see docs/architecture.md):
 * - Promotional likelihood: 0-100, "is this post trying to steer readers toward a product?"
 * - Disclosure: does the author visibly reveal a connection to the product?
 * - Confidence: how much independent, verifiable evidence did we actually have?
 * - Reach: how widely the post is seen. NEVER evidence of promotion.
 */

export type DisclosureStatus = "clear" | "unclear" | "missing" | "unknown";
export type ConfidenceLevel = "low" | "medium" | "high";
export type ReachLevel = "low" | "medium" | "high";
export type UndisclosedRisk = "low" | "medium" | "high";

/** Which of the four displayed concepts a signal can influence. */
export type SignalEffect = "promotion" | "disclosure" | "confidence" | "reach";

/** Where the evidence for a signal came from. */
export type EvidenceSource =
  | "post-text"
  | "post-links"
  | "post-metadata"
  | "page-body"
  | "comments"
  | "profile"
  | "history"
  | "external"
  | "api";

/**
 * Categories map to the sections of the criteria document. Category caps in
 * scoring.ts stop many correlated signals from one category piling up.
 */
export type SignalCategory =
  | "direct-cta"
  | "account"
  | "repetition"
  | "workflow"
  | "narrative"
  | "marketing-language"
  | "links"
  | "comment-behavior"
  | "community-evidence"
  | "coordination"
  | "engagement"
  | "counter-signal"
  | "disclosure"
  | "model-judgment"
  | "availability";

export type SignalStrength =
  | "very-strong"
  | "strong"
  | "medium"
  | "weak"
  | "counter"
  | "info";

/**
 * Describes when a criterion can be evaluated.
 * - "local": detectable from the visible post in this milestone
 * - "page": needs the post detail page (full body / visible comments)
 * - "history": needs the author's public posting history (fetched on click)
 * - "unavailable": needs external data we do not have.
 *   Represented so the model is complete, but never fabricated.
 */
export type CriterionAvailability = "local" | "page" | "history" | "unavailable";

/** A criterion is the *definition* of something we look for. */
export interface Criterion {
  id: string;
  category: SignalCategory;
  description: string;
  strength: SignalStrength;
  /** Default points contributed when detected (negative for counter-signals). */
  weight: number;
  /** Upper bound for this criterion when the detector reports a variable weight. */
  maxWeight?: number;
  affects: SignalEffect[];
  evidenceSource: EvidenceSource;
  /** True when the criterion only counts fully after verification. */
  requiresVerification: boolean;
  availability: CriterionAvailability;
  /**
   * Signals in the same correlation group describe overlapping evidence
   * (e.g. "asks to DM" and "comment 'interested'"). Only the strongest one in a
   * group counts fully; the rest are discounted so we do not double count.
   */
  correlationGroup?: string;
}

/** A signal is a criterion that was actually *detected* on a specific post. */
export interface Signal {
  id: string;
  category: SignalCategory;
  explanation: string;
  weight: number;
  evidenceSource: EvidenceSource;
  verified: boolean;
  affects: SignalEffect[];
  strength: SignalStrength;
  correlationGroup?: string;
  /** Short quoted evidence, when safe and useful (kept short on purpose). */
  excerpt?: string;
  /** Link back to the Reddit content the evidence came from (attribution). */
  sourceUrl?: string;
}

export interface VisibleComment {
  author?: string;
  text: string;
  /** True when the comment author is the post author. */
  isOp?: boolean;
  depth?: number;
}

/** What we extract from a Reddit post. Only visible, necessary information. */
export interface PostInput {
  id?: string;
  url?: string;
  title: string;
  body?: string;
  author?: string;
  subreddit?: string;
  upvotes?: number;
  commentsCount?: number;
  /** Age of the post in hours, if visible. */
  ageHours?: number;
  outboundDomains?: string[];
  /** Full URLs visible in the post (title link + links inside body). */
  links?: string[];
  /** Reddit's "Brand Affiliate" label, when visibly present. */
  brandAffiliateLabel?: boolean;
  /** Only available on the post detail page. */
  visibleComments?: VisibleComment[];
  /** True when the input came from a detail page (full body, comments). */
  isDetailPage?: boolean;
  /** The author's public recent activity, when the user asked for it. */
  authorHistory?: AuthorHistory;
}

/** One of the author's other recent public posts (compact, content-light). */
export interface HistorySubmission {
  id?: string;
  subreddit: string;
  title: string;
  /** Outbound domain for link posts. */
  domain?: string;
  url?: string;
  /** First few hundred characters of a text post. */
  excerpt?: string;
  createdUtc?: number;
  permalink?: string;
}

export interface HistoryComment {
  subreddit: string;
  excerpt: string;
  createdUtc?: number;
  linkDomains?: string[];
  postTitle?: string;
}

/**
 * The author's public recent activity, fetched only when the user asks for an
 * analysis. `available: false` means it could not be read (private, suspended,
 * rate-limited...) - the engine then lowers confidence rather than guessing.
 */
export interface AuthorHistory {
  author: string;
  fetchedAt: number;
  available: boolean;
  reason?: string;
  accountAgeDays?: number;
  linkKarma?: number;
  commentKarma?: number;
  submissions: HistorySubmission[];
  comments: HistoryComment[];
  truncated?: boolean;
}

export interface Reach {
  level: ReachLevel;
  explanation: string;
}

export interface AnalysisResult {
  promoLikelihood: number;
  label: string;
  disclosure: DisclosureStatus;
  undisclosedRisk: UndisclosedRisk;
  confidence: ConfidenceLevel;
  reach: Reach;
  reasons: string[];
  signals: Signal[];
  analysisVersion: string;
  /** "local" = rule engine in the browser; "api" = enriched by the local API. */
  source: "local" | "api";
}

export const ANALYSIS_VERSION = "0.1.0";
