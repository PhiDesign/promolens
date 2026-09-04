/**
 * Client for the optional local analysis API.
 * - at most `maxConcurrent` in-flight analyses (default 2)
 * - per-request timeout
 * - every response is validated against the shared schema before use
 */
import { AnalyzeResponseSchema, HealthResponseSchema, type AnalysisResult, type PostInput, type Signal } from "@promolens/shared";

export class ApiError extends Error {
  constructor(
    public readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  constructor(private readonly max: number) {}
  get inFlight(): number {
    return this.active;
  }
  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
    } else {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
      this.active++;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiters.shift()?.();
    };
  }
}

export class ApiClient {
  private readonly semaphore: Semaphore;

  constructor(
    private readonly timeoutMs = 5000,
    maxConcurrent = 2,
    // Wrapped so `this` is never the client: calling a stored bare `fetch`
    // throws "Illegal invocation" in workers and in Node.
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.semaphore = new Semaphore(maxConcurrent);
  }

  get inFlight(): number {
    return this.semaphore.inFlight;
  }

  async health(baseUrl: string): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await this.fetchWithTimeout(`${baseUrl}/api/v1/health`, { method: "GET" }, 3000);
      if (!res.ok) return { ok: false, message: `API responded with HTTP ${res.status}` };
      const parsed = HealthResponseSchema.safeParse(await res.json());
      if (!parsed.success) return { ok: false, message: "API health response was malformed" };
      return { ok: true, message: `Connected (provider: ${parsed.data.provider}, version ${parsed.data.version})` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "API unreachable" };
    }
  }

  async analyze(baseUrl: string, post: PostInput, localSignals: Signal[], contentHash: string): Promise<AnalysisResult> {
    const release = await this.semaphore.acquire();
    try {
      let res: Response;
      try {
        res = await this.fetchWithTimeout(
          `${baseUrl}/api/v1/analyze`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ post, localSignals, contentHash }),
          },
          this.timeoutMs,
        );
      } catch (err) {
        throw new ApiError("unreachable", err instanceof Error ? err.message : "API unreachable");
      }
      if (!res.ok) throw new ApiError(`http_${res.status}`, `API responded with HTTP ${res.status}`);
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new ApiError("invalid_json", "API response was not JSON");
      }
      const parsed = AnalyzeResponseSchema.safeParse(json);
      if (!parsed.success) throw new ApiError("invalid_response", "API response failed schema validation");
      const { cached: _cached, contentHash: _hash, ...result } = parsed.data;
      return { ...result, source: "api" };
    } finally {
      release();
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
