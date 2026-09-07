import { describe, expect, it } from "vitest";
import { sourceNote } from "../src/ui/popover.js";

describe("sourceNote", () => {
  it("says local rules for browser results, including a failed model step", () => {
    expect(sourceNote({ source: "local", signals: [] })).toBe("Local rules · estimate");
    expect(sourceNote({ source: "local", signals: [{ id: "api.enrich-failed", explanation: "x" }] })).toBe("Local rules · estimate");
  });

  it("says rules + AI when a language model contributed", () => {
    expect(sourceNote({ source: "api", signals: [{ id: "api.llm-witness", explanation: "A language model (openai:m) reviewed..." }] })).toBe("Local rules + AI · estimate");
  });

  it("the mock provider is still just rules", () => {
    expect(sourceNote({ source: "api", signals: [{ id: "api.mock-provider", explanation: "x" }] })).toBe("Local rules · estimate");
  });
});
