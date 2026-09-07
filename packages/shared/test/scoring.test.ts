import { describe, expect, it } from "vitest";
import {
  analyzePost,
  clampScore,
  computePromoScore,
  computeReach,
  makeSignal,
  scoreSignals,
  STYLE_ONLY_CAP,
  type PostInput,
  type Signal,
} from "../src/index.js";

const basePost: PostInput = { title: "A post", body: "Some body text." };

describe("clampScore", () => {
  it("keeps values inside 0..100 and rounds", () => {
    expect(clampScore(-20)).toBe(0);
    expect(clampScore(140)).toBe(100);
    expect(clampScore(55.4)).toBe(55);
    expect(clampScore(Number.NaN)).toBe(0);
  });

  it("never lets a huge pile of signals exceed 100", () => {
    const signals: Signal[] = [];
    for (const id of ["cta.direct", "cta.coupon", "link.affiliate-params", "workflow.only-product-linked", "disclosure.creator", "story.problem-product-success"]) {
      signals.push(makeSignal(id));
    }
    const r = scoreSignals(signals, basePost);
    expect(r.promoLikelihood).toBeLessThanOrEqual(100);
    expect(r.promoLikelihood).toBeGreaterThanOrEqual(0);
  });
});

describe("category caps", () => {
  it("five marketing phrases alone cannot produce a high score", () => {
    const signals = [
      makeSignal("lang.hype-phrases"),
      makeSignal("lang.transformation"),
      makeSignal("lang.feature-focus"),
      makeSignal("lang.sales-page-format"),
      makeSignal("lang.slogans"),
      makeSignal("lang.unsupported-performance"),
      makeSignal("lang.pricing-details"),
    ];
    const { score, perCategory } = computePromoScore(signals);
    expect(perCategory["marketing-language"]).toBeLessThanOrEqual(15);
    expect(score).toBeLessThan(40);
  });

  it("style-only evidence (narrative + language) is capped below 'likely promotional'", () => {
    const signals = [
      makeSignal("story.problem-product-success"),
      makeSignal("story.emotional-intro"),
      makeSignal("story.solves-everything"),
      makeSignal("story.testimonial"),
      makeSignal("story.result-title-tool-body"),
      makeSignal("lang.hype-phrases"),
      makeSignal("lang.feature-focus"),
      makeSignal("lang.pricing-details"),
      makeSignal("lang.search-title"),
    ];
    const { score } = computePromoScore(signals);
    expect(score).toBeLessThanOrEqual(STYLE_ONLY_CAP);
  });

  it("discounts correlated signals instead of double counting", () => {
    const one = computePromoScore([makeSignal("cta.dm-request", { weight: 20 })]).score;
    const both = computePromoScore([makeSignal("cta.dm-request", { weight: 20 }), makeSignal("cta.comment-interested")]).score;
    expect(both).toBeGreaterThan(one);
    expect(both).toBeLessThan(one + 20); // second one counts at a discount
  });
});

describe("counter-signals", () => {
  it("lower the score", () => {
    const withPromo = [makeSignal("cta.direct"), makeSignal("link.product-link")];
    const before = computePromoScore(withPromo).score;
    const after = computePromoScore([...withPromo, makeSignal("counter.limitations"), makeSignal("counter.compares-alternatives")]).score;
    expect(after).toBeLessThan(before);
  });

  it("cannot push the score below zero", () => {
    const { score } = computePromoScore([makeSignal("counter.limitations"), makeSignal("counter.useful-no-links"), makeSignal("counter.no-cta")]);
    expect(score).toBe(0);
  });
});

describe("disclosure", () => {
  it("clear self-disclosure yields clear disclosure, low undisclosed risk, and a high promotional score", () => {
    const r = analyzePost({
      title: "I built a small tool for tracking habits",
      body: "I'm the founder of HabitLoop. You can try it at https://habitloop.app - feedback welcome. Known limitation: no Android app yet.",
      author: "habitloop_dev",
    });
    expect(r.disclosure).toBe("clear");
    expect(r.undisclosedRisk).toBe("low");
    expect(r.promoLikelihood).toBeGreaterThanOrEqual(80);
    expect(r.confidence).toBe("high");
  });

  it("a transparent founder asking for advice without links or asks stays below the confirmed-promotion floor", () => {
    const r = analyzePost({
      title: "Got into the app store. Now what? Technical founder, no idea how to get users.",
      body:
        "Six months ago I started building a tool for myself. That turned into CallBuddy, a desktop app from my company. " +
        "It passed store certification this week. It runs locally, never auto-suggests, and stays invisible in screen shares. " +
        "Now the honest part: I have no audience. The app is live, free during early access, one-click install from the store. " +
        "People who've done this before: where did your first 100 users actually come from? What would you do this week with no budget?",
      subreddit: "SaaS",
    });
    expect(r.disclosure).toBe("clear");
    expect(r.promoLikelihood).toBeLessThan(80);
    expect(r.promoLikelihood).toBeGreaterThanOrEqual(30);
    expect(r.signals.some((s) => s.id === "cta.direct")).toBe(false);
    expect(r.signals.some((s) => s.id === "cta.coupon")).toBe(false);
  });

  it("promotion without any disclosure is reported as missing", () => {
    const r = analyzePost({
      title: "Best tool for managing invoices in 2026",
      body: "Just use InvoiceZap, sign up here https://invoicezap.io/?ref=abc123 and use code SAVE20. It's a game changer, highly recommend.",
    });
    expect(r.disclosure).toBe("missing");
    expect(r.promoLikelihood).toBeGreaterThanOrEqual(60);
    expect(r.undisclosedRisk).toBe("high");
  });

  it("vague connection language yields unclear disclosure", () => {
    const r = analyzePost({
      title: "A little something I have been working on",
      body: "Something I have been working on for a while: NoteBeam. Sign up at https://notebeam.app to get early access.",
    });
    expect(r.disclosure).toBe("unclear");
  });

  it("an organic post with one incidental product mention has nothing to disclose", () => {
    const r = analyzePost({
      title: "How do you structure a monorepo?",
      body: "We keep everything on GitHub and use Closed for issue tracking alongside it. Curious how others split packages; no links, just asking.",
    });
    expect(r.promoLikelihood).toBeLessThan(20);
    expect(r.disclosure).toBe("unknown");
  });

  it("no product and no promotion yields unknown disclosure", () => {
    const r = analyzePost({ title: "How do you deal with burnout?", body: "Genuinely asking. Nothing seems to help lately." });
    expect(r.disclosure).toBe("unknown");
  });
});

describe("reach stays separate from promotion", () => {
  it("high upvotes alone do not increase promotional likelihood", () => {
    const quiet = analyzePost({ title: "PSA about library cards", body: "Your library card gives free access to a lot. Check your local site.", upvotes: 3, commentsCount: 1, ageHours: 5 });
    const viral = analyzePost({ title: "PSA about library cards", body: "Your library card gives free access to a lot. Check your local site.", upvotes: 24000, commentsCount: 1300, ageHours: 5 });
    expect(viral.promoLikelihood).toBe(quiet.promoLikelihood);
    expect(viral.reach.level).toBe("high");
    expect(quiet.reach.level).toBe("low");
  });

  it("reach signals carry zero promotion weight", () => {
    const r = analyzePost({ ...basePost, upvotes: 50000, commentsCount: 9000, ageHours: 1 });
    for (const s of r.signals.filter((x) => x.category === "engagement")) expect(s.weight).toBe(0);
  });

  it("explains reach with visible numbers", () => {
    const reach = computeReach({ title: "x", upvotes: 2400, commentsCount: 184, ageHours: 3 });
    expect(reach.level).toBe("high");
    expect(reach.explanation).toContain("2,400 upvotes");
    expect(reach.explanation).toContain("184 comments");
  });
});

describe("comment accusations", () => {
  const post: PostInput = {
    title: "This budgeting app finally helped me",
    body: "PennyPath is simple. There is a free version. It doesn't sync with every bank though which is annoying.",
    author: "saver_jane",
    isDetailPage: true,
  };

  it("one unsupported 'this is an ad' comment adds at most +2", () => {
    const r = analyzePost({ ...post, visibleComments: [{ author: "skeptic1", text: "this is an ad" }] });
    const acc = r.signals.find((s) => s.id === "community.single-accusation");
    expect(acc).toBeDefined();
    expect(acc!.weight).toBeLessThanOrEqual(2);
    expect(r.promoLikelihood).toBeLessThan(20);
  });

  it("several independent concerns become medium evidence", () => {
    const r = analyzePost({
      ...post,
      visibleComments: [
        { author: "a", text: "Feels like an undisclosed ad to me, honestly." },
        { author: "b", text: "OP is clearly promoting their own app, check the history." },
        { author: "c", text: "What features does it have?" },
      ],
    });
    expect(r.signals.some((s) => s.id === "community.several-independent-concerns")).toBe(true);
    expect(r.signals.some((s) => s.id === "community.single-accusation")).toBe(false);
  });

  it("copied accusations add no points and lower confidence", () => {
    const text = "This is obviously an ad, OP is a shill for this app, downvote and report.";
    const r = analyzePost({
      ...post,
      visibleComments: [
        { author: "a", text },
        { author: "b", text },
        { author: "c", text: text + "!" },
      ],
    });
    expect(r.signals.some((s) => s.id === "community.coordinated-accusations")).toBe(true);
    expect(r.signals.some((s) => s.id === "community.several-independent-concerns")).toBe(false);
    expect(r.confidence).toBe("low");
  });

  it("a linked earlier post counts only at the unverified discount", () => {
    const r = analyzePost({
      ...post,
      visibleComments: [{ author: "a", text: "Same post as https://www.reddit.com/r/frugal/comments/abc123/same_story/ last week, this is an ad" }],
    });
    const linked = r.signals.find((s) => s.id === "community.linked-identical-post");
    expect(linked).toBeDefined();
    expect(linked!.verified).toBe(false);
    expect(r.promoLikelihood).toBeLessThan(40);
  });

  it("author admission in comments confirms promotion but disclosure stays unclear", () => {
    const r = analyzePost({
      ...post,
      body: "PennyPath is simple. Sign up at https://pennypath.app to get started.",
      visibleComments: [
        { author: "user2", text: "Do you work for them?" },
        { author: "saver_jane", text: "Yes, full disclosure: I'm the founder of PennyPath." },
      ],
    });
    expect(r.signals.some((s) => s.id === "community.author-admission")).toBe(true);
    expect(r.disclosure).toBe("unclear");
    expect(r.promoLikelihood).toBeGreaterThanOrEqual(80);
  });
});

describe("confidence", () => {
  it("is low when only weak post text is available", () => {
    const r = analyzePost({ title: "Thoughts on standing desks?", body: "Considering one. Any advice?" });
    expect(r.confidence).toBe("low");
  });

  it("does not reach high without a verified very strong signal on a feed post", () => {
    const r = analyzePost({
      title: "How I 10x'd my output",
      body: "This tool changed everything, game changer, must-have. Highly recommend. Sign up today at https://tool-x.io",
    });
    expect(["low", "medium"]).toContain(r.confidence);
  });
});

describe("reasons", () => {
  it("returns at most three human-readable reasons", () => {
    const r = analyzePost({
      title: "Best CRM for freelancers",
      body: "Use code FREE20 at https://crmzip.io/?ref=me, DM me for the template. Comment 'interested' and I'll send it. Game changer.",
    });
    expect(r.reasons.length).toBeLessThanOrEqual(3);
    expect(r.reasons.length).toBeGreaterThan(0);
    for (const reason of r.reasons) expect(typeof reason).toBe("string");
  });
});
