import { describe, expect, it } from "vitest";
import { analyzePost } from "@promolens/shared";
import { ApiClient, ApiError } from "../src/background/apiClient.js";

const post = { title: "t", body: "b" };
const good = { ...analyzePost(post, "api"), cached: false, contentHash: "0000000000000000" };

function fakeFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response): typeof fetch {
  return ((url: string, init?: RequestInit) => Promise.resolve(handler(url, init))) as unknown as typeof fetch;
}

describe("ApiClient", () => {
  it("uses the real global fetch correctly when none is injected (regression: Illegal invocation)", async () => {
    const client = new ApiClient(500, 2); // default fetch, unreachable port
    const health = await client.health("http://127.0.0.1:1");
    expect(health.ok).toBe(false);
    expect(health.message).not.toMatch(/Illegal invocation/i);
  });

  it("returns a validated result marked as coming from the API", async () => {
    const client = new ApiClient(1000, 2, fakeFetch(() => Response.json(good)));
    const result = await client.analyze("http://api", post, [], "0000000000000000");
    expect(result.source).toBe("api");
    expect(result.promoLikelihood).toBe(good.promoLikelihood);
    expect("cached" in result).toBe(false);
  });

  it("rejects a malformed API response instead of showing it", async () => {
    const client = new ApiClient(1000, 2, fakeFetch(() => Response.json({ promoLikelihood: 999, label: "x" })));
    await expect(client.analyze("http://api", post, [], "0000000000000000")).rejects.toMatchObject({ reason: "invalid_response" });
  });

  it("rejects non-JSON and HTTP errors with a reason", async () => {
    const notJson = new ApiClient(1000, 2, fakeFetch(() => new Response("<html>", { status: 200 })));
    await expect(notJson.analyze("http://api", post, [], "0000000000000000")).rejects.toBeInstanceOf(ApiError);
    const http500 = new ApiClient(1000, 2, fakeFetch(() => new Response("", { status: 500 })));
    await expect(http500.analyze("http://api", post, [], "0000000000000000")).rejects.toMatchObject({ reason: "http_500" });
  });

  it("reports unreachable servers", async () => {
    const client = new ApiClient(1000, 2, fakeFetch(() => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(client.analyze("http://api", post, [], "0000000000000000")).rejects.toMatchObject({ reason: "unreachable" });
    const health = await client.health("http://api");
    expect(health.ok).toBe(false);
  });

  it("limits concurrent analyses to two", async () => {
    let active = 0;
    let peak = 0;
    const client = new ApiClient(
      1000,
      2,
      fakeFetch(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return Response.json(good);
      }),
    );
    await Promise.all([1, 2, 3, 4, 5].map(() => client.analyze("http://api", post, [], "0000000000000000")));
    expect(peak).toBe(2);
    expect(client.inFlight).toBe(0);
  });

  it("times out slow requests", async () => {
    const client = new ApiClient(
      30,
      2,
      fakeFetch((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))),
    );
    await expect(client.analyze("http://api", post, [], "0000000000000000")).rejects.toMatchObject({ reason: "unreachable" });
  });
});
