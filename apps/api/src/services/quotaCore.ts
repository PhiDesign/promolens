/**
 * Per-install allowance rules, with no storage attached.
 *
 * Identity is an anonymous install id the extension generates once (a UUID);
 * no account, no email. Free installs get a one-time allowance in their first
 * calendar month and a small monthly refill after that; Plus installs (valid
 * licence) get a larger monthly allowance.
 *
 * Two stores use these rules: the JSON file store for a Node server
 * (quota.ts) and the KV store for the Cloudflare Worker (apps/worker).
 */
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

export interface InstallRecord {
  firstMonth: string;
  /** Free-plan usage by month. */
  months: Record<string, number>;
  /** Plus usage by month, counted separately so an upgrade starts with the full allowance. */
  plusMonths?: Record<string, number>;
  licenseKey?: string;
  instanceId?: string;
}

export interface LicenseBinding {
  licenseKey?: string;
  instanceId?: string;
}

/** What the hosted-tier routes need from a store; implementations may be sync or async. */
export interface QuotaBackend {
  status(installId: string, plan: PlanName): QuotaStatus | Promise<QuotaStatus>;
  consume(installId: string, plan: PlanName): { allowed: boolean; status: QuotaStatus } | Promise<{ allowed: boolean; status: QuotaStatus }>;
  refund(installId: string, month: string, plan: PlanName): void | Promise<void>;
  attachLicense(installId: string, licenseKey: string, instanceId?: string): void | Promise<void>;
  detachLicense(installId: string): void | Promise<void>;
  license(installId: string): LicenseBinding | Promise<LicenseBinding>;
}

export function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function nextMonthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

export function newRecord(now: Date): InstallRecord {
  return { firstMonth: monthKey(now), months: {} };
}

export function limitFor(limits: PlanLimits, r: InstallRecord, plan: PlanName, month: string): number {
  if (plan === "plus") return limits.plusMonthly;
  return month === r.firstMonth ? limits.freeInitial : limits.freeMonthly;
}

function bucket(r: InstallRecord, plan: PlanName): Record<string, number> {
  if (plan === "free") return r.months;
  if (!r.plusMonths) r.plusMonths = {};
  return r.plusMonths;
}

export function statusOf(limits: PlanLimits, r: InstallRecord, plan: PlanName, now: Date): QuotaStatus {
  const month = monthKey(now);
  const used = bucket(r, plan)[month] ?? 0;
  const limit = limitFor(limits, r, plan, month);
  return { plan, used, limit, remaining: Math.max(0, limit - used), resetsAt: nextMonthStart(now), month };
}

/** Reserve one analysis in `r` (mutated) if the allowance permits. */
export function consumeRecord(limits: PlanLimits, r: InstallRecord, plan: PlanName, now: Date): { allowed: boolean; status: QuotaStatus } {
  const before = statusOf(limits, r, plan, now);
  if (before.remaining <= 0) return { allowed: false, status: before };
  const b = bucket(r, plan);
  b[before.month] = (b[before.month] ?? 0) + 1;
  // Keep the record small: drop months older than the previous one.
  for (const m of Object.keys(b)) if (m < before.month && m !== r.firstMonth) delete b[m];
  return { allowed: true, status: statusOf(limits, r, plan, now) };
}

/** Give one back (the analysis failed on our side). Returns whether anything changed. */
export function refundRecord(r: InstallRecord, month: string, plan: PlanName): boolean {
  const b = bucket(r, plan);
  if (!b[month]) return false;
  b[month] = Math.max(0, b[month]! - 1);
  return true;
}

/** A free install with no activity this month or last can be forgotten (privacy: keep nothing we do not need). */
export function isIdle(r: InstallRecord, now: Date): boolean {
  if (r.licenseKey) return false;
  const keep = new Set([monthKey(now), monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)))]);
  return !(Object.keys(r.months).some((m) => keep.has(m)) || Object.keys(r.plusMonths ?? {}).some((m) => keep.has(m)) || keep.has(r.firstMonth));
}

/** Anonymous install ids are UUIDs; reject anything else so the store cannot be polluted. */
export const INSTALL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
