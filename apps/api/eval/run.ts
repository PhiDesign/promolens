/**
 * Evaluation harness: rules-only vs rules+model witness vs model-only.
 *
 *   npm run eval                         # rules only (no key needed)
 *   npm run eval -- --providers rules,witness,direct --repeat 2
 *   npm run eval -- --providers direct --limit 5
 *
 * Reads apps/api/.env for the model key/model id. Cases come from
 * apps/api/eval/dataset.json (synthetic, committed) plus any
 * apps/api/eval/local/*.json you add (your own posts; git-ignored).
 * Writes a JSON report to apps/api/eval/results/ (git-ignored).
 *
 * Nothing here logs post content; only ids, scores and timings.
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzePost, LlmWitnessProvider, OpenAiChatClient, type AnalysisResult, type AnalyzeRequest } from "@promolens/shared";
import { loadConfig } from "../src/config.js";
import { DirectLlmProvider } from "../src/services/providers/direct.js";
import type { AnalysisProvider } from "../src/services/providers/types.js";
import { mean, renderTable, summarize, type EvalCase, type RunResult } from "./metrics.js";

const here = dirname(fileURLToPath(import.meta.url));

interface Args {
  providers: string[];
  repeat: number;
  limit: number;
  only?: string;
  probe?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { providers: ["rules"], repeat: 1, limit: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? "";
    if (a === "--providers") args.providers = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--repeat") args.repeat = Math.max(1, Number(next()) || 1);
    else if (a === "--limit") args.limit = Math.max(1, Number(next()) || Infinity);
    else if (a === "--only") args.only = next();
    else if (a === "--probe") args.probe = true;
  }
  return args;
}

function loadCases(): EvalCase[] {
  const seed = JSON.parse(readFileSync(join(here, "dataset.json"), "utf8")) as { cases: EvalCase[] };
  const cases: EvalCase[] = seed.cases.map((c) => ({ ...c, origin: "seed" }));
  const localDir = join(here, "local");
  if (existsSync(localDir)) {
    for (const file of readdirSync(localDir).filter((f) => f.endsWith(".json"))) {
      const parsed = JSON.parse(readFileSync(join(localDir, file), "utf8")) as { cases?: EvalCase[] } | EvalCase[];
      const list = Array.isArray(parsed) ? parsed : (parsed.cases ?? []);
      for (const c of list) cases.push({ ...c, origin: "local" });
    }
  }
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`duplicate case id: ${c.id}`);
    ids.add(c.id);
  }
  return cases;
}

class RulesProvider implements AnalysisProvider {
  readonly name = "rules";
  async analyze(request: AnalyzeRequest): Promise<AnalysisResult> {
    return analyzePost(request.post, "local");
  }
}

function buildProviders(names: string[], usage: { prompt: number; completion: number }): AnalysisProvider[] {
  const config = loadConfig();
  const needsModel = names.some((n) => n === "witness" || n === "direct");
  let client: OpenAiChatClient | undefined;
  if (needsModel) {
    if (!config.providerApiKey || !config.llmModel) {
      throw new Error("witness/direct need ANALYSIS_PROVIDER_API_KEY and LLM_MODEL in apps/api/.env");
    }
    client = new OpenAiChatClient({
      apiKey: config.providerApiKey,
      model: config.llmModel,
      baseUrl: config.llmBaseUrl,
      timeoutMs: Math.max(config.llmTimeoutMs, 20_000),
      reasoningEffort: config.llmReasoningEffort,
      verbosity: config.llmVerbosity,
      onUsage: (u) => {
        usage.prompt += u.promptTokens;
        usage.completion += u.completionTokens;
      },
    });
  }
  return names.map((n) => {
    switch (n) {
      case "rules":
        return new RulesProvider();
      case "witness":
        return new LlmWitnessProvider(client!);
      case "direct":
        return new DirectLlmProvider(client!);
      default:
        throw new Error(`unknown provider "${n}" (use rules, witness, direct)`);
    }
  });
}

async function runOne(provider: AnalysisProvider, c: EvalCase): Promise<RunResult["runs"][number]> {
  const started = Date.now();
  try {
    const result = await provider.analyze({ post: c.post as AnalyzeRequest["post"], localSignals: [] }, new AbortController().signal);
    return { score: result.promoLikelihood, disclosure: result.disclosure, confidence: result.confidence, ms: Date.now() - started };
  } catch (err) {
    return { score: NaN, disclosure: "unknown", confidence: "low", ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * --probe: check the key and model id against the provider without sending any
 * post content. Prints only HTTP statuses and short error codes.
 */
async function probe(): Promise<void> {
  const config = loadConfig();
  if (!config.providerApiKey) throw new Error("ANALYSIS_PROVIDER_API_KEY is empty in apps/api/.env");
  const base = (config.llmBaseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${config.providerApiKey}` };
  // The probe never sends post content, so the provider's own message is safe to print.
  const describe = async (res: Response): Promise<string> => {
    let code = "";
    let message = "";
    try {
      const body = (await res.json()) as { error?: { code?: unknown; type?: unknown; message?: unknown } };
      const raw = body.error?.code ?? body.error?.type;
      if (typeof raw === "string") code = raw;
      if (typeof body.error?.message === "string") message = body.error.message.replace(/\s+/g, " ").slice(0, 300);
    } catch {
      /* not JSON */
    }
    return `HTTP ${res.status}${code ? ` (${code})` : ""}${message ? `\n      provider says: ${message}` : ""}`;
  };

  console.log(`Probing ${base} with key ending ...${config.providerApiKey.slice(-4)}`);
  const list = await fetch(`${base}/models`, { headers });
  if (!list.ok) {
    console.log(`  GET /models -> ${await describe(list)}`);
    console.log("  The key itself was rejected. Check that it is the rotated key and belongs to a project with billing enabled.");
    return;
  }
  const models = ((await list.json()) as { data?: { id: string }[] }).data ?? [];
  console.log(`  GET /models -> HTTP 200, key accepted, ${models.length} model(s) visible`);
  const wanted = config.llmModel ?? "";
  if (!wanted) {
    console.log("  LLM_MODEL is empty in apps/api/.env");
  } else if (models.some((m) => m.id === wanted)) {
    console.log(`  model "${wanted}" exists`);
  } else {
    const near = models.map((m) => m.id).filter((id) => id.toLowerCase().includes(wanted.toLowerCase().split(/[-_ ]/)[0] ?? "")).slice(0, 12);
    console.log(`  model "${wanted}" NOT found. Similar ids: ${near.length ? near.join(", ") : "(none)"}`);
  }

  const chat = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ model: wanted, messages: [{ role: "user", content: "Reply with the single word: ok" }] }),
  });
  console.log(`  POST /chat/completions -> ${chat.ok ? "HTTP 200, a tiny completion worked" : await describe(chat)}`);
  // Rate-limit headers (no content): what this key may do on this model right now.
  const h = (name: string) => chat.headers.get(name) ?? "?";
  console.log(
    `  limits for "${wanted}": requests ${h("x-ratelimit-remaining-requests")} of ${h("x-ratelimit-limit-requests")} left (resets in ${h("x-ratelimit-reset-requests")}); ` +
      `tokens ${h("x-ratelimit-remaining-tokens")} of ${h("x-ratelimit-limit-tokens")} left (resets in ${h("x-ratelimit-reset-tokens")})`,
  );
  if (chat.status === 429) {
    console.log("  A 429 on a single tiny request means either no credit on the project (insufficient_quota)");
    console.log("  or this model is not yet available to your account's usage tier (rate_limit_exceeded with a 0 limit).");
    const cheaper = models.map((m) => m.id).filter((id) => /mini|nano|small/i.test(id)).sort().slice(0, 15);
    if (cheaper.length) console.log(`  Smaller models your account can see (try one as LLM_MODEL): ${cheaper.join(", ")}`);
  }
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(join(here, "..", ".env"));
  } catch {
    /* no .env */
  }
  const args = parseArgs(process.argv.slice(2));
  if (args.probe) {
    await probe();
    return;
  }
  let cases = loadCases();
  if (args.only) cases = cases.filter((c) => c.id === args.only || c.invariantWith === args.only);
  cases = cases.slice(0, args.limit);

  const usage = { prompt: 0, completion: 0 };
  const providers = buildProviders(args.providers, usage);
  console.log(`Evaluating ${cases.length} case(s) with: ${providers.map((p) => p.name).join(", ")} (repeat ${args.repeat})\n`);

  const results: RunResult[] = [];
  const MAX_CONSECUTIVE_FAILURES = 4;
  for (const provider of providers) {
    const isModel = provider.name !== "rules";
    const repeat = isModel ? args.repeat : 1; // rules are deterministic
    let consecutiveFailures = 0;
    let aborted = false;
    for (const c of cases) {
      const runs: RunResult["runs"] = [];
      for (let i = 0; i < repeat && !aborted; i++) {
        let run = await runOne(provider, c);
        if (run.error && /429/.test(run.error) && !/insufficient_quota/.test(run.error)) {
          await new Promise((r) => setTimeout(r, 4000)); // plain rate limit: wait once and retry
          run = await runOne(provider, c);
        }
        runs.push(run);
        if (run.error) {
          consecutiveFailures++;
          if (consecutiveFailures === 1) console.error(`  ! ${provider.name}: ${run.error}`);
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.error(`  ! ${provider.name}: ${MAX_CONSECUTIVE_FAILURES} failures in a row - skipping the rest of this provider`);
            aborted = true;
          }
        } else {
          consecutiveFailures = 0;
        }
        if (isModel) await new Promise((r) => setTimeout(r, 250)); // be gentle with rate limits
      }
      if (runs.length) results.push({ caseId: c.id, provider: provider.name, runs });
      if (aborted) break;
      const shown = runs.map((r) => (r.error ? "ERR" : String(r.score))).join("/");
      process.stdout.write(`  ${provider.name.padEnd(28)} ${c.id.padEnd(30)} ${shown}\n`);
    }
  }

  // Per-case table
  console.log("\nPer case (score / expected range):");
  const rows = cases.map((c) => [
    c.id,
    `${c.expected.min}-${c.expected.max}${c.expected.disclosure ? ` ${c.expected.disclosure}` : ""}`,
    ...providers.map((p) => {
      const r = results.find((x) => x.caseId === c.id && x.provider === p.name);
      const ok = (r?.runs ?? []).filter((x) => !x.error);
      if (!ok.length) return "ERR";
      const scores = ok.map((x) => x.score);
      const disc = ok[0]?.disclosure ?? "?";
      const spread = scores.length > 1 ? ` ±${Math.round((Math.max(...scores) - Math.min(...scores)) / 2)}` : "";
      const inRange = scores.every((s) => s >= c.expected.min && s <= c.expected.max) ? "" : " !";
      return `${Math.round(mean(scores))}${spread} ${disc}${inRange}`;
    }),
  ]);
  console.log(renderTable(["case", "expected", ...providers.map((p) => p.name)], rows));

  // Summary
  console.log("\nSummary:");
  const summaryRows = providers.map((p) => {
    const s = summarize(cases, results, p.name);
    return [
      p.name,
      `${Math.round(s.inRange * 100)}%`,
      s.meanRangeError.toFixed(1),
      `${Math.round(s.disclosureAccuracy * 100)}%`,
      s.meanRepeatSpread.toFixed(1),
      s.invariantPairs ? `${s.invariantPairsHeld * s.invariantPairs}/${s.invariantPairs}` : "n/a",
      String(s.failedRuns),
      `${Math.round(s.meanLatencyMs)} ms`,
    ];
  });
  console.log(
    renderTable(["provider", "in range", "range err", "disclosure ok", "repeat spread", "reach pairs held", "failed", "latency"], summaryRows),
  );
  if (usage.prompt + usage.completion > 0) {
    console.log(`\nModel tokens: ${usage.prompt} prompt + ${usage.completion} completion over ${results.filter((r) => r.provider !== "rules").reduce((n, r) => n + r.runs.length, 0)} calls`);
  }
  console.log("\n'!' = outside expected range. 'repeat spread' = mean max-min across repetitions (0 = deterministic).");
  console.log("'reach pairs held' = cases that differ only in upvotes/comments scored within ±5 of each other.");

  const outDir = join(here, "results");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ args, providers: providers.map((p) => p.name), usage, results, summaries: providers.map((p) => summarize(cases, results, p.name)) }, null, 2));
  console.log(`\nReport written to ${file}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
