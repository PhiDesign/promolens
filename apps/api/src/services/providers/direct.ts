/**
 * EXPERIMENTAL: model-only scoring.
 *
 * The model is given the full criteria catalogue and the scoring rules as
 * guidance and asked to produce the score, disclosure and confidence itself.
 * Nothing in the rule engine constrains the number. This provider exists so
 * the evaluation harness (apps/api/eval) can compare "AI only" against
 * "rules only" and "rules + AI witness" on the same posts. It is not the
 * default and is not recommended for the extension until that comparison
 * says otherwise - see docs/evaluation.md.
 *
 * Reach is still computed from the visible numbers by the rule engine, because
 * it is arithmetic on votes/comments/age rather than a judgment.
 */
import { z } from "zod";
import {
  ANALYSIS_VERSION,
  CATEGORY_CAPS,
  clampScore,
  computeReach,
  listCriteria,
  scoreLabel,
  type AnalysisResult,
  type AnalyzeRequest,
  type Criterion,
  type Signal,
} from "@promolens/shared";
import { summarizeHistory } from "@promolens/shared";
import { normalizeForMatch, type ChatClient } from "./llm.js";
import type { AnalysisProvider } from "./types.js";


const DirectOutputSchema = z.object({
  promoLikelihood: z.number().min(0).max(100),
  disclosure: z.enum(["clear", "unclear", "missing", "unknown"]),
  undisclosedRisk: z.enum(["low", "medium", "high"]).optional(),
  confidence: z.enum(["low", "medium", "high"]),
  reasons: z.array(z.string().min(3).max(200)).min(1).max(3),
  evidence: z.array(z.object({ quote: z.string().min(3).max(240), criterionId: z.string().max(64).optional() })).max(12).default([]),
  note: z.string().max(300).optional(),
});
export type DirectOutput = z.infer<typeof DirectOutputSchema>;

export interface DirectProviderOptions {
  maxBodyChars?: number;
  log?: (line: string) => void;
}

export class DirectLlmProvider implements AnalysisProvider {
  readonly name: string;
  private readonly systemPrompt: string;

  constructor(
    private readonly client: ChatClient,
    private readonly options: DirectProviderOptions = {},
  ) {
    this.name = `${client.name}:direct`;
    this.systemPrompt = buildDirectSystemPrompt(listCriteria());
  }

  async analyze(request: AnalyzeRequest, signal: AbortSignal): Promise<AnalysisResult> {
    const post = request.post;
    const started = Date.now();
    const raw = await this.client.complete(this.systemPrompt, buildDirectUserPrompt(post, this.options.maxBodyChars ?? 6000), signal);
    const output = parseDirectOutput(raw);

    const haystack = normalizeForMatch(`${post.title}\n${post.body ?? ""}`);
    const verified = output.evidence.filter((e) => haystack.includes(normalizeForMatch(e.quote)));
    const unverified = output.evidence.length - verified.length;
    this.options.log?.(`llm-direct ${this.name}: score ${Math.round(output.promoLikelihood)}, ${verified.length} verified quotes, ${unverified} unverified (${Date.now() - started} ms)`);

    const score = clampScore(output.promoLikelihood);
    const disclosure = output.disclosure;
    const undisclosedRisk =
      output.undisclosedRisk ?? (disclosure === "clear" ? "low" : score >= 60 ? "high" : score >= 40 ? "medium" : "low");

    const signals: Signal[] = verified.map((e) => ({
      id: "api.llm-direct-evidence",
      category: "availability",
      explanation: e.criterionId ? `Model cited ${e.criterionId}` : "Model-cited evidence",
      weight: 0,
      evidenceSource: "api",
      verified: true,
      affects: ["confidence"],
      strength: "info",
      excerpt: e.quote.trim().slice(0, 80),
    }));
    signals.push({
      id: "api.llm-direct",
      category: "availability",
      explanation:
        `EXPERIMENTAL: score produced directly by a language model (${this.client.name}); ` +
        `${verified.length} quote(s) verified, ${unverified} could not be found in the post` +
        (output.note ? `. Model note: ${sanitize(output.note)}` : ""),
      weight: 0,
      evidenceSource: "api",
      verified: true,
      affects: ["confidence"],
      strength: "info",
    });

    return {
      promoLikelihood: score,
      label: scoreLabel(score),
      disclosure,
      undisclosedRisk,
      confidence: output.confidence,
      reach: computeReach(post),
      reasons: output.reasons.map(sanitize).slice(0, 3),
      signals,
      analysisVersion: ANALYSIS_VERSION,
      source: "api",
    };
  }
}

export function parseDirectOutput(raw: string): DirectOutput {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    throw new Error("model output was not valid JSON");
  }
  const parsed = DirectOutputSchema.safeParse(json);
  if (!parsed.success) throw new Error("model output did not match the expected shape");
  return parsed.data;
}

function sanitize(text: string): string {
  return text
    .replace(/\b(scam(?:mer)?|liar|lying|fraud|shill|astroturf(?:ing)?)\b/gi, "promotional")
    .trim()
    .slice(0, 200);
}

function buildDirectSystemPrompt(criteria: Criterion[]): string {
  const catalogue = criteria
    .map((c) => {
      const w = c.weight > 0 ? `+${c.weight}` : String(c.weight);
      const avail = c.availability === "unavailable" ? " [needs data you do not have - do not assume]" : "";
      return `- ${c.id} [${c.category}, ${w}${c.requiresVerification ? ", needs verification" : ""}]${avail}: ${c.description}`;
    })
    .join("\n");
  const caps = Object.entries(CATEGORY_CAPS)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  return [
    "You are the scoring engine for PromoLens, which estimates how likely a Reddit post is to be promotional.",
    "Use the criteria below as your guidance. They come from experience; you may also use your own judgment about intent, but every point you award must be tied to something observable in the text.",
    "",
    "Output ranges: 0-19 unlikely promotional; 20-39 some promotional characteristics; 40-59 possibly promotional; 60-79 likely promotional; 80-100 highly likely promotional.",
    "Principles you must respect:",
    "- Promotional likelihood measures how promotional the post is, NOT whether it is dishonest. A transparent 'I built this, here is the link' post is highly promotional (80+) with disclosure 'clear'.",
    "- Disclosure: clear = explicit creator/employee/affiliate/paid/gifted statement where readers see it; unclear = vague ('something I've been working on', buried at the end); missing = commercial evidence with no disclosure; unknown = nothing to disclose.",
    "- Confidence reflects how much evidence you had, not how high the score is. Without author history or comments, be modest.",
    "- Upvotes and comment counts describe reach. They must not change the promotional likelihood at all.",
    "- Weak signals (polished writing, AI-like style, obscure product, account age) can never produce a high score on their own.",
    `- Do not let many similar signals pile up; per-category limits used by the reference engine: ${caps}.`,
    "- A single unsupported 'this is an ad' comment is worth at most +2. Copied or coordinated accusations count for nothing.",
    "- Never describe the author as a scammer, liar, shill or marketer. Use 'likely promotional', 'possible undisclosed promotion', 'limited evidence'.",
    "- Never invent facts. Cite evidence with verbatim quotes from the post; quotes that are not in the post will be flagged.",
    "",
    "Respond with JSON only:",
    '{"promoLikelihood": 0-100, "disclosure": "clear|unclear|missing|unknown", "undisclosedRisk": "low|medium|high", "confidence": "low|medium|high", "reasons": ["up to three short observable reasons"], "evidence": [{"quote": "verbatim excerpt", "criterionId": "optional id"}], "note": "optional one-sentence judgment"}',
    "",
    "Criteria catalogue:",
    catalogue,
  ].join("\n");
}

function buildDirectUserPrompt(post: AnalyzeRequest["post"], maxBodyChars: number): string {
  const comments = (post.visibleComments ?? []).slice(0, 20);
  return [
    `subreddit: r/${post.subreddit ?? "unknown"}`,
    `title: ${post.title}`,
    `author: ${post.author ?? "(not visible)"}`,
    `upvotes: ${post.upvotes ?? "(not visible)"}, comments: ${post.commentsCount ?? "(not visible)"}, age hours: ${post.ageHours ?? "(not visible)"}`,
    post.brandAffiliateLabel ? "reddit label: Brand Affiliate" : "",
    "",
    "body:",
    (post.body ?? "").slice(0, maxBodyChars) || "(no body text)",
    "",
    (post.links ?? []).length ? `visible links:\n${(post.links ?? []).slice(0, 10).map((l) => `- ${l}`).join("\n")}` : "visible links: none",
    "",
    comments.length
      ? `visible comments:\n${comments.map((c) => `- ${c.isOp ? "[OP] " : ""}${c.author ?? "someone"}: ${c.text.slice(0, 300)}`).join("\n")}`
      : "visible comments: none (feed view)",
    "",
    summarizeHistory(post.authorHistory),
  ]
    .filter((line) => line !== "")
    .join("\n");
}
