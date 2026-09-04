import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AnalysisResultSchema, analyzePost, type AnalyzeRequest } from "@promolens/shared";
import { rangeError, renderTable, summarize, type EvalCase, type RunResult } from "../eval/metrics.js";
import { DirectLlmProvider, parseDirectOutput } from "../src/services/providers/direct.js";
import type { ChatClient } from "../src/services/providers/llm.js";

const cases: EvalCase[] = [
  { id: "a", description: "", post: { title: "a" }, expected: { min: 0, max: 19, disclosure: "unknown" } },
  { id: "a-viral", description: "", post: { title: "a" }, expected: { min: 0, max: 19 }, invariantWith: "a" },
  { id: "b", description: "", post: { title: "b" }, expected: { min: 80, max: 100, disclosure: "clear" } },
];

describe("eval metrics", () => {
  it("rangeError is 0 inside the range and the distance outside", () => {
    expect(rangeError(10, 0, 19)).toBe(0);
    expect(rangeError(25, 0, 19)).toBe(6);
    expect(rangeError(70, 80, 100)).toBe(10);
  });

  it("summarize computes accuracy, disclosure, repeat spread and invariant pairs", () => {
    const results: RunResult[] = [
      { caseId: "a", provider: "p", runs: [{ score: 5, disclosure: "unknown", confidence: "low", ms: 10 }, { score: 15, disclosure: "unknown", confidence: "low", ms: 10 }] },
      { caseId: "a-viral", provider: "p", runs: [{ score: 40, disclosure: "unknown", confidence: "low", ms: 10 }] }, // reach leaked
      { caseId: "b", provider: "p", runs: [{ score: 90, disclosure: "missing", confidence: "high", ms: 10 }, { score: NaN, disclosure: "unknown", confidence: "low", ms: 5, error: "boom" }] },
    ];
    const s = summarize(cases, results, "p");
    expect(s.cases).toBe(3);
    expect(s.failedRuns).toBe(1);
    expect(s.inRange).toBeCloseTo(3 / 4); // 5, 15, 90 in range; 40 out
    expect(s.meanRangeError).toBeCloseTo(21 / 4);
    expect(s.disclosureAccuracy).toBeCloseTo(2 / 3); // a: unknown ok x2; b: missing != clear
    expect(s.meanRepeatSpread).toBe(10); // only case a had 2 successful runs
    expect(s.invariantPairs).toBe(1);
    expect(s.invariantPairsHeld).toBe(0);
  });

  it("renders a table without throwing on ragged rows", () => {
    const t = renderTable(["x", "yy"], [["1"], ["22", "333"]]);
    expect(t.split("\n")).toHaveLength(4);
  });
});

describe("seed dataset", () => {
  const seed = JSON.parse(readFileSync(new URL("../eval/dataset.json", import.meta.url), "utf8")) as { cases: EvalCase[] };

  it("has unique ids, valid ranges and resolvable invariant pairs", () => {
    const ids = new Set(seed.cases.map((c) => c.id));
    expect(ids.size).toBe(seed.cases.length);
    for (const c of seed.cases) {
      expect(c.expected.min).toBeLessThanOrEqual(c.expected.max);
      if (c.invariantWith) expect(ids.has(c.invariantWith)).toBe(true);
    }
  });

  it("rules-only engine stays within every expected range and disclosure of the seed set", () => {
    const misses: string[] = [];
    for (const c of seed.cases) {
      const r = analyzePost(c.post as AnalyzeRequest["post"], "local");
      if (r.promoLikelihood < c.expected.min || r.promoLikelihood > c.expected.max) misses.push(`${c.id}: ${r.promoLikelihood} not in ${c.expected.min}-${c.expected.max}`);
      if (c.expected.disclosure && r.disclosure !== c.expected.disclosure) misses.push(`${c.id}: disclosure ${r.disclosure} != ${c.expected.disclosure}`);
    }
    expect(misses).toEqual([]);
  });
});

describe("DirectLlmProvider (experimental)", () => {
  const fake = (reply: string): ChatClient => ({ name: "fake", complete: async () => reply });
  const req: AnalyzeRequest = { post: { title: "I built a tool", body: "I'm the founder. Try it at https://x.app", upvotes: 5000, commentsCount: 300, ageHours: 2 }, localSignals: [] };

  it("returns a schema-valid result with the model's score and verified quotes only", async () => {
    const p = new DirectLlmProvider(
      fake(JSON.stringify({ promoLikelihood: 88.4, disclosure: "clear", confidence: "high", reasons: ["founder says so"], evidence: [{ quote: "I'm the founder" }, { quote: "not in post" }], note: "obvious shill" })),
    );
    const r = await p.analyze(req, new AbortController().signal);
    expect(AnalysisResultSchema.safeParse(r).success).toBe(true);
    expect(r.promoLikelihood).toBe(88);
    expect(r.disclosure).toBe("clear");
    expect(r.undisclosedRisk).toBe("low");
    expect(r.reach.level).toBe("high");
    expect(r.signals.filter((s) => s.id === "api.llm-direct-evidence")).toHaveLength(1);
    const note = r.signals.find((s) => s.id === "api.llm-direct")?.explanation ?? "";
    expect(note).toContain("EXPERIMENTAL");
    expect(note).toContain("1 could not be found");
    expect(note).not.toMatch(/shill/);
  });

  it("rejects out-of-range or malformed output", async () => {
    await expect(new DirectLlmProvider(fake('{"promoLikelihood":140,"disclosure":"clear","confidence":"high","reasons":["x"]}')).analyze(req, new AbortController().signal)).rejects.toThrow(/shape/);
    expect(() => parseDirectOutput("nope")).toThrow(/JSON/);
  });
});
