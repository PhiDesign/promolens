import { describe, expect, it } from "vitest";
import { AnalysisResultSchema, type AnalyzeRequest } from "@promolens/shared";
import { LlmWitnessProvider, parseModelOutput, type ChatClient } from "../src/services/providers/llm.js";
import { OpenAiChatClient } from "../src/services/providers/openai.js";

function fakeClient(reply: string | (() => string)): ChatClient {
  return {
    name: "fake-model",
    complete: async () => (typeof reply === "function" ? reply() : reply),
  };
}

const founderAdvice: AnalyzeRequest = {
  post: {
    title: "Got into the app store. Now what? Technical founder, no idea how to get users.",
    body:
      "Six months ago I started building a tool for myself. That turned into CallBuddy, a desktop app from my company. " +
      "The app is live, free during early access, one-click install from the store. " +
      "Where did your first 100 users actually come from?",
    subreddit: "SaaS",
  },
  localSignals: [],
};

const ctrl = () => new AbortController().signal;

describe("LlmWitnessProvider", () => {
  it("adds a claim only when its quote appears verbatim in the post", async () => {
    const provider = new LlmWitnessProvider(
      fakeClient(
        JSON.stringify({
          signals: [
            { id: "lang.feature-focus", quote: "one-click install from the store", confidence: 0.9 },
            { id: "cta.dm-request", quote: "DM me for the link", confidence: 0.95 }, // not in the post
          ],
          retract: [],
        }),
      ),
    );
    const result = await provider.analyze(founderAdvice, ctrl());
    const ids = result.signals.map((s) => s.id);
    expect(ids).toContain("lang.feature-focus");
    expect(ids).not.toContain("cta.dm-request");
    expect(result.source).toBe("api");
    expect(AnalysisResultSchema.safeParse(result).success).toBe(true);
    const note = result.signals.find((s) => s.id === "api.llm-witness");
    expect(note?.explanation).toContain("1 without a matching quote were discarded");
  });

  it("quote matching ignores case, whitespace and smart quotes", async () => {
    const provider = new LlmWitnessProvider(
      fakeClient(JSON.stringify({ signals: [{ id: "lang.feature-focus", quote: "ONE-CLICK   INSTALL", confidence: 0.9 }] })),
    );
    const result = await provider.analyze(founderAdvice, ctrl());
    expect(result.signals.map((s) => s.id)).toContain("lang.feature-focus");
  });

  it("ignores unknown criterion ids and low-confidence claims", async () => {
    const provider = new LlmWitnessProvider(
      fakeClient(
        JSON.stringify({
          signals: [
            { id: "made.up", quote: "app is live", confidence: 1 },
            { id: "lang.feature-focus", quote: "app is live", confidence: 0.3 },
          ],
        }),
      ),
    );
    const result = await provider.analyze(founderAdvice, ctrl());
    const ids = result.signals.map((s) => s.id);
    expect(ids).not.toContain("made.up");
    expect(ids).not.toContain("lang.feature-focus");
  });

  it("honours retractions for text judgments but never for mechanical facts", async () => {
    const promo: AnalyzeRequest = {
      post: {
        title: "Best invoicing tool",
        body: "Just sign up here https://invoicezap.io/?ref=abc123 and use code SAVE20. It's a game changer.",
        links: ["https://invoicezap.io/?ref=abc123"],
      },
      localSignals: [],
    };
    const before = await new LlmWitnessProvider(fakeClient('{"signals":[],"retract":[]}')).analyze(promo, ctrl());
    expect(before.signals.map((s) => s.id)).toContain("cta.direct");
    expect(before.signals.map((s) => s.id)).toContain("link.affiliate-params");

    const after = await new LlmWitnessProvider(
      fakeClient(
        JSON.stringify({
          signals: [],
          retract: [
            { id: "cta.direct", reason: "test" },
            { id: "link.affiliate-params", reason: "should be ignored" },
            { id: "counter.no-cta", reason: "should be ignored" },
          ],
        }),
      ),
    ).analyze(promo, ctrl());
    const ids = after.signals.map((s) => s.id);
    expect(ids).not.toContain("cta.direct");
    expect(ids).toContain("link.affiliate-params");
    expect(after.promoLikelihood).toBeLessThanOrEqual(before.promoLikelihood);
  });

  it("the model cannot output a score: results still obey caps and the reach separation", async () => {
    const spam = JSON.stringify({
      signals: [
        { id: "lang.hype-phrases", quote: "app is live", confidence: 1 },
        { id: "lang.feature-focus", quote: "app is live", confidence: 1 },
        { id: "lang.sales-page-format", quote: "app is live", confidence: 1 },
        { id: "lang.transformation", quote: "app is live", confidence: 1 },
        { id: "lang.slogans", quote: "app is live", confidence: 1 },
      ],
    });
    const quiet = await new LlmWitnessProvider(fakeClient(spam)).analyze(founderAdvice, ctrl());
    const viral = await new LlmWitnessProvider(fakeClient(spam)).analyze(
      { ...founderAdvice, post: { ...founderAdvice.post, upvotes: 30000, commentsCount: 2000, ageHours: 2 } },
      ctrl(),
    );
    expect(quiet.promoLikelihood).toBe(viral.promoLikelihood);
    expect(viral.reach.level).toBe("high");
    // five marketing phrases are capped at 15 points for the category
    const marketing = quiet.signals.filter((s) => s.category === "marketing-language");
    expect(marketing.length).toBeGreaterThanOrEqual(4);
  });

  it("accepts capped free-form observations with verified quotes, in both directions", async () => {
    const provider = new LlmWitnessProvider(
      fakeClient(
        JSON.stringify({
          signals: [],
          observations: [
            { quote: "free during early access", direction: "promotional", note: "pricing framing typical of launches", confidence: 0.9 },
            { quote: "one-click install", direction: "promotional", note: "install path emphasised", confidence: 0.9 },
            { quote: "where did your first 100 users", direction: "organic", note: "asks for help rather than offering", confidence: 0.9 },
            { quote: "buy now buy now", direction: "promotional", note: "not in the post", confidence: 0.9 },
            { quote: "CallBuddy", direction: "promotional", note: "fourth one, beyond the limit", confidence: 0.9 },
          ],
        }),
      ),
    );
    const result = await provider.analyze(founderAdvice, ctrl());
    const obs = result.signals.filter((s) => s.id === "model.observation");
    expect(obs).toHaveLength(3);
    expect(obs.map((s) => s.weight).sort()).toEqual([-8, 8, 8]);
    expect(obs.every((s) => s.explanation.startsWith("Model observation:"))).toBe(true);
    const total = obs.reduce((n, s) => n + s.weight, 0);
    expect(total).toBeLessThanOrEqual(15); // category cap
  });

  it("lets the model cite history criteria only with quotes from the fetched history", async () => {
    const withHistory: AnalyzeRequest = {
      ...founderAdvice,
      post: {
        ...founderAdvice.post,
        authorHistory: {
          author: "x",
          fetchedAt: Date.now(),
          available: true,
          submissions: [{ subreddit: "startups", title: "CallBuddy is my company's new desktop app", excerpt: "We built CallBuddy for people who freeze on calls." }],
          comments: [],
        },
      },
    };
    const provider = new LlmWitnessProvider(
      fakeClient(
        JSON.stringify({
          signals: [
            { id: "history.cross-subreddit", quote: "CallBuddy is my company's new desktop app", confidence: 0.9 },
            { id: "account.repeats-domain", quote: "linked callbuddy.app in 9 posts", confidence: 0.9 }, // not a real quote
          ],
        }),
      ),
    );
    const ids = (await provider.analyze(withHistory, ctrl())).signals.map((s) => s.id);
    expect(ids).toContain("history.cross-subreddit");
    expect(ids).not.toContain("account.repeats-domain");
  });

  it("a disclosure quoted from the author's history does not count as a disclosure in this post", async () => {
    const undisclosed: AnalyzeRequest = {
      post: {
        title: "My exact content workflow",
        body: "Step 3: run it through Rankforge (https://rankforge.io/?ref=maya) which changed everything.",
        links: ["https://rankforge.io/?ref=maya"],
        authorHistory: {
          author: "maya",
          fetchedAt: Date.now(),
          available: true,
          submissions: [{ subreddit: "Entrepreneur", title: "We built Rankforge", excerpt: "I am the founder of Rankforge and we built this." }],
          comments: [],
        },
      },
      localSignals: [],
    };
    const provider = new LlmWitnessProvider(
      fakeClient(JSON.stringify({ signals: [{ id: "disclosure.employment", quote: "I am the founder of Rankforge", confidence: 0.95 }] })),
    );
    const result = await provider.analyze(undisclosed, ctrl());
    expect(result.signals.map((s) => s.id)).not.toContain("disclosure.employment");
    expect(result.disclosure).toBe("missing");
  });

  it("rejects malformed model output so nothing gets cached", async () => {
    await expect(new LlmWitnessProvider(fakeClient("Sure! Here is my analysis...")).analyze(founderAdvice, ctrl())).rejects.toThrow(/JSON/);
    await expect(new LlmWitnessProvider(fakeClient('{"signals":"nope"}')).analyze(founderAdvice, ctrl())).rejects.toThrow(/shape/);
  });

  it("neutralises accusatory wording in model notes", async () => {
    const provider = new LlmWitnessProvider(
      fakeClient(JSON.stringify({ signals: [{ id: "lang.feature-focus", quote: "app is live", confidence: 0.9, note: "obvious shill and scammer" }] })),
    );
    const result = await provider.analyze(founderAdvice, ctrl());
    const s = result.signals.find((x) => x.id === "lang.feature-focus");
    expect(s?.explanation).not.toMatch(/shill|scam/i);
  });
});

describe("parseModelOutput", () => {
  it("tolerates code fences", () => {
    const out = parseModelOutput('```json\n{"signals":[],"retract":[]}\n```');
    expect(out.signals).toEqual([]);
  });
});

describe("OpenAiChatClient", () => {
  it("sends the key only in the Authorization header and returns the message content", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchFn: typeof fetch = async (url, init) => {
      captured = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"signals":[]}' } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = new OpenAiChatClient({ apiKey: "sk-test", model: "test-model", baseUrl: "https://example.test/v1/", fetchFn });
    const text = await client.complete("sys", "user", ctrl());
    expect(text).toBe('{"signals":[]}');
    expect(captured?.url).toBe("https://example.test/v1/chat/completions");
    const headers = captured?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(captured?.init.body)) as { model: string; messages: unknown[]; response_format: unknown };
    expect(body.model).toBe("test-model");
    expect(body.messages).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain("sk-test");
    expect(client.name).toBe("openai:test-model");
  });

  it("sends reasoning_effort/verbosity when configured and drops them after a 400 that rejects them", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if ("reasoning_effort" in body) {
        return new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning_effort'", param: "reasoning_effort", code: "unsupported_parameter" } }), { status: 400 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"signals":[]}' } }] }), { status: 200 });
    };
    const client = new OpenAiChatClient({ apiKey: "sk-test", model: "gpt-5-mini", fetchFn, reasoningEffort: "low", verbosity: "low" });
    expect(await client.complete("s", "u", ctrl())).toBe('{"signals":[]}');
    expect(bodies[0]).toMatchObject({ reasoning_effort: "low", verbosity: "low" });
    expect(bodies[1]).not.toHaveProperty("reasoning_effort");
    await client.complete("s", "u", ctrl());
    expect(bodies).toHaveLength(3); // the rejection is remembered: no second failed attempt
    expect(bodies[2]).not.toHaveProperty("reasoning_effort");
  });

  it("surfaces the provider's short error code but never the body", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: "You exceeded your quota; prompt was: secret", code: "insufficient_quota" } }), { status: 429 });
    const client = new OpenAiChatClient({ apiKey: "sk-test", model: "m", fetchFn });
    await expect(client.complete("s", "u", ctrl())).rejects.toThrow(/HTTP 429 \(insufficient_quota\)/);
    await expect(client.complete("s", "u", ctrl())).rejects.not.toThrow(/secret/);
  });

  it("fails with a content-free error on HTTP errors", async () => {
    const fetchFn: typeof fetch = async () => new Response("secret prompt echo", { status: 401 });
    const client = new OpenAiChatClient({ apiKey: "sk-test", model: "m", fetchFn });
    await expect(client.complete("s", "u", ctrl())).rejects.toThrow(/HTTP 401/);
    await expect(client.complete("s", "u", ctrl())).rejects.not.toThrow(/secret/);
  });

  it("times out", async () => {
    const fetchFn: typeof fetch = (_url, init) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const client = new OpenAiChatClient({ apiKey: "sk-test", model: "m", timeoutMs: 20, fetchFn });
    await expect(client.complete("s", "u", ctrl())).rejects.toThrow(/timed out/);
  });

  it("uses the real global fetch correctly when none is injected (regression: Illegal invocation)", async () => {
    const client = new OpenAiChatClient({ apiKey: "sk-test", model: "m", baseUrl: "http://127.0.0.1:1/v1", timeoutMs: 500 });
    await expect(client.complete("s", "u", ctrl())).rejects.not.toThrow(/Illegal invocation/i);
  });

  it("refuses to start without a key or model", () => {
    expect(() => new OpenAiChatClient({ apiKey: "", model: "m" })).toThrow(/API_KEY/);
    expect(() => new OpenAiChatClient({ apiKey: "k", model: "" })).toThrow(/LLM_MODEL/);
  });
});
