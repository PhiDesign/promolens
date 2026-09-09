/**
 * "Bring your own key": run the language-model witness from the background
 * worker with the user's own OpenAI-compatible key. No server involved.
 *
 * The key lives in the extension's storage on the user's device and is sent
 * only to the provider, in the Authorization header of the model request.
 * Everything else (prompt, quote verification, caps) is the shared witness.
 */
import { LlmWitnessProvider, OpenAiChatClient, type AnalysisResult, type PostInput, type Signal } from "@promolens/shared";
import type { Settings } from "../shared/settings.js";

export const OPENAI_ORIGIN = "https://api.openai.com/*";
const OWN_KEY_TIMEOUT_MS = 50_000;

/** True when own-key mode is selected and a key is present. */
export function ownKeyReady(settings: Pick<Settings, "apiEnabled" | "aiProvider" | "ownKey">): boolean {
  return settings.apiEnabled && settings.aiProvider === "own-key" && settings.ownKey.trim().length > 0;
}

function client(settings: Pick<Settings, "ownKey" | "ownModel">, fetchFn?: typeof fetch): OpenAiChatClient {
  const model = settings.ownModel || "gpt-5-mini";
  return new OpenAiChatClient({
    apiKey: settings.ownKey.trim(),
    model,
    timeoutMs: OWN_KEY_TIMEOUT_MS,
    fetchFn,
    // Reasoning models think for a long time by default; evidence extraction
    // only needs a little. Same defaults as the API's config.
    reasoningEffort: /^(gpt-5|o[1-9])/i.test(model) ? "low" : undefined,
    verbosity: /^gpt-5/i.test(model) ? "low" : undefined,
  });
}

export async function analyzeWithOwnKey(
  post: PostInput,
  localSignals: Signal[],
  settings: Pick<Settings, "ownKey" | "ownModel">,
  fetchFn?: typeof fetch,
): Promise<AnalysisResult> {
  const provider = new LlmWitnessProvider(client(settings, fetchFn));
  return provider.analyze({ post, localSignals }, AbortSignal.timeout(OWN_KEY_TIMEOUT_MS + 1_000));
}

/** One tiny completion; returns a short human-readable status. Never includes the key. */
export async function testOwnKey(settings: Pick<Settings, "ownKey" | "ownModel">, fetchFn?: typeof fetch): Promise<{ ok: boolean; message: string }> {
  if (!settings.ownKey.trim()) return { ok: false, message: "Paste your API key first." };
  try {
    const text = await client(settings, fetchFn).complete("Reply with the single word: ok", "ok?", AbortSignal.timeout(20_000));
    return { ok: true, message: `Key works (${settings.ownModel}: "${text.trim().slice(0, 20)}")` };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    if (/401/.test(m)) return { ok: false, message: "The provider rejected the key (HTTP 401). Check it was copied completely." };
    if (/404|model_not_found/.test(m)) return { ok: false, message: `The model "${settings.ownModel}" was not found on this account.` };
    if (/429|insufficient_quota|rate_limit/.test(m)) return { ok: false, message: "The provider reports no quota or a rate limit on this key (HTTP 429)." };
    if (/timed out/.test(m)) return { ok: false, message: "The provider did not answer in time." };
    return { ok: false, message: `Could not reach the provider: ${m.replace(/sk-[A-Za-z0-9_-]+/g, "[key]")}` };
  }
}
