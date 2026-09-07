import { describe, expect, it } from "vitest";
import { accessibleSummary, analyzePost, verdictFor, type AuthorHistory } from "../src/index.js";

describe("verdictFor", () => {
  it("organic advice looks organic", () => {
    const r = analyzePost({ title: "How I fixed my sleep", body: "Consistent wake time, no caffeine after noon, blackout curtains. Melatonin did nothing for me. Talk to a doctor if it persists." });
    const v = verdictFor(r);
    expect(v.kind).toBe("organic");
    expect(v.technique).toBeUndefined();
  });

  it("a disclosed founder post is transparent promotion", () => {
    const r = analyzePost({ title: "I built a habit tracker", body: "I'm the founder of HabitLoop. Try it at https://habitloop.app. No Android app yet.", links: ["https://habitloop.app"] });
    expect(verdictFor(r).kind).toBe("transparent");
    expect(verdictFor(r).headline).toBe("Transparent promotion");
  });

  it("an undisclosed workflow post names the workflow technique", () => {
    const r = analyzePost({
      title: "My exact content workflow that took me from 0 to 50k views",
      body: "Step 1: Google Trends. Step 2: Notion. Step 3: run it through Rankforge (https://rankforge.io/?ref=maya) which changed everything. Step 4: WordPress. Rankforge is the part I would not skip.",
      links: ["https://rankforge.io/?ref=maya"],
    });
    const v = verdictFor(r);
    expect(v.kind).toBe("undisclosed");
    expect(v.headline).toBe("Possible undisclosed promotion");
    expect(v.technique).toMatch(/^Presented as a workflow/);
  });

  it("a grateful-user story with a link names the story technique", () => {
    const r = analyzePost({
      title: "How I got through quitting competitive rowing",
      body: "An injury ended my rowing career and I struggled badly afterwards for two years. What finally helped was a small app a friend showed me. I used it daily. If you are going through it: https://rowmindapp.com - the code ATHLETE20 still works I think.",
      links: ["https://rowmindapp.com"],
    });
    const v = verdictFor(r);
    expect(v.kind).toBe("undisclosed");
    expect(v.technique).toMatch(/personal story/);
  });

  it("a connection found in history but not in the post is called out first", () => {
    const history: AuthorHistory = {
      author: "maya",
      fetchedAt: Date.now(),
      available: true,
      submissions: [
        { subreddit: "Entrepreneur", title: "We built Rankforge", excerpt: "I'm the founder of Rankforge." },
        { subreddit: "SEO", title: "Rankforge fixed my intent", domain: "rankforge.io", url: "https://rankforge.io" },
        { subreddit: "blogging", title: "Rankforge for writers", domain: "rankforge.io", url: "https://rankforge.io/w" },
      ],
      comments: [],
    };
    const r = analyzePost({
      title: "My exact content workflow",
      body: "Step 1: Google Trends. Step 2: Notion. Step 3: Rankforge (https://rankforge.io) which changed everything. Step 4: WordPress.",
      links: ["https://rankforge.io"],
      authorHistory: history,
    });
    const v = verdictFor(r);
    expect(v.kind).toBe("undisclosed");
    expect(v.hiddenConnection).toBe(true);
    expect(v.technique).toMatch(/^Elsewhere the author describes this as their own product; this post does not say so\./);
    expect(v.technique).toMatch(/recurs in the author's other recent posts/);
    expect(accessibleSummary(r)).toMatch(/^PromoLens: Possible undisclosed promotion\. Elsewhere the author/);
  });

  it("a founder story that names 'we built X' is transparent, even when history shows the product elsewhere", () => {
    const history: AuthorHistory = {
      author: "otta",
      fetchedAt: Date.now(),
      available: true,
      submissions: [
        { subreddit: "dropshipping", title: "QuickDesign for stores", excerpt: "We built QuickDesign, our own tool." },
        { subreddit: "microsaas", title: "QuickDesign update" },
        { subreddit: "facebookads", title: "Made this with QuickDesign" },
      ],
      comments: [],
    };
    const r = analyzePost({
      title: "Just keep building. Don't give up. 1 year success story",
      body:
        "A year ago, we built QuickDesign just for our own e-commerce brands. This week it ended up at one of the biggest e-commerce summits. " +
        "Most projects don't look impressive in the beginning. QuickDesign started as a tool we built to solve our own problem. A year later we're showcasing it. Keep going. Keep shipping.",
      authorHistory: history,
    });
    const v = verdictFor(r);
    expect(r.disclosure).toBe("clear");
    expect(v.kind).toBe("transparent");
    expect(v.hiddenConnection).toBe(false);
    expect(v.technique ?? "").not.toMatch(/does not say so/);
  });

  it("vague connection wording gives the unclear verdict", () => {
    const r = analyzePost({ title: "Something I have been working on", body: "Something I have been working on: NoteBeam. Sign up at https://notebeam.app to get early access.", links: ["https://notebeam.app"] });
    expect(verdictFor(r).kind).toBe("unclear");
  });

  it("never uses accusatory nouns", () => {
    for (const body of ["Buy now at https://x.app, use code SAVE20, DM me for the template!", "Honest review: game changer, https://www.amazon.com/dp/B0?tag=me-20"]) {
      const v = verdictFor(analyzePost({ title: "t", body }));
      expect(`${v.headline} ${v.technique ?? ""}`).not.toMatch(/spam|shill|scam|liar|marketer/i);
    }
  });
});
