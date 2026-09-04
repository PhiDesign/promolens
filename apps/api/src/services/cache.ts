/**
 * Content-hash cache interface.
 *
 * The key is a hash of the analysed content, never the content itself, so the
 * cache holds only results plus a hash. The in-memory implementation is the
 * default; a persistent store can implement the same interface later.
 */
import type { AnalysisResult } from "@promolens/shared";

export interface CacheEntry {
  result: AnalysisResult;
  storedAt: number;
  expiresAt: number;
}

export interface ContentHashCache {
  get(hash: string): Promise<CacheEntry | undefined>;
  set(hash: string, result: AnalysisResult, ttlMs: number): Promise<void>;
  delete(hash: string): Promise<void>;
  clear(): Promise<void>;
  size(): Promise<number>;
}

export class MemoryCache implements ContentHashCache {
  private readonly map = new Map<string, CacheEntry>();

  constructor(
    private readonly maxEntries: number = 5_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async get(hash: string): Promise<CacheEntry | undefined> {
    const entry = this.map.get(hash);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.map.delete(hash);
      return undefined;
    }
    return entry;
  }

  async set(hash: string, result: AnalysisResult, ttlMs: number): Promise<void> {
    const t = this.now();
    this.map.delete(hash); // re-insert so Map order approximates LRU
    this.map.set(hash, { result, storedAt: t, expiresAt: t + ttlMs });
    if (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  async delete(hash: string): Promise<void> {
    this.map.delete(hash);
  }

  async clear(): Promise<void> {
    this.map.clear();
  }

  async size(): Promise<number> {
    return this.map.size;
  }
}
