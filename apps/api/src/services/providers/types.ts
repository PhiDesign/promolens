import type { AnalysisResult, AnalyzeRequest } from "@promolens/shared";

/**
 * An analysis provider turns a validated request into an AnalysisResult.
 *
 * The mock provider is deterministic and needs no secrets. A real AI provider
 * would implement this same interface, read its key from the server-side
 * config, and must still return signals with observable explanations.
 */
export interface AnalysisProvider {
  readonly name: string;
  analyze(request: AnalyzeRequest, signal: AbortSignal): Promise<AnalysisResult>;
}
