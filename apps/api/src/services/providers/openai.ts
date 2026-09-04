/**
 * Thin client for any OpenAI-compatible Chat Completions endpoint.
 *
 * Only the pieces PromoLens needs: one system + one user message, JSON output,
 * a timeout, and an error message that never includes post content or the key.
 * The key comes from server config and is only ever put in the Authorization
 * header of this request.
 */
import type { ChatClient } from "./llm.js";

export interface OpenAiClientOptions {
  apiKey: string;
  model: string;
  /** e.g. https://api.openai.com/v1 - any compatible base URL works. */
  baseUrl?: string;
  timeoutMs?: number;
  /** Injected for tests. Defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Called with token usage after each call (for cost tracking). */
  onUsage?: (usage: { promptTokens: number; completionTokens: number }) => void;
}

export class OpenAiChatClient implements ChatClient {
  readonly name: string;
  private readonly endpoint: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: OpenAiClientOptions) {
    if (!options.apiKey) throw new Error("OpenAI-compatible provider needs ANALYSIS_PROVIDER_API_KEY");
    if (!options.model) throw new Error("OpenAI-compatible provider needs LLM_MODEL");
    const base = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.endpoint = `${base}/chat/completions`;
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init)); // bare fetch would throw "Illegal invocation"
    this.name = `openai:${options.model}`;
  }

  async complete(system: string, user: string, signal: AbortSignal): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 6_000);
    const onOuterAbort = () => controller.abort();
    signal.addEventListener("abort", onOuterAbort, { once: true });

    try {
      const res = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Surface only the provider's short error code (e.g. insufficient_quota,
        // model_not_found); never the body, which may echo the prompt.
        let code = "";
        try {
          const err = (await res.json()) as { error?: { code?: unknown; type?: unknown } };
          const raw = err.error?.code ?? err.error?.type;
          if (typeof raw === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(raw)) code = raw;
        } catch {
          /* not JSON */
        }
        throw new Error(`model endpoint returned HTTP ${res.status}${code ? ` (${code})` : ""}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      if (data.usage && this.options.onUsage) {
        this.options.onUsage({ promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 });
      }
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new Error("model endpoint returned no content");
      return content;
    } catch (err) {
      if (controller.signal.aborted) throw new Error("model request timed out or was cancelled");
      throw err instanceof Error ? err : new Error("model request failed");
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onOuterAbort);
    }
  }
}
