import { describe, expect, it } from "vitest";
import { sourceNote } from "../src/ui/popover.js";

describe("sourceNote", () => {
  it("says local rules only for browser results", () => {
    expect(sourceNote({ source: "local", signals: [] })).toMatch(/^Local rules only\./);
  });
  it("names the model when the API used a language-model witness", () => {
    const note = sourceNote({
      source: "api",
      signals: [{ id: "api.llm-witness", explanation: "A language model (openai:test-model) reviewed the post text; 2 claim(s)..." }],
    });
    expect(note).toMatch(/^Rules \+ language model \(openai:test-model\)\./);
  });
  it("says rules via API for the mock provider", () => {
    expect(sourceNote({ source: "api", signals: [{ id: "api.mock-provider", explanation: "x" }] })).toMatch(/^Rules via local API\./);
  });
});
