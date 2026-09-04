import { describe, expect, it } from "vitest";
import { fetchPostPage, normalizePermalink } from "../src/background/postFetch.js";
import type { FetchLike } from "../src/background/history.js";

const listing = (children: unknown[]) => ({ kind: "Listing", data: { children } });

function fakeReddit(status = 200, opts: { comments?: boolean } = { comments: true }): { fetchFn: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetchFn: FetchLike = async (url) => {
    urls.push(url);
    const post = {
      kind: "t3",
      data: {
        name: "t3_abc123",
        id: "abc123",
        title: "My exact content workflow",
        selftext: "Step 3: run it through Rankforge (https://rankforge.io/?ref=maya). Also see https://www.reddit.com/r/x.",
        author: "maya_writes",
        subreddit: "content_marketing",
        score: 320,
        num_comments: 70,
        created_utc: Date.now() / 1000 - 8 * 3600,
        is_self: true,
        permalink: "/r/content_marketing/comments/abc123/my_exact_content_workflow/",
      },
    };
    const comments = listing([
      { kind: "t1", data: { author: "skeptic", body: "this is an ad", replies: listing([{ kind: "t1", data: { author: "maya_writes", body: "not affiliated" } }]) } },
      { kind: "t1", data: { author: "someone", body: "[deleted]" } },
      { kind: "more", data: {} },
    ]);
    return { status, ok: status < 300, json: async () => (opts.comments ? [listing([post]), comments] : [listing([post])]) };
  };
  return { fetchFn, urls };
}

describe("normalizePermalink", () => {
  it("reduces any post URL or path to /r/<sub>/comments/<id>", () => {
    expect(normalizePermalink("https://www.reddit.com/r/SaaS/comments/1w7107y/rsaas_ai_cesspool/?utm=1")).toBe("/r/SaaS/comments/1w7107y");
    expect(normalizePermalink("/r/x/comments/abc/title/")).toBe("/r/x/comments/abc");
    expect(normalizePermalink("/r/x/")).toBeNull();
    expect(normalizePermalink("not a url at all")).toBeNull();
  });
});

describe("fetchPostPage", () => {
  it("builds a detail-page PostInput with body, links, domains and comments (OP flagged)", async () => {
    const { fetchFn, urls } = fakeReddit();
    const r = await fetchPostPage("/r/content_marketing/comments/abc123/my_exact_content_workflow/", fetchFn);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(urls[0]).toMatch(/^https:\/\/www\.reddit\.com\/r\/content_marketing\/comments\/abc123\.json\?raw_json=1/);
    expect(r.post).toMatchObject({ id: "t3_abc123", title: "My exact content workflow", author: "maya_writes", subreddit: "content_marketing", upvotes: 320, commentsCount: 70, isDetailPage: true });
    expect(r.post.links).toContain("https://rankforge.io/?ref=maya");
    expect(r.post.outboundDomains).toEqual(["rankforge.io"]); // reddit.com is not a product domain
    expect(r.post.ageHours).toBeCloseTo(8, 0);
    expect(r.post.visibleComments).toHaveLength(2); // deleted and "more" skipped
    expect(r.post.visibleComments?.[1]).toMatchObject({ author: "maya_writes", isOp: true, depth: 1 });
  });

  it("reports rate limits and errors without throwing", async () => {
    expect(await fetchPostPage("/r/x/comments/abc/", fakeReddit(429).fetchFn)).toEqual({ ok: false, reason: "rate_limited" });
    expect(await fetchPostPage("/r/x/comments/abc/", fakeReddit(404).fetchFn)).toEqual({ ok: false, reason: "not_found" });
    expect(await fetchPostPage("nope", fakeReddit().fetchFn)).toEqual({ ok: false, reason: "no_permalink" });
    const failing: FetchLike = async () => {
      throw new Error("offline");
    };
    expect(await fetchPostPage("/r/x/comments/abc/", failing)).toEqual({ ok: false, reason: "fetch_failed" });
  });
});
