import { detectAll, scoreSignals, type AnalysisResult, type AnalyzeRequest, type Signal } from "@promolens/shared";
import type { AnalysisProvider } from "./types.js";

/**
 * Deterministic mock provider.
 *
 * It re-runs the shared rule engine on the server (so the server is the
 * authority, not the client's `localSignals`) and adds one honest note: no
 * additional evidence sources were consulted. It never raises confidence
 * beyond what the evidence supports.
 */
export class MockProvider implements AnalysisProvider {
  readonly name = "mock";

  async analyze(request: AnalyzeRequest, signal: AbortSignal): Promise<AnalysisResult> {
    if (signal.aborted) throw new Error("aborted");
    const { signals } = detectAll(request.post);
    const note: Signal = {
      id: "api.mock-provider",
      category: "availability",
      explanation: "Analysed by the local mock provider; no additional evidence sources were consulted",
      weight: 0,
      evidenceSource: "api",
      verified: true,
      affects: ["confidence"],
      strength: "info",
    };
    return scoreSignals([...signals, note], request.post, "api");
  }
}
