/**
 * Content script entry point (runs on https://www.reddit.com/*).
 *
 * PromoLens is on-demand and post-page only:
 *   - Feed pages: nothing is injected and nothing is analysed.
 *   - Post pages (/r/<sub>/comments/<id>/...): one PromoLens button appears
 *     beside the title in the idle state. Clicking it (or Enter/Space) runs
 *     the analysis on the full visible post + comments: local rules first
 *     (instant), then, if "deeper analysis" is enabled, the local API with
 *     the language-model witness. Nothing is sent anywhere until the user
 *     clicks.
 *
 * Reddit is a single-page app, so we also watch for client-side navigation
 * and re-attach the button when a new post page is opened.
 */
import { loadSettings, onSettingsChanged, type Settings } from "../shared/settings.js";
import { findDetailPostElement, findPostElements, isDetailPage } from "../reddit/adapter.js";
import { getPopover } from "../ui/popover.js";
import { analyzeRecord, clearPageCache } from "./analysis.js";
import { TaskQueue } from "./queue.js";
import { PostScanner, type PostRecord } from "./scanner.js";
import { debug } from "./debug.js";

class PromoLens {
  private settings: Settings;
  private readonly queue = new TaskQueue(1);
  private readonly scanner: PostScanner;
  private lastUrl = location.href;
  private navTimer: number | undefined;

  constructor(settings: Settings) {
    this.settings = settings;
    this.scanner = new PostScanner(
      {
        onNearViewport: () => undefined, // never auto-analyse
        onLeftViewport: () => undefined,
        onRemoved: (record) => this.queue.cancel(record.key),
        onActivate: (record) => this.analyse(record),
      },
      {
        observeViewport: false,
        // Post page: only the main post. Feeds: every card, if enabled - a
        // click fetches that post in the background; nothing is auto-analysed.
        select: (root) => {
          if (isDetailPage(location.href)) {
            const el = findDetailPostElement(root, location.href);
            return el ? [el] : [];
          }
          if (!this.settings.feedEnabled) return [];
          return findPostElements(root).filter((el) => !el.querySelector('h1[slot="title"]'));
        },
      },
    );
  }

  start(): void {
    if (!this.settings.enabled) return;
    this.scanner.start();
    this.watchNavigation();
  }

  stop(): void {
    this.queue.cancelAll();
    this.scanner.stop();
    getPopover().hide();
    if (this.navTimer !== undefined) window.clearInterval(this.navTimer);
    this.navTimer = undefined;
  }

  applySettings(next: Settings): void {
    const wasEnabled = this.settings.enabled;
    const apiChanged = next.aiProvider !== this.settings.aiProvider || next.apiBaseUrl !== this.settings.apiBaseUrl;
    const feedChanged = next.feedEnabled !== this.settings.feedEnabled;
    this.settings = next;
    if (wasEnabled && !next.enabled) this.stop();
    else if (!wasEnabled && next.enabled) this.start();
    else if (next.enabled && feedChanged && !isDetailPage(location.href)) {
      this.queue.cancelAll();
      this.scanner.clear();
      this.scanner.scheduleScan();
    } else if (next.enabled && apiChanged) {
      // Forget page-level results so the next click reflects the new setting.
      clearPageCache();
      for (const record of this.scanner.getRecords()) {
        if (record.status === "done" || record.status === "error") {
          record.status = "pending";
          record.ring.setIdle();
        }
      }
    }
  }

  /** User clicked the button: analyse this post now. */
  private analyse(record: PostRecord): void {
    if (record.status === "queued" || record.status === "analyzing") return;
    if (record.status === "done" && record.ring.result) return; // ring handles showing the result
    record.status = "queued";
    debug("analyse requested", record.key, { provider: this.settings.aiProvider });
    this.queue.enqueue(record.key, (token) => analyzeRecord(record, this.settings, token), 0);
  }

  /** Reddit is a single-page app: watch for URL changes without reloads. */
  private watchNavigation(): void {
    const check = () => {
      if (location.href === this.lastUrl) return;
      this.lastUrl = location.href;
      getPopover().hide();
      this.queue.cancelAll();
      this.scanner.sweep();
      // Leaving a post page: drop its button. Entering one: attach.
      if (!isDetailPage(location.href)) this.scanner.clear();
      this.scanner.scheduleScan();
    };
    window.addEventListener("popstate", check);
    this.navTimer = window.setInterval(check, 500);
  }
}

async function main(): Promise<void> {
  if (window.top !== window) return; // ignore iframes
  const settings = await loadSettings();
  debug("starting", { enabled: settings.enabled, provider: settings.aiProvider, url: location.pathname });
  const app = new PromoLens(settings);
  app.start();
  onSettingsChanged((next) => app.applySettings(next));
}

void main();
