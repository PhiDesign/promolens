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
  logRawContent: boolean;
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
    requestTimeoutMs: num(env.REQUEST_TIMEOUT_MS, 8_000),
    cacheTtlMs: num(env.CACHE_TTL_HOURS, 24) * 60 * 60 * 1000,
    provider: (env.ANALYSIS_PROVIDER ?? "mock").trim().toLowerCase() || "mock",
    providerApiKey: env.ANALYSIS_PROVIDER_API_KEY?.trim() || undefined,
    llmModel: env.LLM_MODEL?.trim() || undefined,
    llmBaseUrl: env.LLM_BASE_URL?.trim() || undefined,
    llmTimeoutMs: num(env.LLM_TIMEOUT_MS, 6_000),
    logRawContent: (env.LOG_RAW_CONTENT ?? "false").toLowerCase() === "true",
  };
}
