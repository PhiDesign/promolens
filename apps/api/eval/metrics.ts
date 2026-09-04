/**
 * Pure metric functions for the evaluation harness. No I/O, fully tested.
 */
import type { DisclosureStatus } from "@promolens/shared";

export interface EvalCase {
  id: string;
  /** Why this case exists (shown in reports). */
  description: string;
  post: Record<string, unknown> & { title: string };
  expected: { min: number; max: number; disclosure?: DisclosureStatus };
  /** Id of another case that must score the same (+/- tolerance): used to test that reach never leaks into the score. */
  invariantWith?: string;
  /** Where the case came from: "seed" (synthetic, committed) or "local" (your own, git-ignored). */
  origin?: "seed" | "local";
}

export interface RunResult {
  caseId: string;
  provider: string;
  /** One entry per repetition. */
  runs: { score: number; disclosure: DisclosureStatus; confidence: string; ms: number; error?: string }[];
}

export interface ProviderSummary {
  provider: string;
  cases: number;
  /** Fraction of successful runs whose score fell inside the expected range. */
  inRange: number;
  /** Mean distance to the nearest edge of the expected range (0 when inside). */
  meanRangeError: number;
  /** Fraction of runs with the expected disclosure (cases that specify one). */
  disclosureAccuracy: number;
  /** Mean (max - min) score across repetitions of the same case. 0 = perfectly consistent. */
  meanRepeatSpread: number;
  /** Fraction of invariant pairs whose scores stayed within tolerance. */
  invariantPairsHeld: number;
  invariantPairs: number;
  failedRuns: number;
  meanLatencyMs: number;
}

export function rangeError(score: number, min: number, max: number): number {
  if (score < min) return min - score;
  if (score > max) return score - max;
  return 0;
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function summarize(cases: EvalCase[], results: RunResult[], provider: string, invariantTolerance = 5): ProviderSummary {
  const byCase = new Map(cases.map((c) => [c.id, c]));
  const mine = results.filter((r) => r.provider === provider);

  const inRange: number[] = [];
  const errors: number[] = [];
  const disclosureHits: number[] = [];
  const spreads: number[] = [];
  const latencies: number[] = [];
  let failed = 0;

  const meanScoreByCase = new Map<string, number>();
  for (const r of mine) {
    const c = byCase.get(r.caseId);
    if (!c) continue;
    const ok = r.runs.filter((run) => !run.error);
    failed += r.runs.length - ok.length;
    for (const run of ok) {
      inRange.push(rangeError(run.score, c.expected.min, c.expected.max) === 0 ? 1 : 0);
      errors.push(rangeError(run.score, c.expected.min, c.expected.max));
      if (c.expected.disclosure) disclosureHits.push(run.disclosure === c.expected.disclosure ? 1 : 0);
      latencies.push(run.ms);
    }
    if (ok.length >= 2) spreads.push(Math.max(...ok.map((x) => x.score)) - Math.min(...ok.map((x) => x.score)));
    if (ok.length) meanScoreByCase.set(r.caseId, mean(ok.map((x) => x.score)));
  }

  let pairs = 0;
  let held = 0;
  for (const c of cases) {
    if (!c.invariantWith) continue;
    const a = meanScoreByCase.get(c.id);
    const b = meanScoreByCase.get(c.invariantWith);
    if (a === undefined || b === undefined) continue;
    pairs++;
    if (Math.abs(a - b) <= invariantTolerance) held++;
  }

  return {
    provider,
    cases: mine.length,
    inRange: mean(inRange),
    meanRangeError: mean(errors),
    disclosureAccuracy: mean(disclosureHits),
    meanRepeatSpread: mean(spreads),
    invariantPairsHeld: pairs ? held / pairs : 1,
    invariantPairs: pairs,
    failedRuns: failed,
    meanLatencyMs: mean(latencies),
  };
}

/** Fixed-width text table for the terminal. */
export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => widths.map((w, i) => (cells[i] ?? "").padEnd(w)).join("  ");
  return [line(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}
