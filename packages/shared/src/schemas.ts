/**
 * Runtime validation schemas shared by the extension and the API.
 *
 * Both sides validate with the same definitions, so a malformed request never
 * reaches the analysis code and a malformed response never reaches the UI.
 */
import { z } from "zod";

import { MAX_BODY_CHARS, MAX_COMMENT_CHARS, MAX_COMMENTS, MAX_LINKS, MAX_TITLE_CHARS } from "./limits.js";

export const DisclosureStatusSchema = z.enum(["clear", "unclear", "missing", "unknown"]);
export const ConfidenceLevelSchema = z.enum(["low", "medium", "high"]);
export const ReachLevelSchema = z.enum(["low", "medium", "high"]);
export const UndisclosedRiskSchema = z.enum(["low", "medium", "high"]);

export const SignalEffectSchema = z.enum(["promotion", "disclosure", "confidence", "reach"]);
export const EvidenceSourceSchema = z.enum([
  "post-text", "post-links", "post-metadata", "page-body", "comments", "profile", "history", "external", "api",
]);
export const SignalCategorySchema = z.enum([
  "direct-cta", "account", "repetition", "workflow", "narrative", "marketing-language", "links",
  "comment-behavior", "community-evidence", "coordination", "engagement", "counter-signal", "disclosure", "model-judgment", "availability",
]);
export const SignalStrengthSchema = z.enum(["very-strong", "strong", "medium", "weak", "counter", "info"]);

export const SignalSchema = z.object({
  id: z.string().min(1).max(100),
  category: SignalCategorySchema,
  explanation: z.string().min(1).max(400),
  weight: z.number().min(-50).max(50),
  evidenceSource: EvidenceSourceSchema,
  verified: z.boolean(),
  affects: z.array(SignalEffectSchema).min(1),
  strength: SignalStrengthSchema,
  correlationGroup: z.string().max(60).optional(),
  excerpt: z.string().max(200).optional(),
  sourceUrl: z.string().max(2000).optional(),
});

export const VisibleCommentSchema = z.object({
  author: z.string().max(100).optional(),
  text: z.string().max(MAX_COMMENT_CHARS),
  isOp: z.boolean().optional(),
  depth: z.number().int().min(0).max(50).optional(),
});

export const HistorySubmissionSchema = z.object({
  id: z.string().max(40).optional(),
  subreddit: z.string().max(100),
  title: z.string().max(300),
  domain: z.string().max(253).optional(),
  url: z.string().max(2000).optional(),
  excerpt: z.string().max(400).optional(),
  createdUtc: z.number().optional(),
  permalink: z.string().max(500).optional(),
});

export const HistoryCommentSchema = z.object({
  subreddit: z.string().max(100),
  excerpt: z.string().max(400),
  createdUtc: z.number().optional(),
  linkDomains: z.array(z.string().max(253)).max(20).optional(),
  postTitle: z.string().max(300).optional(),
});

export const AuthorHistorySchema = z.object({
  author: z.string().max(100),
  fetchedAt: z.number(),
  available: z.boolean(),
  reason: z.string().max(60).optional(),
  accountAgeDays: z.number().min(0).optional(),
  linkKarma: z.number().optional(),
  commentKarma: z.number().optional(),
  submissions: z.array(HistorySubmissionSchema).max(100),
  comments: z.array(HistoryCommentSchema).max(100),
  truncated: z.boolean().optional(),
});

export const PostInputSchema = z.object({
  id: z.string().max(100).optional(),
  url: z.string().url().max(2000).optional(),
  title: z.string().min(1).max(MAX_TITLE_CHARS),
  body: z.string().max(MAX_BODY_CHARS).optional(),
  author: z.string().max(100).optional(),
  subreddit: z.string().max(100).optional(),
  upvotes: z.number().int().min(-1_000_000).max(100_000_000).optional(),
  commentsCount: z.number().int().min(0).max(100_000_000).optional(),
  ageHours: z.number().min(0).max(1_000_000).optional(),
  subredditSubscribers: z.number().int().min(0).max(1_000_000_000).optional(),
  outboundDomains: z.array(z.string().max(253)).max(MAX_LINKS).optional(),
  links: z.array(z.string().max(2000)).max(MAX_LINKS).optional(),
  brandAffiliateLabel: z.boolean().optional(),
  visibleComments: z.array(VisibleCommentSchema).max(MAX_COMMENTS).optional(),
  isDetailPage: z.boolean().optional(),
  authorHistory: AuthorHistorySchema.optional(),
});

export const AnalyzeRequestSchema = z.object({
  post: PostInputSchema,
  localSignals: z.array(SignalSchema).max(200).default([]),
  /** Content hash computed by the client; the server recomputes and compares. */
  contentHash: z.string().regex(/^[a-f0-9]{16}$/).optional(),
});

export const ReachSchema = z.object({
  level: ReachLevelSchema,
  explanation: z.string().max(300),
});

export const AnalysisResultSchema = z.object({
  promoLikelihood: z.number().int().min(0).max(100),
  label: z.string().min(1).max(80),
  disclosure: DisclosureStatusSchema,
  undisclosedRisk: UndisclosedRiskSchema,
  confidence: ConfidenceLevelSchema,
  reach: ReachSchema,
  reasons: z.array(z.string().min(1).max(300)).max(3),
  signals: z.array(SignalSchema).max(200),
  analysisVersion: z.string().min(1).max(20),
  source: z.enum(["local", "api"]),
});

export const AnalyzeResponseSchema = AnalysisResultSchema.extend({
  cached: z.boolean().optional(),
  contentHash: z.string().optional(),
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  provider: z.string(),
  uptimeSeconds: z.number(),
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
