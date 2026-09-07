/**
 * Result cache in chrome.storage.local, keyed by content hash.
 * Stores only the analysis result and a timestamp - never the post text.
 * The storage backend is injectable so the logic can be unit-tested.
 */
import type { AnalysisResult } from "@promolens/shared";

export interface KeyValueStore {
  get(keys: string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface CachedResult {
  result: AnalysisResult;
  storedAt: number;
}

/**
 * Worker-memory store: lives only while the service worker runs and is never
 * written to disk. Used for anything that contains post or comment text
 * (author-history summaries), so Reddit content is not retained at rest.
 */
export function memoryStore(): KeyValueStore {
  const data = new Map<string, unknown>();
  return {
    get: async (keys) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of data) if (keys === null || keys.includes(k)) out[k] = v;
      return out;
    },
    set: async (items) => {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    remove: async (keys) => {
      for (const k of keys) data.delete(k);
    },
  };
}

export const CACHE_PREFIX = "promolens:cache:";
const DEFAULT_MAX_ENTRIES = 2000;

export class ResultCache {
  private putsSincePrune = 0;

  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = () => Date.now(),
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
  ) {}

  private key(hash: string): string {
    return CACHE_PREFIX + hash;
  }

  async get(hash: string, ttlMs: number): Promise<AnalysisResult | undefined> {
    const key = this.key(hash);
    const found = await this.store.get([key]);
    const entry = found[key] as CachedResult | undefined;
    if (!entry || typeof entry.storedAt !== "number" || !entry.result) return undefined;
    if (entry.storedAt + ttlMs <= this.now()) {
      await this.store.remove([key]);
      return undefined;
    }
    return entry.result;
  }

  async put(hash: string, result: AnalysisResult, ttlMs: number): Promise<void> {
    const entry: CachedResult = { result, storedAt: this.now() };
    await this.store.set({ [this.key(hash)]: entry });
    if (++this.putsSincePrune >= 50) {
      this.putsSincePrune = 0;
      await this.prune(ttlMs);
    }
  }

  /** Remove expired entries and, if still too many, the oldest ones. */
  async prune(ttlMs: number): Promise<number> {
    const all = await this.store.get(null);
    const entries = Object.entries(all)
      .filter(([k]) => k.startsWith(CACHE_PREFIX))
      .map(([k, v]) => [k, v as CachedResult] as const);
    const t = this.now();
    const expired = entries.filter(([, v]) => !v || typeof v.storedAt !== "number" || v.storedAt + ttlMs <= t).map(([k]) => k);
    const remaining = entries.filter(([k]) => !expired.includes(k)).sort((a, b) => a[1].storedAt - b[1].storedAt);
    const overflow = remaining.length > this.maxEntries ? remaining.slice(0, remaining.length - this.maxEntries).map(([k]) => k) : [];
    const toRemove = [...expired, ...overflow];
    if (toRemove.length > 0) await this.store.remove(toRemove);
    return toRemove.length;
  }

  async clear(): Promise<number> {
    const all = await this.store.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
    if (keys.length > 0) await this.store.remove(keys);
    return keys.length;
  }
}

/** chrome.storage.local adapter. */
export function chromeLocalStore(): KeyValueStore {
  return {
    get: (keys) => chrome.storage.local.get(keys),
    set: (items) => chrome.storage.local.set(items),
    remove: (keys) => chrome.storage.local.remove(keys),
  };
}
