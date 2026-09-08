import { describe, expect, it } from "vitest";
import { detectAll, type PostInput } from "../src/index.js";

function ids(post: PostInput): string[] {
  return detectAll(post).signals.map((s) => s.id);
}

describe("direct promotional detectors", () => {
  it("detects calls to buy / register / download / subscribe / book", () => {
    expect(ids({ title: "New app", body: "Download it today and sign up for the newsletter." })).toContain("cta.direct");
    expect(ids({ title: "Demo", body: "Book a demo with our team." })).toContain("cta.direct");
  });

  it("does not treat descriptions as calls to action", () => {
    expect(ids({ title: "x", body: "The app is live, one-click install from the Store, and it works." })).not.toContain("cta.direct");
    expect(ids({ title: "x", body: "People who download it usually keep it." })).not.toContain("cta.direct");
    expect(ids({ title: "x", body: "You can download it here: https://example.app" })).toContain("cta.direct");
    expect(ids({ title: "x", body: "Install it, it's free." })).toContain("cta.direct");
  });

  it("does not treat a question about first users as a coupon", () => {
    expect(ids({ title: "x", body: "Where did your first 100 users actually come from?" })).not.toContain("cta.coupon");
    expect(ids({ title: "x", body: "The first 100 users get lifetime access." })).toContain("cta.coupon");
  });

  it("only counts early access when readers are invited to join", () => {
    expect(ids({ title: "x", body: "It's free during early access." })).not.toContain("cta.waitlist");
    expect(ids({ title: "x", body: "Sign up for early access at our site." })).toContain("cta.waitlist");
  });

  it("detects waitlists", () => {
    expect(ids({ title: "Launching soon", body: "Join the waitlist for early access." })).toContain("cta.waitlist");
  });

  it("detects coupon and referral language", () => {
    const found = ids({ title: "Deal", body: "Use code SAVE20 for 20% off, limited time." });
    expect(found).toContain("cta.coupon");
  });

  it("detects affiliate and tracking URL parameters", () => {
    expect(ids({ title: "Look", body: "https://shop.example.com/product?ref=jane42" })).toContain("link.affiliate-params");
    expect(ids({ title: "Look", body: "https://www.amazon.com/dp/B000?tag=jane-20" })).toContain("link.affiliate-params");
    expect(ids({ title: "Look", body: "https://docs.example.com/guide?page=2" })).not.toContain("link.affiliate-params");
  });

  it("detects redirect / tracking domains", () => {
    expect(ids({ title: "Look", body: "https://bit.ly/3abcXYZ" })).toContain("link.redirect-tracking");
  });

  it("detects requests to DM", () => {
    expect(ids({ title: "Template", body: "DM me for the template." })).toContain("cta.dm-request");
    expect(ids({ title: "Template", body: "Comment interested and I'll DM you." })).toContain("cta.dm-request");
  });

  it("detects 'comment interested'", () => {
    expect(ids({ title: "Access", body: "Comment 'interested' below to get access." })).toContain("cta.comment-interested");
  });

  it("detects product links but ignores Reddit and general-purpose hosts", () => {
    expect(ids({ title: "Tool", body: "Check https://coolapp.io" })).toContain("link.product-link");
    expect(ids({ title: "Tool", body: "See https://www.reddit.com/r/foo and https://en.wikipedia.org/wiki/Thing" })).not.toContain("link.product-link");
  });
});

describe("product name candidates", () => {
  it("keeps multi-word names whole and does not count their parts separately", () => {
    const { context } = detectAll({
      title: "Got into the Microsoft Store. Now what?",
      body: "That turned into Advisory Guide, a Windows app. Tensor Space (my company) got into the NVIDIA Inception program. Advisory Guide passed certification this week.",
    });
    expect(context.names.get("Advisory Guide")).toBe(2);
    expect(context.names.has("Advisory")).toBe(false);
    expect(context.names.has("Guide")).toBe(false);
    expect(context.names.get("Tensor Space")).toBe(1);
    expect(context.primaryProduct).toBe("Advisory Guide");
  });

  it("still finds single-word and CamelCase names", () => {
    const { context } = detectAll({ title: "x", body: "I switched to Rankforge last month. Rankforge and NotionAI both work." });
    expect(context.names.get("Rankforge")).toBe(2);
    expect(context.names.get("NotionAI")).toBeGreaterThanOrEqual(1);
  });
});

describe("narrative and workflow detectors", () => {
  it("detects repeated product naming", () => {
    const body = "Zentrack is great. Zentrack does X. Zentrack does Y. With Zentrack you get Z. Zentrack again. Zentrack forever.";
    const found = ids({ title: "Zentrack review", body });
    expect(found.some((id) => id === "story.name-repeated" || id === "lang.seo-name-repetition")).toBe(true);
  });

  it("detects a problem -> product -> success story", () => {
    const body =
      "For two years I struggled with my inbox and was completely overwhelmed. Then a friend recommended MailZen and I started using it. " +
      "Within days everything was organised. Now I hit inbox zero daily and saved me hours every week. Finally free. Try it at https://mailzen.app";
    expect(ids({ title: "How I fixed my inbox", body })).toContain("story.problem-product-success");
  });

  it("detects the arc when the resolution is stated before the product and the product is only a link", () => {
    const body =
      "An injury ended my career and I struggled badly afterwards for two years. What finally helped was a small app a friend showed me. " +
      "I used it daily and it walks you through everything. If you are going through it: https://rowmindapp.com - hope it helps someone.";
    expect(ids({ title: "How I got through it", body, links: ["https://rowmindapp.com"] })).toContain("story.problem-product-success");
  });

  it("detects a product inserted into a workflow next to familiar tools", () => {
    const body =
      "Step 1: research in Semrush.\nStep 2: outline with ChatGPT.\nStep 3: run it through Rankforge (https://rankforge.io) which is the key part. " +
      "Rankforge fixes intent. Rankforge adds links. Rankforge is what made all the difference.\nStep 4: publish on WordPress.";
    const found = ids({ title: "My SEO workflow", body });
    expect(found).toContain("workflow.obscure-among-familiar");
    expect(found).toContain("workflow.only-product-linked");
    expect(found).toContain("workflow.more-detail");
    expect(found).toContain("workflow.success-attributed");
    expect(found).toContain("workflow.no-relationship-disclosed");
  });

  it("detects marketing and testimonial language", () => {
    const found = ids({ title: "Wow", body: "This is a game changer, must-have, revolutionary. Highly recommend, worth every penny. It changed everything." });
    expect(found).toContain("lang.hype-phrases");
    expect(found).toContain("lang.transformation");
    expect(found).toContain("story.testimonial");
  });
});

describe("disclosure detectors", () => {
  it("detects clear creator / employee / affiliate / paid disclosures", () => {
    expect(ids({ title: "x", body: "I built this over the weekend." })).toContain("disclosure.creator");
    expect(ids({ title: "x", body: "Disclosure: I work for the company that makes it." })).toContain("disclosure.employment");
    expect(ids({ title: "x", body: "This is an affiliate link and I earn a small commission." })).toContain("disclosure.affiliate");
    expect(ids({ title: "x", body: "I received this for free from the brand for review." })).toContain("disclosure.material-benefit");
  });

  it("detects creator disclosure phrased as 'built the tool I needed' or long-term work on it", () => {
    expect(ids({ title: "How I quit rowing, then built the tool I needed", body: "x" })).toContain("disclosure.creator");
    expect(ids({ title: "x", body: "We've been working on it daily for two years." })).toContain("disclosure.creator");
    expect(ids({ title: "x", body: "And then it turned into a project." })).toContain("disclosure.creator");
  });

  it("recognises 'we built <ProductName>' and 'a tool we built' as creator disclosure", () => {
    expect(ids({ title: "Just keep building", body: "A year ago, we built QuickDesign just for our own e-commerce brands." })).toContain("disclosure.creator");
    expect(ids({ title: "x", body: "QuickDesign started as a tool we built to solve our own problem." })).toContain("disclosure.creator");
    expect(ids({ title: "x", body: "I created a local STT tool called Mumbleflow." })).toContain("disclosure.creator");
  });

  it("a bare 'my SaaS' in a post that promotes no product is not a disclosure", () => {
    const asking = ids({ title: "What AI tool can I use to make demo videos?", body: "I need a short launch video for my SaaS, but it has to show the real product UI. Has anyone found a tool that works?" });
    expect(asking).not.toContain("disclosure.creator");
    // ...but with a named product it still counts
    expect(ids({ title: "x", body: "CallBuddy is a desktop app from my company. It is live now." })).toContain("disclosure.creator");
  });

  it("detects employment disclosure with an indefinite article", () => {
    expect(ids({ title: "x", body: "Disclosure: I work for a company that makes a spreadsheet tool." })).toContain("disclosure.employment");
  });

  it("detects an uppercase promo code even without 'use code'", () => {
    expect(ids({ title: "x", body: "the code ATHLETE20 still works I think" })).toContain("cta.coupon");
    expect(ids({ title: "x", body: "I refactored the code yesterday" })).not.toContain("cta.coupon");
  });

  it("treats 'here is the one I got: <link>' as a purchase pointer", () => {
    expect(ids({ title: "x", body: "Here is the one I got: https://www.amazon.com/dp/B0EXAMPLE?tag=deskguy-20" })).toContain("cta.direct");
  });

  it("detects weak or unclear disclosure language", () => {
    expect(ids({ title: "x", body: "Something I have been working on lately." })).toContain("disclosure.unclear-working-on");
    expect(ids({ title: "x", body: "A project I'm involved with just launched." })).toContain("disclosure.unclear-involved");
    expect(ids({ title: "x", body: "A friend of mine built this app." })).toContain("disclosure.friends-product");
  });

  it("uses the Brand Affiliate label when present", () => {
    expect(ids({ title: "x", body: "Check it out", brandAffiliateLabel: true })).toContain("disclosure.brand-affiliate-label");
  });
});

describe("counter-signal detectors", () => {
  it("detects limitations and balanced alternatives", () => {
    const body =
      "I compared Notion, Obsidian and Logseq for six months. Notion is polished but the offline mode is a drawback. Obsidian is fast but the learning curve is steep. " +
      "Logseq is free but buggy at times. Depends on your needs; there are pros and cons to each.";
    const found = ids({ title: "Notion vs Obsidian vs Logseq", body });
    expect(found).toContain("counter.limitations");
    expect(found).toContain("counter.compares-alternatives");
  });

  it("detects useful posts with no links and no call to action", () => {
    const body = Array(25).fill("Here is a genuinely useful tip about sleep hygiene and consistent wake times.").join(" ");
    const found = ids({ title: "Sleep tips", body });
    expect(found).toContain("counter.useful-no-links");
    expect(found).toContain("counter.no-cta");
  });
});

describe("availability notes", () => {
  it("always records that profile history was unavailable", () => {
    expect(ids({ title: "x" })).toContain("availability.profile-history-unavailable");
  });
  it("records missing comments on feed posts only", () => {
    expect(ids({ title: "x", body: "y" })).toContain("availability.comments-unavailable");
    expect(ids({ title: "x", body: "y", isDetailPage: true, visibleComments: [] })).not.toContain("availability.comments-unavailable");
  });
});
