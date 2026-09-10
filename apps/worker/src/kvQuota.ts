/**
 * Per-install allowance stored in Workers KV: one small JSON record per
 * install id. Free records expire on their own after ~70 days without a
 * write, which is the same "forget idle installs" rule the file store applies.
 *
 * KV is eventually consistent, so two clicks in the same second could both
 * pass an allowance with one analysis left. Accepted: the worst case is one
 * extra free analysis.
 */
import {
  consumeRecord,
  newRecord,
  refundRecord,
  statusOf,
  type InstallRecord,
  type LicenseBinding,
  type PlanLimits,
  type PlanName,
  type QuotaBackend,
  type QuotaStatus,
} from "../../api/src/services/quotaCore.js";

/** The subset of KVNamespace we use (so tests can pass a Map-backed fake). */
export interface KvLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

const FREE_TTL_SECONDS = 70 * 24 * 60 * 60;

export class KvQuotaStore implements QuotaBackend {
  constructor(
    private readonly limits: PlanLimits,
    private readonly kv: KvLike,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private key(installId: string): string {
    return `install:${installId}`;
  }

  private async read(installId: string): Promise<InstallRecord | undefined> {
    const v = (await this.kv.get(this.key(installId), "json")) as Partial<InstallRecord> | null;
    if (!v || typeof v.firstMonth !== "string" || typeof v.months !== "object" || v.months === null) return undefined;
    return { firstMonth: v.firstMonth, months: v.months, licenseKey: v.licenseKey, instanceId: v.instanceId };
  }

  private async write(installId: string, r: InstallRecord): Promise<void> {
    // Plus records never expire on their own; the licence binding must survive.
    await this.kv.put(this.key(installId), JSON.stringify(r), r.licenseKey ? undefined : { expirationTtl: FREE_TTL_SECONDS });
  }

  private async record(installId: string): Promise<{ r: InstallRecord; fresh: boolean }> {
    const existing = await this.read(installId);
    return existing ? { r: existing, fresh: false } : { r: newRecord(this.now()), fresh: true };
  }

  async status(installId: string, plan: PlanName): Promise<QuotaStatus> {
    const { r, fresh } = await this.record(installId);
    // Persist first sight so the "first month" allowance is anchored.
    if (fresh) await this.write(installId, r);
    return statusOf(this.limits, r, plan, this.now());
  }

  async consume(installId: string, plan: PlanName): Promise<{ allowed: boolean; status: QuotaStatus }> {
    const { r } = await this.record(installId);
    const result = consumeRecord(this.limits, r, plan, this.now());
    await this.write(installId, r);
    return result;
  }

  async refund(installId: string, month: string): Promise<void> {
    const r = await this.read(installId);
    if (r && refundRecord(r, month)) await this.write(installId, r);
  }

  async attachLicense(installId: string, licenseKey: string, instanceId?: string): Promise<void> {
    const { r } = await this.record(installId);
    r.licenseKey = licenseKey;
    r.instanceId = instanceId;
    await this.write(installId, r);
  }

  async detachLicense(installId: string): Promise<void> {
    const { r } = await this.record(installId);
    delete r.licenseKey;
    delete r.instanceId;
    await this.write(installId, r);
  }

  async license(installId: string): Promise<LicenseBinding> {
    const r = await this.read(installId);
    return { licenseKey: r?.licenseKey, instanceId: r?.instanceId };
  }
}
