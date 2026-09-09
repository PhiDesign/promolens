/**
 * API configuration, loaded from environment variables.
 * See .env.example at the repository root for every option.
 */
export interface ApiConfig {
  port: number;
  allowedOrigins: string[];
  rateLimitPerMinute: number;
  maxBodyBytes: number;
  requestTimeoutMs: number;
  cacheTtlMs: number;
  provider: string;
  /** Only ever lives on the server. Never sent to the extension. */
  providerApiKey: string | undefined;
  /** Model name for LLM providers (e.g. an OpenAI model id). */
  llmModel: string | undefined;
  /** Base URL of an OpenAI-compatible API. */
  llmBaseUrl: string | undefined;
  /** Timeout for one model call; must stay below requestTimeoutMs. */
  llmTimeoutMs: number;
  /** Reasoning models: how long to think. Defaults to "low" for GPT-5 / o-series ids. */
  llmReasoningEffort: "minimal" | "low" | "medium" | "high" | undefined;
  /** GPT-5 family answer length. Defaults to "low" for GPT-5 ids. */
  llmVerbosity: "low" | "medium" | "high" | undefined;
  logRawContent: boolean;
  /**
   * Hosted tier: meter analyses per anonymous install id and honour Plus
   * licences. Off for a personal/local server (no headers required).
   */
  quotaEnabled: boolean;
  /** Where the usage file lives. */
  dataDir: string;
  freeInitial: number;
  freeMonthly: number;
  plusMonthly: number;
  /** Lemon Squeezy product a licence must belong to. */
  lemonSqueezyProductId: number;
}

const REASONING_MODEL = /^(gpt-5|o[1-9])/i;

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T | undefined): T | undefined {
  const v = value?.trim().toLowerCase();
  if (v === "none" || v === "off") return undefined;
  return (allowed as readonly string[]).includes(v ?? "") ? (v as T) : fallback;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const origins = (env.ALLOWED_ORIGINS ?? "chrome-extension://*,http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    port: num(env.PORT, 8787),
    allowedOrigins: origins,
    rateLimitPerMinute: num(env.RATE_LIMIT_PER_MINUTE, 60),
    maxBodyBytes: num(env.MAX_BODY_BYTES, 262_144),
    requestTimeoutMs: num(env.REQUEST_TIMEOUT_MS, 50_000),
    cacheTtlMs: num(env.CACHE_TTL_HOURS, 24) * 60 * 60 * 1000,
    provider: (env.ANALYSIS_PROVIDER ?? "mock").trim().toLowerCase() || "mock",
    providerApiKey: env.ANALYSIS_PROVIDER_API_KEY?.trim() || undefined,
    llmModel: env.LLM_MODEL?.trim() || undefined,
    llmBaseUrl: env.LLM_BASE_URL?.trim() || undefined,
    llmTimeoutMs: num(env.LLM_TIMEOUT_MS, 45_000),
    llmReasoningEffort: pick(env.LLM_REASONING_EFFORT, ["minimal", "low", "medium", "high"] as const, REASONING_MODEL.test(env.LLM_MODEL?.trim() ?? "") ? "low" : undefined),
    llmVerbosity: pick(env.LLM_VERBOSITY, ["low", "medium", "high"] as const, /^gpt-5/i.test(env.LLM_MODEL?.trim() ?? "") ? "low" : undefined),
    logRawContent: (env.LOG_RAW_CONTENT ?? "false").toLowerCase() === "true",
    quotaEnabled: (env.QUOTA_ENABLED ?? "false").toLowerCase() === "true",
    dataDir: env.DATA_DIR?.trim() || "./data",
    freeInitial: num(env.FREE_INITIAL, 20),
    freeMonthly: num(env.FREE_MONTHLY, 5),
    plusMonthly: num(env.PLUS_MONTHLY, 500),
    lemonSqueezyProductId: num(env.LEMONSQUEEZY_PRODUCT_ID, 0),
  };
}
