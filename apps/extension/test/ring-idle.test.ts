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
