import { describe, expect, it } from "vitest";
import { AnalysisResultSchema, analyzePost } from "@promolens/shared";
import { analyzeWithOwnKey, ownKeyReady, testOwnKey } from "../src/background/ownKey.js";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/settings.js";

const post = { title: "I built a habit tracker", body: "I'm the founder of HabitLoop. Try it at https://habitloop.app", links: ["https://habitloop.app"] };

function fakeOpenAi(reply: string, status = 200): { fetchFn: typeof fetch; calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] } {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchFn: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), headers: (init?.headers as Record<string, string>) ?? {}, body: JSON.parse(String(init?.body)) });
    if (status !== 200) return new Response(JSON.stringify({ error: { code: "invalid_api_key" } }), { status });
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 });
  };
  return { fetchFn, calls };
}

describe("own-key mode", () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, apiEnabled: true, aiProvider: "own-key", ownKey: "sk-test-1234", ownModel: "gpt-5-mini" };

  it("is ready only when enabled, selected and a key is present", () => {
    expect(ownKeyReady(settings)).toBe(true);
    expect(ownKeyReady({ ...settings, ownKey: "  " })).toBe(false);
    expect(ownKeyReady({ ...settings, aiProvider: "local-api" })).toBe(false);
    expect(ownKeyReady({ ...settings, apiEnabled: false })).toBe(false);
  });

  it("runs the witness against api.openai.com with the user's key and returns a valid, model-marked result", async () => {
    const { fetchFn, calls } = fakeOpenAi(JSON.stringify({ signals: [{ id: "lang.feature-focus", quote: "habit tracker", confidence: 0.9 }] }));
    const local = analyzePost(post);
    const result = await analyzeWithOwnKey(post, local.signals, settings, fetchFn);
    expect(AnalysisResultSchema.safeParse(result).success).toBe(true);
    expect(result.source).toBe("api");
    expect(result.signals.some((s) => s.id === "api.llm-witness")).toBe(true);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]?.headers.authorization).toBe("Bearer sk-test-1234");
    expect(calls[0]?.body.model).toBe("gpt-5-mini");
    expect(calls[0]?.body.reasoning_effort).toBe("low");
    // the key never appears anywhere but the header
    expect(JSON.stringify(calls[0]?.body)).not.toContain("sk-test");
  });

  it("test reports a working key, and a rejected one without echoing it", async () => {
    const good = fakeOpenAi('{"ok": true}');
    expect((await testOwnKey(settings, good.fetchFn)).ok).toBe(true);
    // OpenAI requires the word "json" in the prompt when JSON output is requested
    const msgs = good.calls[0]?.body.messages as { content: string }[];
    expect(msgs.some((m) => /json/i.test(m.content))).toBe(true);
    const bad = await testOwnKey(settings, fakeOpenAi("", 401).fetchFn);
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/401/);
    expect(bad.message).not.toContain("sk-test");
    expect((await testOwnKey({ ...settings, ownKey: "" })).message).toMatch(/Paste your API key/);
  });
});

describe("settings sanitize own-key fields", () => {
  it("keeps a valid model id, falls back on junk, and trims the key", async () => {
    const { loadSettings } = await import("../src/shared/settings.js");
    (globalThis as { chrome?: unknown }).chrome = {
      storage: { local: { get: async () => ({ "promolens:settings": { ownKey: "  sk-x  ", ownModel: "not a model id!", aiProvider: "bogus" } }) } },
    };
    const s = await loadSettings();
    expect(s.ownKey).toBe("sk-x");
    expect(s.ownModel).toBe("gpt-5-mini");
    expect(s.aiProvider).toBe(DEFAULT_SETTINGS.aiProvider); // "hosted" once a hosted URL is configured
    delete (globalThis as { chrome?: unknown }).chrome;
  });
});
