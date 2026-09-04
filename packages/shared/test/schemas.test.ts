import { describe, expect, it } from "vitest";
import { analyzePost, AnalysisResultSchema, AnalyzeRequestSchema, AnalyzeResponseSchema, MAX_BODY_CHARS } from "../src/index.js";

describe("AnalyzeRequestSchema", () => {
  it("accepts the documented example request", () => {
    const parsed = AnalyzeRequestSchema.safeParse({
      post: {
        id: "optional-id",
        url: "https://www.reddit.com/r/example/comments/abc/def/",
        title: "Post title",
        body: "Visible post text",
        author: "visible-author",
        subreddit: "example",
        upvotes: 2400,
        commentsCount: 184,
        outboundDomains: ["example.com"],
        visibleComments: [],
      },
      localSignals: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a missing title", () => {
    expect(AnalyzeRequestSchema.safeParse({ post: { body: "x" } }).success).toBe(false);
  });

  it("rejects oversized bodies and bad numbers", () => {
    expect(AnalyzeRequestSchema.safeParse({ post: { title: "t", body: "x".repeat(MAX_BODY_CHARS + 1) } }).success).toBe(false);
    expect(AnalyzeRequestSchema.safeParse({ post: { title: "t", upvotes: 1.5 } }).success).toBe(false);
    expect(AnalyzeRequestSchema.safeParse({ post: { title: "t", url: "not a url" } }).success).toBe(false);
  });

  it("defaults localSignals to an empty array", () => {
    const parsed = AnalyzeRequestSchema.parse({ post: { title: "t" } });
    expect(parsed.localSignals).toEqual([]);
  });
});

describe("AnalysisResultSchema", () => {
  it("accepts what the engine produces", () => {
    const result = analyzePost({ title: "I built a tool", body: "Try it at https://tool.app - my product, limitations apply." });
    expect(AnalysisResultSchema.safeParse(result).success).toBe(true);
    expect(AnalyzeResponseSchema.safeParse({ ...result, cached: false, contentHash: "abc" }).success).toBe(true);
  });

  it("rejects out-of-range scores and unknown enum values", () => {
    const result = analyzePost({ title: "x" });
    expect(AnalysisResultSchema.safeParse({ ...result, promoLikelihood: 101 }).success).toBe(false);
    expect(AnalysisResultSchema.safeParse({ ...result, promoLikelihood: -1 }).success).toBe(false);
    expect(AnalysisResultSchema.safeParse({ ...result, disclosure: "maybe" }).success).toBe(false);
    expect(AnalysisResultSchema.safeParse({ ...result, confidence: "certain" }).success).toBe(false);
  });

  it("rejects more than three reasons", () => {
    const result = analyzePost({ title: "x" });
    expect(AnalysisResultSchema.safeParse({ ...result, reasons: ["a", "b", "c", "d"] }).success).toBe(false);
  });
});
