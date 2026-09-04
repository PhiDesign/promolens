// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://www.reddit.com/r/all/" }
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
import { beforeEach, describe, expect, it } from "vitest";
import { analyzePost } from "@promolens/shared";
import { extractPost, findPostElements, findTitleElement, getPostKey, isDetailPage, mountRing, PROCESSED_ATTR } from "../src/reddit/adapter.js";

function loadFixture(name: string): void {
  document.body.innerHTML = readFileSync(join(FIXTURES, `${name}.html`), "utf8");
}

describe("adapter: feed extraction", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("finds posts and extracts visible fields from the organic fixture", () => {
    loadFixture("organic-advice");
    const posts = findPostElements(document);
    expect(posts).toHaveLength(1);
    const input = extractPost(posts[0]!);
    expect(input).not.toBeNull();
    expect(input!.id).toBe("t3_org001");
    expect(input!.title).toContain("consistent with studying");
    expect(input!.author).toBe("quiet_learner");
    expect(input!.subreddit).toBe("GetStudying");
    expect(input!.upvotes).toBe(45);
    expect(input!.commentsCount).toBe(12);
    expect(input!.url).toBe("https://www.reddit.com/r/GetStudying/comments/org001/how_i_finally_got_consistent/");
    expect(input!.body).toContain("Downsides");
    expect(input!.outboundDomains).toEqual([]);
    expect(input!.isDetailPage).toBe(false);
    expect(typeof input!.ageHours).toBe("number");
  });

  it("collects body links and outbound domains for the workflow fixture", () => {
    loadFixture("undisclosed-workflow");
    const input = extractPost(findPostElements(document)[0]!)!;
    expect(input.links).toContain("https://rankforge.io/?ref=growth");
    expect(input.outboundDomains).toContain("rankforge.io");
  });

  it("uses content-href for link posts", () => {
    loadFixture("dynamic-insert");
    const tpl = document.getElementById("late-post") as HTMLTemplateElement;
    document.getElementById("feed")!.appendChild(tpl.content.cloneNode(true));
    const late = document.getElementById("t3_dyn001") as HTMLElement;
    const input = extractPost(late)!;
    expect(input.links).toContain("https://example.com/tool?ref=bob");
    expect(input.outboundDomains).toContain("example.com");
  });

  it("returns null for an element without a title", () => {
    document.body.innerHTML = "<shreddit-post id='t3_x'></shreddit-post>";
    expect(extractPost(document.querySelector("shreddit-post")!)).toBeNull();
  });

  it("mounts the ring host before the title with the same slot", () => {
    loadFixture("organic-advice");
    const post = findPostElements(document)[0]!;
    const host = document.createElement("promolens-ring");
    expect(mountRing(post, host)).toBe(true);
    expect(host.getAttribute("slot")).toBe("title");
    expect(host.nextElementSibling).toBe(findTitleElement(post));
    expect(post.hasAttribute(PROCESSED_ATTR)).toBe(false); // scanner sets the marker, not the adapter
  });

  it("derives a stable key", () => {
    loadFixture("founder-transparent");
    expect(getPostKey(findPostElements(document)[0]!)).toBe("t3_fnd001");
  });

  it("recognises detail-page URLs", () => {
    expect(isDetailPage("https://www.reddit.com/r/x/comments/abc123/title/")).toBe(true);
    expect(isDetailPage("https://www.reddit.com/r/x/")).toBe(false);
  });
});

describe("adapter + engine on fixtures", () => {
  const cases: [string, (r: ReturnType<typeof analyzePost>) => void][] = [
    ["organic-advice", (r) => {
      expect(r.promoLikelihood).toBeLessThan(20);
      expect(r.disclosure).toBe("unknown");
    }],
    ["founder-transparent", (r) => {
      expect(r.promoLikelihood).toBeGreaterThanOrEqual(80);
      expect(r.disclosure).toBe("clear");
      expect(r.undisclosedRisk).toBe("low");
    }],
    ["undisclosed-workflow", (r) => {
      expect(r.promoLikelihood).toBeGreaterThanOrEqual(60);
      expect(r.disclosure).toBe("missing");
      expect(r.undisclosedRisk).toBe("high");
    }],
    ["high-upvote-organic", (r) => {
      expect(r.promoLikelihood).toBeLessThan(20);
      expect(r.reach.level).toBe("high");
    }],
  ];

  for (const [name, check] of cases) {
    it(`scores the ${name} fixture as expected`, () => {
      loadFixture(name);
      const input = extractPost(findPostElements(document)[0]!)!;
      check(analyzePost(input));
    });
  }
});
