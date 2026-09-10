/**
 * The score ring: a 22px button inside its own Shadow DOM.
 *
 * States: idle (gray outline, "?"), analyzing (gray, animated), green, blue
 * (disclosed promotion), amber (uncertain), red, error (gray).
 * Interaction: in the idle/error state, click (or Enter/Space) starts the
 * analysis via `onActivate`. With a result, hover/focus opens the popover and
 * click pins it open so touchpad and keyboard users can read it; Escape closes.
 */
import { accessibleSummary, ringStateFor, type AnalysisResult, type RingState } from "@promolens/shared/light";
import { getPopover, type MessageLine } from "./popover.js";
import { RING_CSS } from "./styles.js";
import { detectTheme } from "./theme.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const SIZE = 24;
const CENTER = SIZE / 2;
const RADIUS = 10;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface RingOptions {
  /** Called when the user activates an idle (or failed) ring. */
  onActivate?: () => void;
}

export interface RingHandle {
  readonly host: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly state: RingState;
  readonly result: AnalysisResult | undefined;
  setIdle(): void;
  setAnalyzing(): void;
  setResult(result: AnalysisResult): void;
  setError(message?: string): void;
  /** Gray "!" ring: hover shows the heading and lines, click runs the analysis again. */
  setNotice(heading: string, lines: MessageLine[], ariaLabel: string): void;
  destroy(): void;
}

export function createRing(doc: Document = document, options: RingOptions = {}): RingHandle {
  const host = doc.createElement("promolens-ring");
  host.setAttribute("data-promolens-ring", "");
  host.dataset.theme = detectTheme(doc);
  const root = host.attachShadow({ mode: "open" });

  const style = doc.createElement("style");
  style.textContent = RING_CSS;

  const button = doc.createElement("button");
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");

  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute("aria-hidden", "true");
  const track = doc.createElementNS(SVG_NS, "circle");
  track.setAttribute("class", "track");
  track.setAttribute("cx", String(CENTER));
  track.setAttribute("cy", String(CENTER));
  track.setAttribute("r", String(RADIUS));
  const arc = doc.createElementNS(SVG_NS, "circle");
  arc.setAttribute("class", "arc");
  arc.setAttribute("cx", String(CENTER));
  arc.setAttribute("cy", String(CENTER));
  arc.setAttribute("r", String(RADIUS));
  arc.setAttribute("stroke-dasharray", String(CIRCUMFERENCE));
  arc.setAttribute("stroke-dashoffset", String(CIRCUMFERENCE));
  const num = doc.createElementNS(SVG_NS, "text");
  num.setAttribute("class", "num");
  num.setAttribute("x", String(CENTER));
  num.setAttribute("y", String(CENTER));
  svg.append(track, arc, num);
  button.appendChild(svg);
  root.append(style, button);

  let state: RingState = "analyzing";
  let result: AnalysisResult | undefined;
  let notice: { heading: string; lines: MessageLine[] } | undefined;
  const popover = getPopover();

  const setState = (next: RingState) => {
    state = next;
    host.dataset.state = next;
  };

  const IDLE_LABEL = "PromoLens: analyse this post for promotional signals";
  const idleLines = () => [
    "Runs PromoLens on this post's visible text and comments.",
    "With deeper analysis on (the default), that one post is also sent to a language model for quoted evidence.",
    "Nothing is sent until you click.",
  ];

  const open = (pinned: boolean) => {
    host.dataset.theme = detectTheme(doc);
    if (notice) {
      if (pinned && popover.isPinnedTo(button)) popover.hide();
      else if (pinned || !popover.isPinnedTo(button)) popover.showMessage(button, notice.heading, notice.lines, pinned);
      return;
    }
    if (!result) {
      if (state === "idle" && !pinned && !popover.isPinnedTo(button)) {
        popover.showMessage(button, "Analyse this post", idleLines(), false);
      }
      return;
    }
    if (pinned && popover.isPinnedTo(button)) {
      popover.hide();
      return;
    }
    if (pinned) {
      popover.show(button, result, true);
    } else if (!popover.isPinnedTo(button)) {
      popover.show(button, result, false);
    }
  };

  button.addEventListener("mouseenter", () => open(false));
  button.addEventListener("mouseleave", () => popover.scheduleHide());
  button.addEventListener("focus", () => open(false));
  button.addEventListener("blur", () => {
    if (!popover.isPinnedTo(button)) popover.scheduleHide(60);
  });
  button.addEventListener("click", (e) => {
    // Do not let the click reach Reddit's title link / post card.
    e.preventDefault();
    e.stopPropagation();
    if ((state === "idle" || state === "error") && options.onActivate) {
      popover.hide();
      options.onActivate();
      return;
    }
    open(true);
  });
  // Stop pointer events from bubbling into Reddit's click handlers.
  for (const type of ["pointerdown", "mousedown", "mouseup"]) {
    button.addEventListener(type, (e) => e.stopPropagation());
  }

  const handle: RingHandle = {
    host,
    button,
    get state() {
      return state;
    },
    get result() {
      return result;
    },
    setIdle() {
      result = undefined;
      notice = undefined;
      setState("idle");
      arc.setAttribute("stroke-dashoffset", "0");
      num.textContent = "?";
      button.setAttribute("aria-label", IDLE_LABEL);
      button.removeAttribute("aria-busy");
      if (popover.isShowing(button)) popover.hide();
    },
    setAnalyzing() {
      result = undefined;
      notice = undefined;
      setState("analyzing");
      arc.setAttribute("stroke-dashoffset", String(CIRCUMFERENCE));
      num.textContent = "";
      button.setAttribute("aria-label", "PromoLens: analyzing this post");
      button.setAttribute("aria-busy", "true");
    },
    setResult(next: AnalysisResult) {
      result = next;
      notice = undefined;
      setState(ringStateFor(next));
      const fraction = Math.max(0, Math.min(100, next.promoLikelihood)) / 100;
      arc.setAttribute("stroke-dashoffset", String(CIRCUMFERENCE * (1 - fraction)));
      num.textContent = String(next.promoLikelihood);
      num.setAttribute("data-len", String(num.textContent.length)); // "100" needs a smaller face
      button.setAttribute("aria-label", accessibleSummary(next));
      button.removeAttribute("aria-busy");
      if (popover.isShowing(button)) popover.show(button, next, popover.isPinnedTo(button));
    },
    setError(message = "PromoLens: analysis unavailable for this post") {
      result = undefined;
      notice = undefined;
      setState("error");
      arc.setAttribute("stroke-dashoffset", String(CIRCUMFERENCE));
      num.textContent = "–";
      button.setAttribute("aria-label", options.onActivate ? `${message}. Press to try again` : message);
      button.removeAttribute("aria-busy");
      if (popover.isShowing(button)) popover.hide();
    },
    setNotice(heading, lines, ariaLabel) {
      result = undefined;
      notice = { heading, lines };
      setState("error");
      arc.setAttribute("stroke-dashoffset", "0");
      num.textContent = "!";
      button.setAttribute("aria-label", options.onActivate ? `${ariaLabel}. Press to try again` : ariaLabel);
      button.removeAttribute("aria-busy");
      if (popover.isShowing(button)) popover.showMessage(button, heading, lines, popover.isPinnedTo(button));
    },
    destroy() {
      if (popover.isShowing(button)) popover.hide();
      host.remove();
    },
  };
  if (options.onActivate) handle.setIdle();
  else handle.setAnalyzing();
  return handle;
}
