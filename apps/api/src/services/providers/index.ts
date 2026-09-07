import type { ApiConfig } from "../../config.js";
import { DirectLlmProvider } from "./direct.js";
import { LlmWitnessProvider } from "./llm.js";
import { MockProvider } from "./mock.js";
import { OpenAiChatClient } from "./openai.js";
import type { AnalysisProvider } from "./types.js";

/**
 * Provider registry.
 *
 *   mock    - deterministic, re-runs the rule engine, needs no key (default)
 *   openai  - any OpenAI-compatible chat endpoint used as an evidence witness
 *             (see ./llm.ts). Needs ANALYSIS_PROVIDER_API_KEY and LLM_MODEL.
 *   openai-direct - EXPERIMENTAL: the model produces the score itself
 *             (see ./direct.ts). For the evaluation harness; not recommended
 *             for daily use until docs/evaluation.md says otherwise.
 *
 * Secrets come from config only; they never reach the extension. Do not enable
 * a paid provider without reading docs/privacy.md.
 */
export function createProvider(config: ApiConfig, log?: (line: string) => void): AnalysisProvider {
  switch (config.provider) {
    case "mock":
      return new MockProvider();
    case "openai":
    case "openai-direct": {
      const client = new OpenAiChatClient({
        apiKey: config.providerApiKey ?? "",
        model: config.llmModel ?? "",
        baseUrl: config.llmBaseUrl,
        timeoutMs: Math.min(config.llmTimeoutMs, Math.max(1_000, config.requestTimeoutMs - 500)),
        reasoningEffort: config.llmReasoningEffort,
        verbosity: config.llmVerbosity,
      });
      if (config.provider === "openai-direct") {
        log?.("WARNING: ANALYSIS_PROVIDER=openai-direct is experimental - the model scores without the rule engine's caps");
        return new DirectLlmProvider(client, { log });
      }
      return new LlmWitnessProvider(client, { log });
    }
    default:
      throw new Error(
        `Unknown ANALYSIS_PROVIDER "${config.provider}". Implemented: "mock", "openai", "openai-direct". ` +
          "Add new providers under apps/api/src/services/providers/.",
      );
  }
}

export type { AnalysisProvider } from "./types.js";
