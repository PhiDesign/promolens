/**
 * Per-install analysis allowance.
 *
 * Identity is an anonymous install id the extension generates once (a UUID);
 * no account, no email. Free installs get a one-time allowance in their first
 * calendar month and a small monthly refill after that; Plus installs (valid
 * licence) get a larger monthly allowance.
 *
 * State is a small JSON file (installs are few, records are tiny). Writes are
 * debounced. Losing the file only means a few free analyses are granted again.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface PlanLimits {
  freeInitial: number;
  freeMonthly: number;
  plusMonthly: number;
}

export type PlanName = "free" | "plus";

export interface QuotaStatus {
  plan: PlanName;
  used: number;
  limit: number;
  remaining: number;
  /** ISO date when the monthly counter resets (first of next month, UTC). */
  resetsAt: string;
  /** Calendar month key, e.g. "2026-09". */
  month: string;
}

interface InstallRecord {
  firstMonth: string;
  months: Record<string, number>;
  licenseKey?: string;
  instanceId?: string;
}

interface StoreFile {
  version: 1;
  installs: Record<string, InstallRecord>;
}

export function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nextMonthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

export class QuotaStore {
  private data: StoreFile = { version: 1, installs: {} };
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly limits: PlanLimits,
    private readonly file?: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (file) this.load();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.file!, "utf8")) as StoreFile;
      if (parsed && parsed.version === 1 && parsed.installs) this.data = parsed;
    } catch {
      /* first run or unreadable: start empty */
    }
    this.prune();
  }

  /** Forget free installs with no activity in the last two months (privacy: keep nothing we do not need). */
  prune(): number {
    const now = this.now();
    const keep = new Set([monthKey(now), monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)))]);
    let removed = 0;
    for (const [id, r] of Object.entries(this.data.installs)) {
      if (r.licenseKey) continue;
      const active = Object.keys(r.months).some((m) => keep.has(m)) || keep.has(r.firstMonth);
      if (!active) {
        delete this.data.installs[id];
        removed++;
      }
    }
    if (removed) this.scheduleFlush();
    return removed;
  }

  /** Write soon, coalescing bursts. */
  private scheduleFlush(): void {
    this.dirty = true;
    if (!this.file || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, 500);
    this.flushTimer.unref?.();
  }

  flush(): void {
    if (!this.file || !this.dirty) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data));
    this.dirty = false;
  }

  private record(installId: string): InstallRecord {
    let r = this.data.installs[installId];
    if (!r) {
      r = { firstMonth: monthKey(this.now()), months: {} };
      this.data.installs[installId] = r;
      this.scheduleFlush();
    }
    return r;
  }

  private limitFor(r: InstallRecord, plan: PlanName, month: string): number {
    if (plan === "plus") return this.limits.plusMonthly;
    return month === r.firstMonth ? this.limits.freeInitial : this.limits.freeMonthly;
  }

  status(installId: string, plan: PlanName): QuotaStatus {
    const now = this.now();
    const month = monthKey(now);
    const r = this.record(installId);
    const used = r.months[month] ?? 0;
    const limit = this.limitFor(r, plan, month);
    return { plan, used, limit, remaining: Math.max(0, limit - used), resetsAt: nextMonthStart(now), month };
  }

  /** Reserve one analysis if the allowance permits. Returns the status after the attempt. */
  consume(installId: string, plan: PlanName): { allowed: boolean; status: QuotaStatus } {
    const before = this.status(installId, plan);
    if (before.remaining <= 0) return { allowed: false, status: before };
    const r = this.record(installId);
    r.months[before.month] = (r.months[before.month] ?? 0) + 1;
    // Keep the record small: drop months older than the previous one.
    for (const m of Object.keys(r.months)) if (m < before.month && m !== r.firstMonth) delete r.months[m];
    this.scheduleFlush();
    return { allowed: true, status: this.status(installId, plan) };
  }

  /** Give one back (the analysis failed on our side). */
  refund(installId: string, month: string): void {
    const r = this.data.installs[installId];
    if (!r || !r.months[month]) return;
    r.months[month] = Math.max(0, r.months[month]! - 1);
    this.scheduleFlush();
  }

  /** Remember which licence an install activated (so the key need not be sent every time). */
  attachLicense(installId: string, licenseKey: string, instanceId?: string): void {
    const r = this.record(installId);
    r.licenseKey = licenseKey;
    r.instanceId = instanceId;
    this.scheduleFlush();
  }

  detachLicense(installId: string): void {
    const r = this.record(installId);
    delete r.licenseKey;
    delete r.instanceId;
    this.scheduleFlush();
  }

  license(installId: string): { licenseKey?: string; instanceId?: string } {
    const r = this.data.installs[installId];
    return { licenseKey: r?.licenseKey, instanceId: r?.instanceId };
  }

  get size(): number {
    return Object.keys(this.data.installs).length;
  }
}

/** Anonymous install ids are UUIDs; reject anything else so the store cannot be polluted. */
export const INSTALL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
