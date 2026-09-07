/**
 * LLM "witness" provider.
 *
 * Design: the model is a witness, the rule engine is the judge.
 *
 *  - The rules run first on the server (same code as the browser).
 *  - The model is shown the post and the catalogue of *judgment* criteria
 *    (calls to action, narrative, workflow, marketing language, disclosure,
 *    counter-signals). It answers with criterion IDs, each backed by a verbatim
 *    quote from the post, plus optional retractions of rule signals it thinks
 *    are false positives (e.g. "one-click install" is a description, not a
 *    call to action).
 *  - Every quote is checked against the post text. A signal whose quote does
 *    not appear in the post is dropped - the model cannot invent evidence.
 *  - Retractions are only honoured for text-judgment categories. Links,
 *    affiliate parameters, account facts, comment evidence and reach are
 *    mechanical and stay as the rules found them.
 *  - The merged signals go through the shared scoring pipeline: same caps,
 *    same correlation discounts, same floor, same reach separation. The model
 *    never outputs a number.
 *
 * Transport is injected (`ChatClient`) so tests run without any network.
 */
import { z } from "zod";
import {
  detectAll,
  historyQuoteHaystack,
  listCriteria,
  makeSignal,
  scoreSignals,
  summarizeHistory,
  type AnalysisResult,
  type AnalyzeRequest,
  type Criterion,
  type Signal,
  type SignalCategory,
} from "@promolens/shared";
import type { AnalysisProvider } from "./types.js";

/** Minimal chat transport: returns the model's raw text for one exchange. */
export interface ChatClient {
  readonly name: string;
  complete(system: string, user: string, signal: AbortSignal): Promise<string>;
}

export interface LlmProviderOptions {
  /** Maximum characters of post body sent to the model. */
  maxBodyChars?: number;
  /** Signals with model confidence below this are ignored. */
  minConfidence?: number;
  /** Called with a one-line status (never post content). */
  log?: (line: string) => void;
}

/**
 * Categories the model may add signals to. Text judgments, plus the account
 * and repetition criteria it can support with quotes from the author's public
 * history when that was fetched.
 */
export const JUDGMENT_CATEGORIES: ReadonlySet<SignalCategory> = new Set<SignalCategory>([
  "direct-cta",
  "narrative",
  "workflow",
  "marketing-language",
  "disclosure",
  "counter-signal",
  "account",
  "repetition",
]);

/** Rule signals the model may retract: text judgments only, never mechanical facts. */
export const RETRACTABLE_CATEGORIES: ReadonlySet<SignalCategory> = new Set<SignalCategory>([
  "direct-cta",
  "narrative",
  "workflow",
  "marketing-language",
]);
/** Even inside retractable categories, link-derived signals are facts. */
const NEVER_RETRACT = new Set(["cta.repeated-links", "workflow.only-product-linked"]);

/** Claims in these categories describe the author's other activity and may quote the fetched history. */
const HISTORY_QUOTE_CATEGORIES: ReadonlySet<SignalCategory> = new Set<SignalCategory>(["account", "repetition"]);

const ModelOutputSchema = z.object({
  signals: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        quote: z.string().min(3).max(240),
        confidence: z.number().min(0).max(1),
        note: z.string().max(200).optional(),
      }),
    )
    .max(20)
    .default([]),
  retract: z
    .array(z.object({ id: z.string().min(1).max(64), reason: z.string().max(200).optional() }))
    .max(20)
    .default([]),
  /** Free-form findings outside the catalogue. Capped as a category; quote required. */
  observations: z
    .array(
      z.object({
        quote: z.string().min(3).max(240),
        direction: z.enum(["promotional", "organic"]),
        note: z.string().min(3).max(200),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(6)
    .default([]),
});
export type ModelOutput = z.infer<typeof ModelOutputSchema>;
const MAX_OBSERVATIONS = 3;

export class LlmWitnessProvider implements AnalysisProvider {
  readonly name: string;
  private readonly criteria: Criterion[];
  private readonly criteriaById: Map<string, Criterion>;
  private readonly systemPrompt: string;

  constructor(
    private readonly client: ChatClient,
    private readonly options: LlmProviderOptions = {},
  ) {
    this.name = client.name;
    this.criteria = listCriteria().filter(
      (c) => JUDGMENT_CATEGORIES.has(c.category) && c.availability !== "unavailable" && !c.requiresVerification,
    );
    this.criteriaById = new Map(this.criteria.map((c) => [c.id, c]));
    this.systemPrompt = buildSystemPrompt(this.criteria);
  }

  async analyze(request: AnalyzeRequest, signal: AbortSignal): Promise<AnalysisResult> {
    const post = request.post;
    const ruleSignals = detectAll(post).signals;
    const userPrompt = buildUserPrompt(post, ruleSignals, this.options.maxBodyChars ?? 6000);

    const started = Date.now();
    const raw = await this.client.complete(this.systemPrompt, userPrompt, signal);
    const output = parseModelOutput(raw); // throws on garbage -> 502, nothing cached
    this.options.log?.(
      `llm ${this.name}: ${output.signals.length} claims, ${output.retract.length} retractions, ${output.observations.length} observations (${Date.now() - started} ms)`,
    );

    const merged = this.merge(post.title, post.body ?? "", ruleSignals, output, historyQuoteHaystack(post.authorHistory));
    return scoreSignals(merged, post, "api");
  }

  /** Apply verified model claims, observations and permitted retractions to the rule signals. */
  merge(title: string, body: string, ruleSignals: Signal[], output: ModelOutput, historyText = ""): Signal[] {
    // Quotes for claims about *this post* (calls to action, narrative,
    // disclosure...) must come from the post. Only account/repetition claims
    // may quote the author's history - otherwise "I'm the founder" said in
    // another post would count as a disclosure here, which is exactly the
    // undisclosed case we must not miss.
    const postHaystack = normalizeForMatch(`${title}\n${body}`);
    const historyHaystack = historyText ? normalizeForMatch(historyText) : "";
    const haystackFor = (category: SignalCategory) =>
      HISTORY_QUOTE_CATEGORIES.has(category) ? `${postHaystack}\n${historyHaystack}` : postHaystack;
    const minConfidence = this.options.minConfidence ?? 0.6;

    const retracted = new Set<string>();
    for (const r of output.retract) {
      const existing = ruleSignals.find((s) => s.id === r.id);
      if (!existing) continue;
      if (!RETRACTABLE_CATEGORIES.has(existing.category) || NEVER_RETRACT.has(existing.id)) continue;
      if (existing.weight <= 0) continue; // never remove counter-signals
      retracted.add(r.id);
    }

    const kept = ruleSignals.filter((s) => !retracted.has(s.id));
    const present = new Set(kept.map((s) => s.id));
    let accepted = 0;
    let rejected = 0;

    for (const claim of output.signals) {
      const criterion = this.criteriaById.get(claim.id);
      if (!criterion || present.has(claim.id) || retracted.has(claim.id)) continue;
      if (claim.confidence < minConfidence) continue;
      if (!haystackFor(criterion.category).includes(normalizeForMatch(claim.quote))) {
        rejected++;
        continue; // quote not in the post (or, for history criteria, the history): no invented evidence
      }
      // Lower model confidence -> reduced weight; the category caps still apply.
      const factor = claim.confidence >= 0.85 ? 1 : 0.6;
      kept.push(
        makeSignal(claim.id, {
          weight: Math.round(criterion.weight * factor),
          explanation: claim.note && claim.note.trim() ? sanitizeNote(claim.note) : criterion.description,
          excerpt: claim.quote.trim().slice(0, 80),
        }),
      );
      present.add(claim.id);
      accepted++;
    }

    // Free-form observations: the model's own eyes, bounded by the
    // model-judgment category cap (15 points) and the quote requirement.
    let observations = 0;
    for (const obs of output.observations) {
      if (observations >= MAX_OBSERVATIONS) break;
      if (obs.confidence < minConfidence) continue;
      if (!`${postHaystack}\n${historyHaystack}`.includes(normalizeForMatch(obs.quote))) {
        rejected++;
        continue;
      }
      kept.push(
        makeSignal("model.observation", {
          weight: obs.direction === "organic" ? -8 : 8,
          explanation: `Model observation: ${sanitizeNote(obs.note)}`,
          excerpt: obs.quote.trim().slice(0, 80),
        }),
      );
      observations++;
    }

    kept.push({
      id: "api.llm-witness",
      category: "availability",
      explanation:
        `A language model (${this.name}) reviewed the post text${historyText ? " and the author's public history" : ""}; ` +
        `${accepted} claim(s) with verified quotes were used, ${observations} observation(s) added, ${rejected} without a matching quote were discarded, ` +
        `${retracted.size} rule signal(s) were withdrawn as false positives`,
      weight: 0,
      evidenceSource: "api",
      verified: true,
      affects: ["confidence"],
      strength: "info",
    });
    return kept;
  }
}

/** Parse the model's JSON. Tolerates code fences; rejects anything else. */
export function parseModelOutput(raw: string): ModelOutput {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    throw new Error("model output was not valid JSON");
  }
  const parsed = ModelOutputSchema.safeParse(json);
  if (!parsed.success) throw new Error("model output did not match the expected shape");
  return parsed.data;
}

export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeNote(note: string): string {
  // Keep explanations observational; strip anything that reads as an accusation.
  return note
    .replace(/\b(scam(?:mer)?|liar|lying|fraud|shill|astroturf(?:ing)?)\b/gi, "promotional")
    .trim()
    .slice(0, 160);
}

function buildSystemPrompt(criteria: Criterion[]): string {
  const catalogue = criteria.map((c) => `- ${c.id} [${c.category}${c.weight < 0 ? ", counter-signal" : ""}]: ${c.description}`).join("\n");
  return [
    "You are an evidence witness for PromoLens, a tool that estimates how likely a Reddit post is to be promotional.",
    "You do NOT decide the score. You report which criteria from the catalogue below are supported by the post text, each with a verbatim quote.",
    "",
    "Rules:",
    "1. Only use criterion IDs from the catalogue. Ignore anything else.",
    "2. Every claim needs a `quote`: an exact, verbatim excerpt (3-240 characters) copied from the post title or body. Claims whose quote is not found in the post are discarded automatically, so never paraphrase.",
    "3. Judge intent, not keywords. A description (\"one-click install from the Store\") is not a call to action; an instruction to the reader (\"download it here\") is. A question (\"where did your first 100 users come from?\") is not an offer.",
    "4. Counter-signals matter: honest limitations, balanced comparisons, useful advice with nothing to buy.",
    "5. If a rule signal listed under `ruleSignals` is a false positive, add its id to `retract` with a short reason. Only retract when you are confident.",
    "6. When an `author history` section is present, it lists the author's other recent public posts and comments. You may cite account/repetition criteria from it - quoting a history title or excerpt verbatim - for example the same product posted across several communities, or the author calling it their own elsewhere. Never use history text for disclosure claims: a disclosure only counts if it is in THIS post. Do not speculate beyond what is listed.",
    "7. Do not label anyone a scammer, liar, shill, or marketer. Notes must be neutral observations.",
    "8. When unsure, omit the claim. Fewer, well-supported claims beat many weak ones.",
    "9. `observations` is your own channel for anything promotional or organic that the catalogue does not name (an unusual pattern, a tell, a sign of genuineness). Each needs a verbatim quote, a direction, a short neutral note and a confidence. They count a little, never a lot.",
    "",
    "Respond with JSON only, in this exact shape:",
    '{"signals":[{"id":"cta.direct","quote":"...","confidence":0.0-1.0,"note":"optional short observation"}],"retract":[{"id":"cta.coupon","reason":"..."}],"observations":[{"quote":"...","direction":"promotional|organic","note":"...","confidence":0.0-1.0}]}',
    "",
    "Criteria catalogue:",
    catalogue,
  ].join("\n");
}

function buildUserPrompt(post: AnalyzeRequest["post"], ruleSignals: Signal[], maxBodyChars: number): string {
  const body = (post.body ?? "").slice(0, maxBodyChars);
  const links = (post.links ?? []).slice(0, 10);
  const rules = ruleSignals
    .filter((s) => s.weight !== 0)
    .map((s) => `- ${s.id} (${s.weight > 0 ? "+" : ""}${s.weight})${s.excerpt ? ` quote: "${s.excerpt}"` : ""}`)
    .join("\n");
  return [
    `subreddit: r/${post.subreddit ?? "unknown"}`,
    `title: ${post.title}`,
    "",
    "body:",
    body || "(no body text)",
    "",
    links.length ? `visible links:\n${links.map((l) => `- ${l}`).join("\n")}` : "visible links: none",
    "",
    summarizeHistory(post.authorHistory, 15), // keep the prompt small: slow models time out on long ones
    "",
    "ruleSignals (already detected by pattern rules; retract any that are false positives):",
    rules || "- none",
  ].join("\n");
}
