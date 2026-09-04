import type { AnalysisResult, ConfidenceLevel, DisclosureStatus } from "./types.js";
import { verdictFor } from "./verdict.js";

export function scoreLabel(score: number): string {
  if (score <= 19) return "Unlikely promotional";
  if (score <= 39) return "Some promotional characteristics";
  if (score <= 59) return "Possibly promotional";
  if (score <= 79) return "Likely promotional";
  return "Highly likely promotional";
}

export function disclosureLabel(d: DisclosureStatus): string {
  switch (d) {
    case "clear": return "Connection disclosed by author";
    case "unclear": return "Connection mentioned but unclear";
    case "missing": return "Connection not disclosed";
    case "unknown": return "No connection to disclose detected";
  }
}

export function confidenceLabel(c: ConfidenceLevel): string {
  return `${c.charAt(0).toUpperCase()}${c.slice(1)} confidence`;
}

export type RingState = "idle" | "analyzing" | "green" | "amber" | "red" | "error";

/**
 * Ring colour rules:
 *  idle   - not analysed yet (gray outline; click to analyse)
 *  green  - low promotional likelihood
 *  amber  - clearly disclosed promotion, or an uncertain middle score
 *  red    - high promotional likelihood with missing/unclear disclosure
 */
export function ringStateFor(result: Pick<AnalysisResult, "promoLikelihood" | "disclosure">): RingState {
  const s = result.promoLikelihood;
  if (s < 40) return "green";
  if (s < 60) return "amber";
  return result.disclosure === "clear" ? "amber" : "red";
}

/** Short, restrained text for screen readers. */
export function accessibleSummary(result: AnalysisResult): string {
  const v = verdictFor(result);
  return `PromoLens: ${v.headline}. ${v.technique ? `${v.technique} ` : ""}${result.promoLikelihood}% ${result.label.toLowerCase()}. ${confidenceLabel(result.confidence)}. ${disclosureLabel(result.disclosure)}. Press Enter for details.`;
}
