/**
 * Finds Reddit posts, attaches a ring to each exactly once, and reports when a
 * post comes near the viewport (so it should be analysed) or leaves the page.
 *
 * - MutationObserver (debounced) catches posts added by infinite scroll and
 *   client-side navigation.
 * - IntersectionObserver with a generous rootMargin prioritises posts that are
 *   visible or about to be.
 * - A WeakMap + a marker attribute guarantee one ring per post element.
 */
import { findPostElements, getPostKey, mountRing, PROCESSED_ATTR } from "../reddit/adapter.js";
import { createRing, type RingHandle } from "../ui/ring.js";
import { debug } from "./debug.js";

export type RecordStatus = "pending" | "queued" | "analyzing" | "done" | "error";

export interface PostRecord {
  key: string;
  el: HTMLElement;
  ring: RingHandle;
  status: RecordStatus;
  /** Content hash of the last analysed version. */
  hash?: string;
}

export interface ScannerCallbacks {
  onNearViewport(record: PostRecord): void;
  onLeftViewport(record: PostRecord): void;
  onRemoved(record: PostRecord): void;
  /** User clicked an idle ring. When set, rings start idle instead of analysing. */
  onActivate?(record: PostRecord): void;
}

export interface ScannerOptions {
  rootMargin?: string;
  debounceMs?: number;
  sweepIntervalMs?: number;
  /** Which elements get a ring. Defaults to every post on the page. */
  select?: (root: ParentNode) => HTMLElement[];
  /** Report viewport entry/exit (default true). Off for on-demand mode. */
  observeViewport?: boolean;
}

export class PostScanner {
  private readonly records = new Map<HTMLElement, PostRecord>();
  private mutation: MutationObserver | null = null;
  private intersection: IntersectionObserver | null = null;
  private debounceTimer: number | undefined;
  private sweepTimer: number | undefined;
  private running = false;
  private seq = 0;

  constructor(
    private readonly callbacks: ScannerCallbacks,
    private readonly options: ScannerOptions = {},
    private readonly doc: Document = document,
  ) {}

  get size(): number {
    return this.records.size;
  }

  getRecords(): PostRecord[] {
    return [...this.records.values()];
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const view = this.doc.defaultView;

    if (this.options.observeViewport !== false && typeof IntersectionObserver !== "undefined") {
      this.intersection = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const record = this.records.get(entry.target as HTMLElement);
            if (!record) continue;
            if (entry.isIntersecting) this.callbacks.onNearViewport(record);
            else this.callbacks.onLeftViewport(record);
          }
        },
        { rootMargin: this.options.rootMargin ?? "500px 0px 700px 0px", threshold: 0 },
      );
    }

    this.mutation = new MutationObserver(() => this.scheduleScan());
    this.mutation.observe(this.doc.documentElement, { childList: true, subtree: true });

    this.sweepTimer = view?.setInterval(() => this.sweep(), this.options.sweepIntervalMs ?? 4000);
    this.scan(this.doc);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.mutation?.disconnect();
    this.mutation = null;
    this.intersection?.disconnect();
    this.intersection = null;
    const view = this.doc.defaultView;
    if (this.debounceTimer !== undefined) view?.clearTimeout(this.debounceTimer);
    if (this.sweepTimer !== undefined) view?.clearInterval(this.sweepTimer);
    for (const record of this.records.values()) {
      record.ring.destroy();
      record.el.removeAttribute(PROCESSED_ATTR);
      this.callbacks.onRemoved(record);
    }
    this.records.clear();
  }

  /** Debounced scan of the whole document (DOM changes arrive in bursts). */
  scheduleScan(): void {
    const view = this.doc.defaultView;
    if (this.debounceTimer !== undefined) view?.clearTimeout(this.debounceTimer);
    this.debounceTimer = view?.setTimeout(() => {
      this.debounceTimer = undefined;
      this.scan(this.doc);
    }, this.options.debounceMs ?? 150);
  }

  /** Register every post under `root` that does not yet have a ring. */
  scan(root: ParentNode): number {
    if (!this.running) return 0;
    let added = 0;
    const candidates = this.options.select ? this.options.select(root) : findPostElements(root);
    for (const el of candidates) {
      if (this.records.has(el) || el.hasAttribute(PROCESSED_ATTR)) continue;
      let record: PostRecord | undefined;
      const ring = createRing(
        this.doc,
        this.callbacks.onActivate ? { onActivate: () => record && this.callbacks.onActivate?.(record) } : {},
      );
      if (!mountRing(el, ring.host)) {
        ring.destroy();
        continue; // title not found; try again on the next mutation
      }
      el.setAttribute(PROCESSED_ATTR, "1");
      record = { key: `${getPostKey(el) || "post"}#${++this.seq}`, el, ring, status: "pending" };
      this.records.set(el, record);
      added++;
      debug("ring attached", record.key);
      if (this.intersection) this.intersection.observe(el);
      else if (this.options.observeViewport !== false) this.callbacks.onNearViewport(record); // no IntersectionObserver: treat as visible
    }
    return added;
  }

  /** Remove every ring but keep observing (used when leaving a post page). */
  clear(): void {
    for (const [el, record] of this.records) {
      this.intersection?.unobserve(el);
      record.ring.destroy();
      el.removeAttribute(PROCESSED_ATTR);
      this.records.delete(el);
      this.callbacks.onRemoved(record);
    }
  }

  /** Drop records whose elements were removed from the page. */
  sweep(): void {
    for (const [el, record] of this.records) {
      if (el.isConnected) continue;
      this.intersection?.unobserve(el);
      record.ring.destroy();
      this.records.delete(el);
      this.callbacks.onRemoved(record);
    }
  }
}
