// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://www.reddit.com/r/personalfinance/comments/acc001/this_budgeting_app/" }
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
import { describe, expect, it } from "vitest";
import { analyzePost } from "@promolens/shared";
import { extractPost, extractVisibleComments, findPostElements, findDetailPostElement, mountRing } from "../src/reddit/adapter.js";

describe("adapter: post detail page", () => {
  document.body.innerHTML = readFileSync(join(FIXTURES, "accused-comments.html"), "utf8");
  const post = findPostElements(document)[0]!;

  it("extracts visible comments and marks the author's replies", () => {
    const comments = extractVisibleComments(document, "saver_jane");
    expect(comments).toHaveLength(5); // [deleted] is skipped
    expect(comments[0]).toMatchObject({ author: "skeptic1", text: "this is an ad", isOp: false, depth: 0 });
    expect(comments.filter((c) => c.isOp)).toHaveLength(2);
  });

  it("includes comments in the post input on a detail page", () => {
    const input = extractPost(post)!;
    expect(input.isDetailPage).toBe(true);
    expect(input.visibleComments).toHaveLength(5);
    expect(input.title).toContain("budgeting app");
  });

  it("gives an unsupported accusation minimal weight and keeps the post low", () => {
    const result = analyzePost(extractPost(post)!);
    const accusation = result.signals.find((s) => s.id === "community.single-accusation");
    expect(accusation?.weight).toBeLessThanOrEqual(2);
    expect(result.promoLikelihood).toBeLessThan(20);
    // The author answered questions publicly without pushing a purchase.
    expect(result.signals.some((s) => s.id === "counter.answers-without-push")).toBe(false); // only 2 OP replies, threshold is 3
  });
});

describe("findDetailPostElement", () => {
  it("picks the post matching the URL id, not related posts", () => {
    document.body.innerHTML = `
      <shreddit-post id="t3_other01" permalink="/r/x/comments/other01/related/"><a slot="title">Related</a></shreddit-post>
      <shreddit-post id="t3_acc001" permalink="/r/personalfinance/comments/acc001/this_budgeting_app/"><h1 slot="title">Main</h1></shreddit-post>`;
    const el = findDetailPostElement(document, "https://www.reddit.com/r/personalfinance/comments/acc001/this_budgeting_app/");
    expect(el?.getAttribute("id")).toBe("t3_acc001");
  });

  it("falls back to the post carrying the h1 title", () => {
    document.body.innerHTML = `
      <shreddit-post id="t3_a"><a slot="title">Feed card</a></shreddit-post>
      <shreddit-post id="t3_b"><h1 slot="title">Main</h1></shreddit-post>`;
    expect(findDetailPostElement(document, "https://www.reddit.com/r/x/comments/zzz/")?.getAttribute("id")).toBe("t3_b");
  });

  it("returns null when there is no post", () => {
    document.body.innerHTML = "<div></div>";
    expect(findDetailPostElement(document, "https://www.reddit.com/r/x/comments/zzz/")).toBeNull();
  });

  it("mounts the button in the header just before Reddit's overflow menu, falling back to the title", () => {
    document.body.innerHTML = `
      <shreddit-post id="t3_h1">
        <div slot="credit-bar"><span>r/x · 5h</span><span class="right"><shreddit-post-overflow-menu></shreddit-post-overflow-menu></span></div>
        <h1 slot="title">Main</h1>
      </shreddit-post>`;
    const post = document.querySelector<HTMLElement>("shreddit-post")!;
    const host = document.createElement("promolens-ring");
    expect(mountRing(post, host)).toBe(true);
    expect(host.dataset.placement).toBe("header");
    // The menu's wrapper is not a flex row here, so the button goes beside the wrapper.
    expect(host.nextElementSibling?.className).toBe("right");
    expect(host.parentElement?.getAttribute("slot")).toBe("credit-bar");
    expect(host.hasAttribute("slot")).toBe(false);

    // Post page shape: menu directly inside a flex row.
    document.body.innerHTML = `
      <shreddit-post id="t3_h3">
        <div slot="credit-bar"><span>r/x</span><span class="right" style="display:flex"><shreddit-post-overflow-menu></shreddit-post-overflow-menu></span></div>
        <h1 slot="title">Main</h1>
      </shreddit-post>`;
    const post3 = document.querySelector<HTMLElement>("shreddit-post")!;
    const host3 = document.createElement("promolens-ring");
    expect(mountRing(post3, host3)).toBe(true);
    expect(host3.nextElementSibling?.tagName.toLowerCase()).toBe("shreddit-post-overflow-menu");

    document.body.innerHTML = `<shreddit-post id="t3_h2"><h1 slot="title">No menu</h1></shreddit-post>`;
    const post2 = document.querySelector<HTMLElement>("shreddit-post")!;
    const host2 = document.createElement("promolens-ring");
    expect(mountRing(post2, host2)).toBe(true);
    expect(host2.dataset.placement).toBe("title");
    expect(host2.getAttribute("slot")).toBe("title");
  });

  it("ignores a feed card with the matching id while Reddit is still transitioning", () => {
    document.body.innerHTML = `
      <shreddit-post id="t3_acc001" permalink="/r/x/comments/acc001/post/"><a slot="title">Feed card of the same post</a></shreddit-post>`;
    expect(findDetailPostElement(document, "https://www.reddit.com/r/x/comments/acc001/post/")).toBeNull();
  });
});
