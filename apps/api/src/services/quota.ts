/**
 * Per-install analysis allowance, stored in a small JSON file (Node server).
 * The rules live in quotaCore.ts; this file only adds persistence.
 *
 * Installs are few and records are tiny. Writes are debounced. Losing the
 * file only means a few free analyses are granted again.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  consumeRecord,
  isIdle,
  newRecord,
  refundRecord,
  statusOf,
  type InstallRecord,
  type LicenseBinding,
  type PlanLimits,
  type PlanName,
  type QuotaBackend,
  type QuotaStatus,
} from "./quotaCore.js";

export { INSTALL_ID_RE, monthKey, type PlanLimits, type PlanName, type QuotaBackend, type QuotaStatus } from "./quotaCore.js";

interface StoreFile {
  version: 1;
  installs: Record<string, InstallRecord>;
}

export class QuotaStore implements QuotaBackend {
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

  /** Forget free installs with no activity in the last two months. */
  prune(): number {
    const now = this.now();
    let removed = 0;
    for (const [id, r] of Object.entries(this.data.installs)) {
      if (isIdle(r, now)) {
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
      r = newRecord(this.now());
      this.data.installs[installId] = r;
      this.scheduleFlush();
    }
    return r;
  }

  status(installId: string, plan: PlanName): QuotaStatus {
    return statusOf(this.limits, this.record(installId), plan, this.now());
  }

  /** Reserve one analysis if the allowance permits. Returns the status after the attempt. */
  consume(installId: string, plan: PlanName): { allowed: boolean; status: QuotaStatus } {
    const result = consumeRecord(this.limits, this.record(installId), plan, this.now());
    if (result.allowed) this.scheduleFlush();
    return result;
  }

  /** Give one back (the analysis failed on our side). */
  refund(installId: string, month: string, plan: PlanName): void {
    const r = this.data.installs[installId];
    if (r && refundRecord(r, month, plan)) this.scheduleFlush();
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

  license(installId: string): LicenseBinding {
    const r = this.data.installs[installId];
    return { licenseKey: r?.licenseKey, instanceId: r?.instanceId };
  }

  get size(): number {
    return Object.keys(this.data.installs).length;
  }
}
