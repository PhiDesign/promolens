// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://www.reddit.com/r/webdev/" }
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROCESSED_ATTR } from "../src/reddit/adapter.js";
import { PostScanner, type PostRecord } from "../src/content/scanner.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rings(): NodeListOf<Element> {
  return document.querySelectorAll("promolens-ring");
}

describe("PostScanner", () => {
  let scanner: PostScanner;
  let near: PostRecord[];
  let removed: PostRecord[];

  beforeEach(() => {
    document.body.innerHTML = readFileSync(join(FIXTURES, "dynamic-insert.html"), "utf8");
    near = [];
    removed = [];
    scanner = new PostScanner(
      {
        onNearViewport: (r) => near.push(r),
        onLeftViewport: () => undefined,
        onRemoved: (r) => removed.push(r),
      },
      { debounceMs: 20, sweepIntervalMs: 50 },
    );
  });

  afterEach(() => {
    scanner.stop();
  });

  it("attaches exactly one ring to posts already on the page", () => {
    scanner.start();
    expect(rings()).toHaveLength(1);
    expect(scanner.size).toBe(1);
    expect(near).toHaveLength(1);
    expect(document.getElementById("t3_dyn000")!.hasAttribute(PROCESSED_ATTR)).toBe(true);
  });

  it("does not inject duplicate rings when scanned repeatedly", () => {
    scanner.start();
    scanner.scan(document);
    scanner.scan(document);
    scanner.scan(document.getElementById("t3_dyn000")!);
    expect(rings()).toHaveLength(1);
    expect(near).toHaveLength(1);
  });

  it("picks up a post inserted later (infinite scroll) via MutationObserver", async () => {
    scanner.start();
    const tpl = document.getElementById("late-post") as HTMLTemplateElement;
    document.getElementById("feed")!.appendChild(tpl.content.cloneNode(true));
    await wait(80);
    expect(rings()).toHaveLength(2);
    expect(near.map((r) => r.el.id)).toEqual(["t3_dyn000", "t3_dyn001"]);
  });

  it("cleans up records for posts removed from the page", async () => {
    scanner.start();
    const first = document.getElementById("t3_dyn000")!;
    first.remove();
    await wait(120);
    expect(scanner.size).toBe(0);
    expect(removed).toHaveLength(1);
    expect(rings()).toHaveLength(0);
  });

  it("removes every ring and marker when stopped (extension disabled)", () => {
    scanner.start();
    scanner.stop();
    expect(rings()).toHaveLength(0);
    expect(document.getElementById("t3_dyn000")!.hasAttribute(PROCESSED_ATTR)).toBe(false);
    expect(scanner.size).toBe(0);
  });

  it("uses IntersectionObserver when available and only reports intersecting posts", () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    let callback: IntersectionObserverCallback = () => undefined;
    class FakeIO {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal("IntersectionObserver", FakeIO);
    try {
      scanner.start();
      expect(observe).toHaveBeenCalledTimes(1);
      expect(near).toHaveLength(0);
      const el = document.getElementById("t3_dyn000")!;
      callback([{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
      expect(near).toHaveLength(1);
      scanner.stop();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
