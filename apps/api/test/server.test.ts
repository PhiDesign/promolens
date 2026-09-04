import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { AnalyzeResponseSchema } from "@promolens/shared";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/server.js";
import { RateLimiter } from "../src/services/rateLimit.js";

let server: Server;
let base: string;

const config = loadConfig({
  PORT: "0",
  ALLOWED_ORIGINS: "chrome-extension://*,http://localhost:5173",
  RATE_LIMIT_PER_MINUTE: "100",
  MAX_BODY_BYTES: "4096",
  REQUEST_TIMEOUT_MS: "3000",
  CACHE_TTL_HOURS: "1",
  ANALYSIS_PROVIDER: "mock",
});

beforeAll(async () => {
  server = createApp(config, { log: () => undefined });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const validPost = {
  post: {
    id: "t3_abc",
    url: "https://www.reddit.com/r/example/comments/abc/post/",
    title: "I built a tool for tracking habits",
    body: "I'm the founder of HabitLoop. Try it at https://habitloop.app - feedback welcome.",
    author: "habitloop_dev",
    subreddit: "example",
    upvotes: 2400,
    commentsCount: 184,
    outboundDomains: ["habitloop.app"],
    visibleComments: [],
  },
  localSignals: [],
};

type ErrorBody = { error: { code: string; message: string; details?: { issues?: unknown[] } } };

async function post(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/v1/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("GET /api/v1/health", () => {
  it("reports ok with provider and version", async () => {
    const res = await fetch(`${base}/api/v1/health`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; provider: string; version: string };
    expect(json.status).toBe("ok");
    expect(json.provider).toBe("mock");
    expect(typeof json.version).toBe("string");
  });
});

describe("POST /api/v1/analyze", () => {
  it("returns a schema-valid analysis for a valid request", async () => {
    const res = await post(validPost);
    expect(res.status).toBe(200);
    const parsed = AnalyzeResponseSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.source).toBe("api");
    expect(parsed.data.disclosure).toBe("clear");
    expect(parsed.data.reach.level).toBe("high");
    expect(parsed.data.cached).toBe(false);
  });

  it("serves the second identical request from the hash cache", async () => {
    const res = await post(validPost);
    const json = (await res.json()) as { cached: boolean };
    expect(json.cached).toBe(true);
  });

  it("rejects invalid requests with a clear 400", async () => {
    const res = await post({ post: { body: "no title" } });
    expect(res.status).toBe(400);
    const json = (await res.json()) as ErrorBody;
    expect(json.error.code).toBe("invalid_request");
    expect(Array.isArray(json.error.details?.issues)).toBe(true);
  });

  it("rejects malformed JSON", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe("invalid_json");
  });

  it("rejects the wrong content type", async () => {
    const res = await fetch(`${base}/api/v1/analyze`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" });
    expect(res.status).toBe(415);
  });

  it("enforces the body size limit", async () => {
    const big = { post: { title: "t", body: "x".repeat(5000) } };
    const res = await post(big);
    expect(res.status).toBe(413);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });
});

describe("CORS", () => {
  it("allows configured extension origins", async () => {
    const res = await fetch(`${base}/api/v1/health`, { headers: { Origin: "chrome-extension://abcdefghijklmnop" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("chrome-extension://abcdefghijklmnop");
  });

  it("does not echo unknown origins and refuses their preflight", async () => {
    const res = await fetch(`${base}/api/v1/health`, { headers: { Origin: "https://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await fetch(`${base}/api/v1/analyze`, { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
    expect(pre.status).toBe(403);
  });
});

describe("rate limiting", () => {
  it("returns 429 once the per-minute limit is hit", async () => {
    const limited = createApp(config, { log: () => undefined, rateLimiter: new RateLimiter(2, 60_000) });
    await new Promise<void>((resolve) => limited.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(limited.address() as AddressInfo).port}/api/v1/analyze`;
    const call = () => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validPost) });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const third = await call();
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBeTruthy();
    await new Promise<void>((resolve) => limited.close(() => resolve()));
  });
});
