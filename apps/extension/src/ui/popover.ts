/**
 * One shared evidence popover for the whole page.
 *
 * It lives at the end of <body> in its own Shadow DOM and is positioned with
 * `position: fixed`, so it is never clipped by a post card's overflow and
 * never affects Reddit's layout. It shows only:
 *   the verdict (organic / transparent / unclear / undisclosed) and how the
 *   promotion is presented, then percentage + short label, confidence,
 *   disclosure, three reasons, and a note that the result is an estimate.
 */
import { confidenceLabel, disclosureLabel, ringStateFor, verdictFor, type AnalysisResult } from "@promolens/shared/light";
import { POPOVER_CSS } from "./styles.js";
import { detectTheme } from "./theme.js";

const ESTIMATE_NOTE = "This is an estimate based on observable signals.";

/** Tells the reader what produced the estimate: local rules, or rules plus a model. */
export function sourceNote(result: { source: "local" | "api"; signals: { id: string; explanation: string }[] }): string {
  if (result.source !== "api") return `Local rules only. ${ESTIMATE_NOTE}`;
  const witness = result.signals.find((s) => s.id === "api.llm-witness");
  if (witness) {
    const m = /\(([^)]+)\)/.exec(witness.explanation);
    return `Rules + language model${m ? ` (${m[1]})` : ""}. ${ESTIMATE_NOTE}`;
  }
  return `Rules via local API. ${ESTIMATE_NOTE}`;
}

export class PopoverController {
  private host: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private anchor: HTMLElement | null = null;
  private pinned = false;
  private hideTimer: number | undefined;
  private readonly onDocPointerDown = (e: Event) => {
    if (!this.host || !this.anchor) return;
    const path = e.composedPath();
    if (path.includes(this.host) || path.includes(this.anchor)) return;
    this.hide();
  };
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.anchor) {
      const a = this.anchor;
      this.hide();
      a.focus();
    }
  };
  private readonly onScrollOrResize = () => {
    if (!this.anchor) return;
    if (this.pinned) this.position();
    else this.hide();
  };

  constructor(private readonly doc: Document = document) {}

  private ensure(): HTMLElement {
    if (this.host && this.host.isConnected) return this.host;
    const host = this.doc.createElement("promolens-popover");
    host.hidden = true;
    const root = host.attachShadow({ mode: "open" });
    const style = this.doc.createElement("style");
    style.textContent = POPOVER_CSS;
    const card = this.doc.createElement("div");
    card.className = "card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "PromoLens evidence");
    card.addEventListener("mouseenter", () => this.cancelHide());
    card.addEventListener("mouseleave", () => {
      if (!this.pinned) this.scheduleHide();
    });
    root.append(style, card);
    (this.doc.body ?? this.doc.documentElement).appendChild(host);
    this.host = host;
    this.card = card;
    return host;
  }

  get isOpen(): boolean {
    return !!this.host && !this.host.hidden;
  }

  isPinnedTo(anchor: HTMLElement): boolean {
    return this.isOpen && this.pinned && this.anchor === anchor;
  }

  isShowing(anchor: HTMLElement): boolean {
    return this.isOpen && this.anchor === anchor;
  }

  show(anchor: HTMLElement, result: AnalysisResult, pinned: boolean): void {
    this.present(anchor, pinned, () => this.render(result));
  }

  /** A plain text card (used for the idle "click to analyse" hint). */
  showMessage(anchor: HTMLElement, heading: string, lines: string[], pinned: boolean): void {
    this.present(anchor, pinned, () => this.renderMessage(heading, lines));
  }

  private present(anchor: HTMLElement, pinned: boolean, paint: () => void): void {
    const host = this.ensure();
    this.cancelHide();
    if (this.anchor && this.anchor !== anchor) this.anchor.setAttribute("aria-expanded", "false");
    this.anchor = anchor;
    this.pinned = pinned;
    host.dataset.theme = detectTheme(this.doc);
    paint();
    host.hidden = false;
    anchor.setAttribute("aria-expanded", "true");
    this.position();
    this.doc.addEventListener("pointerdown", this.onDocPointerDown, true);
    this.doc.addEventListener("keydown", this.onKeyDown, true);
    this.doc.defaultView?.addEventListener("scroll", this.onScrollOrResize, { passive: true, capture: true });
    this.doc.defaultView?.addEventListener("resize", this.onScrollOrResize, { passive: true });
  }

  pin(): void {
    this.pinned = true;
    this.cancelHide();
  }

  scheduleHide(delayMs = 160): void {
    if (this.pinned) return;
    this.cancelHide();
    this.hideTimer = this.doc.defaultView?.setTimeout(() => this.hide(), delayMs);
  }

  cancelHide(): void {
    if (this.hideTimer !== undefined) {
      this.doc.defaultView?.clearTimeout(this.hideTimer);
      this.hideTimer = undefined;
    }
  }

  hide(): void {
    this.cancelHide();
    if (this.host) this.host.hidden = true;
    if (this.anchor) this.anchor.setAttribute("aria-expanded", "false");
    this.anchor = null;
    this.pinned = false;
    this.doc.removeEventListener("pointerdown", this.onDocPointerDown, true);
    this.doc.removeEventListener("keydown", this.onKeyDown, true);
    this.doc.defaultView?.removeEventListener("scroll", this.onScrollOrResize, { capture: true } as EventListenerOptions);
    this.doc.defaultView?.removeEventListener("resize", this.onScrollOrResize);
  }

  destroy(): void {
    this.hide();
    this.host?.remove();
    this.host = null;
    this.card = null;
  }

  private render(result: AnalysisResult): void {
    const card = this.card;
    if (!card) return;
    card.replaceChildren();
    card.dataset.state = ringStateFor(result);
    const verdict = verdictFor(result);

    // Verdict first: it is the line readers actually need.
    const head = el(this.doc, "div", "head");
    const dot = el(this.doc, "span", "dot verdict-dot");
    dot.setAttribute("aria-hidden", "true");
    head.append(dot, el(this.doc, "span", "verdict", verdict.headline));
    card.appendChild(head);
    if (verdict.technique) card.appendChild(el(this.doc, "p", "technique", verdict.technique));

    const score = el(this.doc, "div", "score");
    score.append(
      el(this.doc, "span", "pct", `${result.promoLikelihood}%`),
      el(this.doc, "span", "label", `${result.label} · ${confidenceLabel(result.confidence).toLowerCase()}`),
    );
    const meta = el(this.doc, "div", "meta");
    meta.append(metaLine(this.doc, disclosureLabel(result.disclosure)));

    const list = this.doc.createElement("ul");
    for (const r of result.reasons.slice(0, 3)) list.appendChild(el(this.doc, "li", "", r));

    const foot = el(this.doc, "p", "foot", sourceNote(result));
    card.append(score, meta, list, foot);
  }

  private renderMessage(heading: string, lines: string[]): void {
    const card = this.card;
    if (!card) return;
    card.replaceChildren();
    card.dataset.state = "idle";
    const head = el(this.doc, "div", "head");
    head.append(el(this.doc, "span", "label", heading));
    card.appendChild(head);
    for (const line of lines) card.appendChild(el(this.doc, "p", "meta", line));
  }

  private position(): void {
    const host = this.host;
    const card = this.card;
    const anchor = this.anchor;
    if (!host || !card || !anchor) return;
    const view = this.doc.defaultView;
    if (!view) return;
    const a = anchor.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const margin = 8;
    let top = a.bottom + 6;
    if (top + c.height > view.innerHeight - margin) top = Math.max(margin, a.top - c.height - 6);
    let left = a.left;
    if (left + c.width > view.innerWidth - margin) left = Math.max(margin, view.innerWidth - c.width - margin);
    host.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
}

function el(doc: Document, tag: string, className: string, text?: string): HTMLElement {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function metaLine(doc: Document, text: string): HTMLElement {
  const line = doc.createElement("div");
  const dot = el(doc, "span", "dot");
  dot.setAttribute("aria-hidden", "true");
  line.append(dot, el(doc, "span", "", text));
  return line;
}

let singleton: PopoverController | undefined;
export function getPopover(): PopoverController {
  if (!singleton) singleton = new PopoverController();
  return singleton;
}
