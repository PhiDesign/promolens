import { describe, expect, it } from "vitest";
import { analyzePost, detectHistorySignals, summarizeHistory, type AuthorHistory, type PostInput } from "../src/index.js";

const now = Math.floor(Date.now() / 1000);
const day = 86400;

function sub(subreddit: string, title: string, extra: Partial<AuthorHistory["submissions"][number]> = {}) {
  return { subreddit, title, createdUtc: now - 3 * day, ...extra };
}

const post: PostInput = {
  id: "t3_cur",
  title: "My exact content workflow that took me from 0 to 50k views",
  body: "Step 1: Google Trends. Step 2: Notion. Step 3: run it through Rankforge (https://rankforge.io/?ref=maya) which changed everything. Step 4: WordPress.",
  author: "maya_writes",
  links: ["https://rankforge.io/?ref=maya"],
  outboundDomains: ["rankforge.io"],
};
const targets = { names: ["Rankforge"], domains: ["rankforge.io"] };

const spammy: AuthorHistory = {
  author: "maya_writes",
  fetchedAt: Date.now(),
  available: true,
  accountAgeDays: 20,
  linkKarma: 10,
  commentKarma: 15,
  submissions: [
    sub("SEO", "How Rankforge fixed my search intent problem", { domain: "rankforge.io", url: "https://rankforge.io/?ref=maya" }),
    sub("blogging", "My exact content workflow that took me from 0 to 40k views", { excerpt: "Step 1 research. Step 3 run it through Rankforge which changed everything for my intent." }),
    sub("content_marketing", "Rankforge vs manual optimisation - my results", { domain: "rankforge.io", url: "https://rankforge.io/compare?ref=maya" }),
    sub("Entrepreneur", "We built Rankforge to fix a problem every writer has", { excerpt: "I'm the founder of Rankforge and we built this after years of SEO work." }),
    sub("juststarting", "Anyone else struggle with intent? Rankforge helped", { domain: "rankforge.io", url: "https://rankforge.io" }),
  ],
  comments: [
    { subreddit: "SEO", excerpt: "Try Rankforge, it handles this: https://rankforge.io", linkDomains: ["rankforge.io"] },
    { subreddit: "blogging", excerpt: "Rankforge does exactly this.", linkDomains: [] },
    { subreddit: "marketing", excerpt: "I use Rankforge for intent, works well", linkDomains: [] },
    { subreddit: "marketing", excerpt: "Nice post, thanks.", linkDomains: [] },
  ],
};

const genuine: AuthorHistory = {
  author: "maya_writes",
  fetchedAt: Date.now(),
  available: true,
  accountAgeDays: 1500,
  linkKarma: 4000,
  commentKarma: 12000,
  submissions: [
    sub("cooking", "Best way to store fresh herbs?"),
    sub("hiking", "Trail report: Ben Nevis in October", { domain: "walkhighlands.co.uk", url: "https://www.walkhighlands.co.uk/x" }),
    sub("SEO", "Which keyword tool do you trust?", { domain: "ahrefs.com", url: "https://ahrefs.com/blog/x" }),
    sub("blogging", "Semrush vs Ahrefs after a year", { domain: "semrush.com", url: "https://www.semrush.com/x" }),
    sub("personalfinance", "Finally paid off my car"),
    sub("gardening", "Tomatoes finally ripening"),
  ],
  comments: [
    { subreddit: "cooking", excerpt: "Wrap them in a damp towel.", linkDomains: [] },
    { subreddit: "hiking", excerpt: "Take layers, it gets cold at the top.", linkDomains: [] },
    { subreddit: "SEO", excerpt: "Ahrefs has the better index in my experience.", linkDomains: [] },
    { subreddit: "SEO", excerpt: "Depends on budget honestly.", linkDomains: [] },
    { subreddit: "gardening", excerpt: "Mine did the same last year.", linkDomains: [] },
  ],
};

describe("detectHistorySignals", () => {
  it("reports history as unavailable when absent or blocked", () => {
    expect(detectHistorySignals(post, targets).map((s) => s.id)).toEqual(["availability.profile-history-unavailable"]);
    const blocked = detectHistorySignals({ ...post, authorHistory: { ...spammy, available: false, reason: "private_or_suspended" } }, targets);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.explanation).toMatch(/private/);
  });

  it("finds the same product repeated across posts, communities and comments, plus a public self-identification", () => {
    const ids = detectHistorySignals({ ...post, authorHistory: spammy }, targets).map((s) => s.id);
    expect(ids).toContain("availability.profile-history-checked");
    expect(ids).toContain("account.repeats-domain");
    expect(ids).toContain("history.cross-subreddit");
    expect(ids).toContain("account.single-product-history");
    expect(ids).toContain("history.repeated-text");
    expect(ids).toContain("account.comments-redirect");
    expect(ids).toContain("account.self-identified-elsewhere");
    expect(ids).toContain("account.new-low-karma-product-focus");
    expect(ids).not.toContain("availability.profile-history-unavailable");
    const self = detectHistorySignals({ ...post, authorHistory: spammy }, targets).find((s) => s.id === "account.self-identified-elsewhere");
    expect(self?.verified).toBe(true);
    expect(self?.explanation).toMatch(/^In r\/Entrepreneur/);
  });

  it("emits counter-signals for a varied, long-standing history", () => {
    const ids = detectHistorySignals({ ...post, authorHistory: genuine }, targets).map((s) => s.id);
    expect(ids).toContain("counter.varied-recommendations");
    expect(ids).toContain("counter.genuine-history");
    expect(ids).toContain("counter.incidental-product");
    expect(ids).not.toContain("account.repeats-domain");
    expect(ids).not.toContain("account.new-account");
  });

  it("never labels the person; explanations stay observational", () => {
    for (const s of detectHistorySignals({ ...post, authorHistory: spammy }, targets)) {
      expect(s.explanation).not.toMatch(/spammer|shill|scam|liar/i);
    }
  });
});

describe("history in the full analysis", () => {
  it("raises the score and confidence for the spammy history and keeps disclosure missing", () => {
    const without = analyzePost(post);
    const withHistory = analyzePost({ ...post, authorHistory: spammy });
    expect(withHistory.promoLikelihood).toBeGreaterThanOrEqual(without.promoLikelihood);
    expect(withHistory.promoLikelihood).toBeGreaterThanOrEqual(85);
    expect(withHistory.confidence).toBe("high");
    expect(withHistory.disclosure).toBe("missing"); // said elsewhere, not here: disclosure timing matters
    expect(withHistory.reasons.join(" ")).toMatch(/other recent posts|communities|their own/);
  });

  it("lowers the score for a genuine history", () => {
    const without = analyzePost(post);
    const withHistory = analyzePost({ ...post, authorHistory: genuine });
    expect(withHistory.promoLikelihood).toBeLessThan(without.promoLikelihood);
  });

  it("a new low-karma account alone cannot create a high score", () => {
    const quiet: AuthorHistory = { ...genuine, accountAgeDays: 3, linkKarma: 1, commentKarma: 2, submissions: [], comments: [] };
    const r = analyzePost({ title: "Which budgeting app do you use?", body: "Curious what people here like. I have tried a few and none stuck.", authorHistory: quiet });
    expect(r.promoLikelihood).toBeLessThan(20);
  });

  it("history changes the content hash so cached results are not reused", async () => {
    const { hashPostContent } = await import("../src/index.js");
    expect(hashPostContent(post)).not.toBe(hashPostContent({ ...post, authorHistory: spammy }));
  });
});

describe("summarizeHistory", () => {
  it("is compact and content-light", () => {
    const text = summarizeHistory(spammy);
    expect(text).toMatch(/5 recent posts, 4 recent comments/);
    expect(text).toContain("r/Entrepreneur");
    expect(text.length).toBeLessThan(2000);
    expect(summarizeHistory(undefined)).toMatch(/not checked/);
  });
});
