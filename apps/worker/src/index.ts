/**
 * PromoLens hosted API on Cloudflare Workers.
 *
 * Same routes and behaviour as apps/api (the Node server), reusing its
 * config, provider, analysis service, licence client and hosted-tier logic.
 * Only the transport (Request/Response instead of node:http) and the
 * usage store (Workers KV instead of a JSON file) differ.
 *
 *   GET    /api/v1/health
 *   POST   /api/v1/analyze     metered per install id
 *   GET    /api/v1/quota
 *   POST   /api/v1/license     { licenseKey }
 *   DELETE /api/v1/license
 */
import { ANALYSIS_VERSION, type HealthResponse } from "@promolens/shared";
import { loadConfig, type ApiConfig } from "../../api/src/config.js";
import { errorBody, HttpError } from "../../api/src/errors.js";
import { originAllowed } from "../../api/src/http.js";
import { AnalysisService } from "../../api/src/services/analysisService.js";
import { MemoryCache } from "../../api/src/services/cache.js";
import { activateLicense, detachLicenseFor, parseInstallId, planFor, quotaFor, type HostedDeps } from "../../api/src/services/hostedTier.js";
import { LicenseClient } from "../../api/src/services/license.js";
import { createProvider, type AnalysisProvider } from "../../api/src/services/providers/index.js";
import { RateLimiter } from "../../api/src/services/rateLimit.js";
import { assertValidResponse, parseAnalyzeRequest } from "../../api/src/validation/validate.js";
import { KvQuotaStore, type KvLike } from "./kvQuota.js";

export interface Env extends Record<string, unknown> {
  USAGE: KvLike;
}

/** Per-isolate state: config, provider, caches. Rebuilt whenever the isolate restarts. */
interface Runtime {
  config: ApiConfig;
  provider: AnalysisProvider;
  service: AnalysisService;
  rateLimiter: RateLimiter;
  hosted: HostedDeps | undefined;
  startedAt: number;
}

const runtimes = new WeakMap<object, Runtime>();

export interface RuntimeOverrides {
  provider?: AnalysisProvider;
  license?: LicenseClient;
  now?: () => Date;
}

export function buildRuntime(env: Env, overrides: RuntimeOverrides = {}): Runtime {
  const stringEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === "string") stringEnv[k] = v;
  const config = loadConfig(stringEnv);
  const provider = overrides.provider ?? createProvider(config, (line) => console.log(line));
  const service = new AnalysisService(provider, new MemoryCache(), { cacheTtlMs: config.cacheTtlMs, timeoutMs: config.requestTimeoutMs });
  const hosted = config.quotaEnabled
    ? {
        quota: new KvQuotaStore({ freeInitial: config.freeInitial, freeMonthly: config.freeMonthly, plusMonthly: config.plusMonthly }, env.USAGE, overrides.now),
        license: overrides.license ?? new LicenseClient({ productId: config.lemonSqueezyProductId }),
      }
    : undefined;
  return { config, provider, service, rateLimiter: new RateLimiter(config.rateLimitPerMinute, 60_000), hosted, startedAt: Date.now() };
}

function runtimeFor(env: Env): Runtime {
  let rt = runtimes.get(env);
  if (!rt) {
    rt = buildRuntime(env);
    runtimes.set(env, rt);
  }
  return rt;
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function corsHeaders(request: Request, allowed: string[]): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !originAllowed(origin, allowed)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-PromoLens-Install, X-PromoLens-License",
    "Access-Control-Expose-Headers": "X-PromoLens-Quota-Used, X-PromoLens-Quota-Limit, X-PromoLens-Quota-Plan",
    "Access-Control-Max-Age": "600",
  };
}

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, "payload_too_large", `Request body exceeds ${maxBytes} bytes`);
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "payload_too_large", `Request body exceeds ${maxBytes} bytes`);
  if (!text) throw new HttpError(400, "empty_body", "Request body is empty");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON");
  }
}

function clientKey(request: Request): string {
  return `${request.headers.get("cf-connecting-ip") ?? "unknown"}|${request.headers.get("origin") ?? "no-origin"}`;
}

export async function handle(request: Request, rt: Runtime): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  const cors = corsHeaders(request, rt.config.allowedOrigins);
  const respond = (status: number, body: unknown, extra: Record<string, string> = {}) => json(status, body, { ...cors, ...extra });
  let status = 500;
  try {
    if (request.method === "OPTIONS") {
      status = Object.keys(cors).length ? 204 : 403;
      return new Response(null, { status, headers: cors });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/health") {
      const body: HealthResponse = { status: "ok", version: ANALYSIS_VERSION, provider: rt.provider.name, uptimeSeconds: Math.round((Date.now() - rt.startedAt) / 1000) };
      status = 200;
      return respond(200, body);
    }

    if (rt.hosted && request.method === "GET" && url.pathname === "/api/v1/quota") {
      status = 200;
      return respond(200, await quotaFor(parseInstallId(request.headers.get("x-promolens-install")), rt.hosted));
    }
    if (rt.hosted && url.pathname === "/api/v1/license") {
      const installId = parseInstallId(request.headers.get("x-promolens-install"));
      if (request.method === "POST") {
        status = 200;
        return respond(200, await activateLicense(installId, await readJson(request, rt.config.maxBodyBytes), rt.hosted));
      }
      if (request.method === "DELETE") {
        status = 200;
        return respond(200, await detachLicenseFor(installId, rt.hosted));
      }
    }

    if (request.method === "POST" && url.pathname === "/api/v1/analyze") {
      const decision = rt.rateLimiter.check(clientKey(request));
      const extra: Record<string, string> = { "X-RateLimit-Remaining": String(decision.remaining) };
      if (!decision.allowed) {
        extra["Retry-After"] = String(Math.ceil(decision.retryAfterMs / 1000));
        throw new HttpError(429, "rate_limited", "Too many requests; slow down", undefined);
      }
      if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json");
      }
      const analyze = async () => assertValidResponse(await rt.service.analyze(parseAnalyzeRequest(await readJson(request, rt.config.maxBodyBytes))));

      if (!rt.hosted) {
        status = 200;
        return respond(200, await analyze(), extra);
      }
      // Metered: reserve one analysis before doing the work; refund it if the
      // provider fails so an outage never eats a user's allowance.
      const installId = parseInstallId(request.headers.get("x-promolens-install"));
      const { plan } = await planFor(installId, rt.hosted);
      const attempt = await rt.hosted.quota.consume(installId, plan);
      extra["X-PromoLens-Quota-Used"] = String(attempt.status.used);
      extra["X-PromoLens-Quota-Limit"] = String(attempt.status.limit);
      extra["X-PromoLens-Quota-Plan"] = attempt.status.plan;
      if (!attempt.allowed) {
        status = 402;
        return respond(402, errorBody(new HttpError(402, "quota_exceeded", plan === "plus" ? "Monthly Plus allowance used up" : "Free analyses used up for this month", { quota: attempt.status })), extra);
      }
      try {
        const body = await analyze();
        status = 200;
        return respond(200, body, extra);
      } catch (err) {
        await rt.hosted.quota.refund(installId, attempt.status.month);
        if (err instanceof HttpError) {
          status = err.status;
          return respond(err.status, errorBody(err), extra);
        }
        throw err;
      }
    }

    throw new HttpError(404, "not_found", `No route for ${route}`);
  } catch (err) {
    if (err instanceof HttpError) {
      status = err.status;
      return respond(err.status, errorBody(err));
    }
    console.error(`${route} failed: ${err instanceof Error ? err.message : String(err)}`);
    status = 500;
    return respond(500, { error: { code: "internal_error", message: "Unexpected server error" } });
  } finally {
    // Access log without any post content.
    console.log(`${route} -> ${status} (${Date.now() - started} ms)`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, runtimeFor(env));
  },
};
