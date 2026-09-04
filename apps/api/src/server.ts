/**
 * PromoLens local analysis API.
 *
 * Routes:
 *   GET  /api/v1/health
 *   POST /api/v1/analyze
 *
 * Built on node:http with no framework so every moving part is visible:
 * CORS, body-size limit, rate limit, timeout, validation, cache, provider.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { loadConfig, type ApiConfig } from "./config.js";
import { applyCors, clientKey, HttpError, sendError, sendJson } from "./http.js";
import { handleAnalyze } from "./routes/analyze.js";
import { handleHealth } from "./routes/health.js";
import { AnalysisService } from "./services/analysisService.js";
import { MemoryCache, type ContentHashCache } from "./services/cache.js";
import { createProvider, type AnalysisProvider } from "./services/providers/index.js";
import { RateLimiter } from "./services/rateLimit.js";

export interface AppDeps {
  provider?: AnalysisProvider;
  cache?: ContentHashCache;
  rateLimiter?: RateLimiter;
  log?: (line: string) => void;
}

export function createApp(config: ApiConfig, deps: AppDeps = {}): Server {
  const log = deps.log ?? ((line: string) => console.log(line));
  const provider = deps.provider ?? createProvider(config, log);
  const cache = deps.cache ?? new MemoryCache();
  const rateLimiter = deps.rateLimiter ?? new RateLimiter(config.rateLimitPerMinute, 60_000);
  const service = new AnalysisService(provider, cache, {
    cacheTtlMs: config.cacheTtlMs,
    timeoutMs: config.requestTimeoutMs,
  });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const started = Date.now();
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = `${req.method} ${url.pathname}`;

    try {
      if (applyCors(req, res, config.allowedOrigins)) return;

      if (req.method === "GET" && url.pathname === "/api/v1/health") {
        handleHealth(res, provider.name);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/v1/analyze") {
        const decision = rateLimiter.check(clientKey(req));
        res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
        if (!decision.allowed) {
          res.setHeader("Retry-After", String(Math.ceil(decision.retryAfterMs / 1000)));
          throw new HttpError(429, "rate_limited", "Too many requests; slow down");
        }
        await handleAnalyze(req, res, { service, maxBodyBytes: config.maxBodyBytes });
        return;
      }

      throw new HttpError(404, "not_found", `No route for ${route}`);
    } catch (err) {
      if (err instanceof HttpError) {
        sendError(res, err);
      } else {
        // Never leak stack traces or post content in error responses.
        sendJson(res, 500, { error: { code: "internal_error", message: "Unexpected server error" } });
      }
    } finally {
      // Access log without any post content.
      log(`${route} -> ${res.statusCode} (${Date.now() - started} ms)`);
    }
  });

  // Socket-level protection against slow or stalled clients.
  server.requestTimeout = config.requestTimeoutMs + 2_000;
  server.headersTimeout = 5_000;
  return server;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url.endsWith(entry.replace(/\\/g, "/").split("/").pop() ?? "");
}

if (isMainModule()) {
  // Load apps/api/.env if present (Node >= 20.12). Missing file is fine.
  try {
    process.loadEnvFile(new URL("../.env", import.meta.url).pathname);
  } catch {
    /* no .env - use defaults / process env */
  }
  const config = loadConfig();
  const server = createApp(config);
  server.listen(config.port, "127.0.0.1", () => {
    console.log(`PromoLens API listening on http://127.0.0.1:${config.port} (provider: ${config.provider}${config.llmModel ? `, model: ${config.llmModel}` : ""})`);
    console.log(`Allowed origins: ${config.allowedOrigins.join(", ")}`);
    if (config.logRawContent) console.warn("LOG_RAW_CONTENT=true: raw post content logging is enabled (debug only).");
  });
}
