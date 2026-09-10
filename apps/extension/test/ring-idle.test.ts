// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { analyzePost } from "@promolens/shared";
import { createRing } from "../src/ui/ring.js";

describe("ring on-demand mode", () => {
  it("starts idle when an activation handler is given and calls it on click", () => {
    const onActivate = vi.fn();
    const ring = createRing(document, { onActivate });
    document.body.appendChild(ring.host);
    expect(ring.state).toBe("idle");
    expect(ring.button.getAttribute("aria-label")).toMatch(/analyse this post/i);
    ring.button.click();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("starts analysing without a handler (legacy automatic mode)", () => {
    const ring = createRing(document);
    expect(ring.state).toBe("analyzing");
  });

  it("after a result, click pins the popover instead of re-activating", () => {
    const onActivate = vi.fn();
    const ring = createRing(document, { onActivate });
    document.body.appendChild(ring.host);
    ring.setResult(analyzePost({ title: "t", body: "b" }));
    ring.button.click();
    expect(onActivate).not.toHaveBeenCalled();
    expect(ring.button.getAttribute("aria-expanded")).toBe("true");
  });

  it("an error ring can be retried by clicking", () => {
    const onActivate = vi.fn();
    const ring = createRing(document, { onActivate });
    document.body.appendChild(ring.host);
    ring.setAnalyzing();
    ring.setError();
    expect(ring.button.getAttribute("aria-label")).toMatch(/try again/i);
    ring.button.click();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});

describe("ring notice state (out of included analyses)", () => {
  it("shows a gray '!' ring, a message card with a link on hover, and still retries on click", () => {
    const doc = document;
    let activated = 0;
    const ring = createRing(doc, { onActivate: () => activated++ });
    doc.body.appendChild(ring.host);
    ring.setNotice("Included analyses used up", ["Free analyses are used up.", { text: "Upgrade", href: "https://example.test/buy" }], "PromoLens: out of analyses");
    expect(ring.state).toBe("error");
    expect(ring.host.shadowRoot?.querySelector(".num")?.textContent).toBe("!");
    expect(ring.button.getAttribute("aria-label")).toMatch(/out of analyses. Press to try again/);
    ring.button.dispatchEvent(new MouseEvent("mouseenter"));
    const card = doc.querySelector("promolens-popover")?.shadowRoot;
    expect(card?.textContent).toContain("Included analyses used up");
    const link = card?.querySelector("a") as HTMLAnchorElement | null;
    expect(link?.href).toBe("https://example.test/buy");
    expect(link?.target).toBe("_blank");
    ring.button.click();
    expect(activated).toBe(1);
    ring.destroy();
  });
});
