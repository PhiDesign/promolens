/**
 * The verdict: what a reader most needs to know, in one line.
 *
 * "How promotional" and "how honest" are separate axes. The number answers the
 * first; the verdict combines both into the thing that matters:
 *
 *   organic      - little commercial machinery
 *   transparent  - promotional, and the author says so (fine)
 *   unclear      - promotional, connection only hinted or admitted late
 *   undisclosed  - promotional machinery with no disclosure (the sneaky case)
 *
 * For promotional posts a second line names the *technique* the promotion is
 * dressed in (a personal story, neutral advice, a workflow, a review...), so
 * readers learn to recognise the pattern next time. Wording stays observational:
 * "presented as", never "the author is a ...".
 */
import type { AnalysisResult } from "./types.js";

export type VerdictKind = "organic" | "transparent" | "unclear" | "undisclosed";

export interface Verdict {
  kind: VerdictKind;
  /** One line, e.g. "Possible undisclosed promotion". */
  headline: string;
  /** How the promotion is presented, when it is promotional. */
  technique?: string;
  /** True when the author's connection was found elsewhere but not in this post. */
  hiddenConnection: boolean;
}

export function verdictFor(result: Pick<AnalysisResult, "promoLikelihood" | "disclosure" | "signals">): Verdict {
  const ids = new Set(result.signals.map((s) => s.id));
  const score = result.promoLikelihood;
  const hiddenConnection = ids.has("account.self-identified-elsewhere") && result.disclosure !== "clear";

  if (score < 40 && !hiddenConnection) {
    return {
      kind: "organic",
      headline: score < 20 ? "Looks organic" : "Mostly organic, a few promotional signals",
      hiddenConnection: false,
    };
  }

  const technique = describeTechnique(ids, hiddenConnection, result.disclosure === "clear");

  if (result.disclosure === "clear") {
    return { kind: "transparent", headline: "Transparent promotion", technique, hiddenConnection: false };
  }
  if (result.disclosure === "unclear") {
    return { kind: "unclear", headline: "Promotion with an unclear connection", technique, hiddenConnection };
  }
  if (hiddenConnection || score >= 60) {
    return { kind: "undisclosed", headline: "Possible undisclosed promotion", technique, hiddenConnection };
  }
  return { kind: "undisclosed", headline: "Possibly promotional, connection not disclosed", technique, hiddenConnection };
}

function describeTechnique(ids: Set<string>, hiddenConnection: boolean, disclosed = false): string | undefined {
  const parts: string[] = [];

  if (hiddenConnection) {
    parts.push("Elsewhere the author describes this as their own product; this post does not say so");
  }

  const has = (...list: string[]) => list.some((id) => ids.has(id));
  let framing: string | undefined;
  if (has("workflow.only-product-linked", "workflow.obscure-among-familiar", "workflow.more-detail", "workflow.success-attributed")) {
    framing = disclosed
      ? "Presented as a workflow built around the author's own tool"
      : "Presented as a workflow in which one obscure tool gets the link and the credit";
  } else if (has("story.advice-then-product")) {
    framing = disclosed
      ? "Presented as advice that ends at the author's own product"
      : "Presented as neutral advice that ends by directing readers to a product";
  } else if (has("story.problem-product-success", "story.emotional-intro", "story.result-title-tool-body", "story.solves-everything")) {
    framing = disclosed ? "Told as the founder's own story, ending at their product" : "Presented as a personal story that ends at a product";
  } else if (has("cta.dm-request", "cta.comment-interested")) {
    framing = "Access is withheld behind a DM or a keyword comment";
  } else if (has("story.testimonial", "lang.hype-phrases", "lang.transformation") && has("link.product-link", "link.affiliate-params", "cta.coupon")) {
    framing = disclosed ? "The founder's own account of the product, with a link" : "Presented as a user's review or recommendation";
  } else if (has("lang.sales-page-format", "lang.feature-focus")) {
    framing = "Reads like a product page: features listed, little discussion";
  } else if (has("cta.direct", "cta.coupon", "cta.signup-benefit", "cta.waitlist")) {
    framing = "Asks readers directly to buy, sign up, or use a code";
  }
  if (framing) parts.push(framing);

  if (has("history.cross-subreddit", "account.repeats-domain", "history.repeated-text", "account.single-product-history")) {
    parts.push("the same product recurs in the author's other recent posts");
  }

  if (!parts.length) return undefined;
  // Join as sentences; the history note is a clause on the framing line.
  const [first, ...rest] = parts;
  if (rest.length === 0) return `${first}.`;
  if (hiddenConnection && rest.length === 2) return `${first}. ${rest[0]}; ${rest[1]}.`;
  if (hiddenConnection) return `${first}. ${rest[0]}.`;
  return `${first}; ${rest.join("; ")}.`;
}
