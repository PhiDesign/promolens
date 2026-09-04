import { describe, expect, it } from "vitest";
import { hashPostContent, hashString } from "../src/index.js";

describe("hashing", () => {
  it("is deterministic and 16 hex chars", () => {
    expect(hashString("hello")).toBe(hashString("hello"));
    expect(hashString("hello")).toMatch(/^[a-f0-9]{16}$/);
    expect(hashString("hello")).not.toBe(hashString("hello!"));
  });

  it("changes when the analysed content changes", () => {
    const a = hashPostContent({ title: "t", body: "one" });
    const b = hashPostContent({ title: "t", body: "two" });
    expect(a).not.toBe(b);
  });

  it("ignores upvotes, which only affect reach", () => {
    const a = hashPostContent({ title: "t", body: "same", upvotes: 1 } as never);
    const b = hashPostContent({ title: "t", body: "same", upvotes: 99999 } as never);
    expect(a).toBe(b);
  });

  it("differs between feed and detail views of the same post", () => {
    const feed = hashPostContent({ title: "t", body: "same" });
    const detail = hashPostContent({ title: "t", body: "same", isDetailPage: true });
    expect(feed).not.toBe(detail);
  });
});
