import {
  AnalysisResultSchema,
  hashPostContent,
  type AnalyzeRequest,
  type AnalyzeResponse,
} from "@promolens/shared";
import { HttpError } from "../http.js";
import type { ContentHashCache } from "./cache.js";
import type { AnalysisProvider } from "./providers/types.js";

export interface AnalysisServiceOptions {
  cacheTtlMs: number;
  timeoutMs: number;
}

/**
 * Orchestrates one analysis: hash -> cache lookup -> provider (with timeout)
 * -> response validation -> cache store.
 */
export class AnalysisService {
  constructor(
    private readonly provider: AnalysisProvider,
    private readonly cache: ContentHashCache,
    private readonly options: AnalysisServiceOptions,
  ) {}

  get providerName(): string {
    return this.provider.name;
  }

  async analyze(request: AnalyzeRequest): Promise<AnalyzeResponse> {
    const contentHash = hashPostContent(request.post);

    const cached = await this.cache.get(contentHash);
    if (cached) return { ...cached.result, cached: true, contentHash };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let result;
    try {
      result = await Promise.race([
        this.provider.analyze(request, controller.signal),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener("abort", () =>
            reject(new HttpError(504, "analysis_timeout", `Analysis exceeded ${this.options.timeoutMs} ms`)),
          ),
        ),
      ]);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, "provider_error", "The analysis provider failed", {
        provider: this.provider.name,
      });
    } finally {
      clearTimeout(timer);
    }

    // Validate what the provider produced before anyone else sees it.
    const parsed = AnalysisResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new HttpError(502, "invalid_provider_response", "The analysis provider returned an invalid result", {
        issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }

    await this.cache.set(contentHash, parsed.data, this.options.cacheTtlMs);
    return { ...parsed.data, cached: false, contentHash };
  }
}
