/**
 * Hosted-tier logic with no HTTP transport attached, so the Node server
 * (routes/quota.ts) and the Cloudflare Worker (apps/worker) share it:
 *
 *   quota    - this install's plan and remaining analyses
 *   activate - { licenseKey } binds a Plus licence to this install
 *   detach   - remove the licence from this install
 *
 * The install id travels in the X-PromoLens-Install header (a UUID the
 * extension generates once). No accounts.
 */
import { HttpError } from "../errors.js";
import { LICENSE_KEY_RE, type LicenseClient } from "./license.js";
import { INSTALL_ID_RE, type PlanName, type QuotaBackend, type QuotaStatus } from "./quotaCore.js";

export interface HostedDeps {
  quota: QuotaBackend;
  license: LicenseClient;
}

export interface QuotaResponse extends QuotaStatus {
  licensed: boolean;
  licenseReason?: string;
}

export function parseInstallId(header: string | string[] | undefined | null): string {
  const id = Array.isArray(header) ? header[0] : header;
  if (!id || !INSTALL_ID_RE.test(id)) throw new HttpError(400, "missing_install_id", "X-PromoLens-Install header must be a UUID");
  return id.toLowerCase();
}

/** Which plan this install is on right now (checks the attached licence, cached). */
export async function planFor(installId: string, deps: HostedDeps): Promise<{ plan: PlanName; licenseReason?: string }> {
  const { licenseKey, instanceId } = await deps.quota.license(installId);
  if (!licenseKey) return { plan: "free" };
  const check = await deps.license.validate(licenseKey, instanceId);
  if (check.valid) return { plan: "plus" };
  // Provider hiccup: keep Plus rather than punish a paying user for our outage.
  if (check.reason === "provider_error") return { plan: "plus", licenseReason: check.reason };
  return { plan: "free", licenseReason: check.reason };
}

export async function quotaFor(installId: string, deps: HostedDeps): Promise<QuotaResponse> {
  const { plan, licenseReason } = await planFor(installId, deps);
  const status = await deps.quota.status(installId, plan);
  return { ...status, licensed: plan === "plus", licenseReason };
}

const LICENSE_MESSAGES: Record<string, string> = {
  not_found: "Licence key not found. Check it was copied completely.",
  inactive: "This licence is not active. If you just subscribed, wait a minute and try again.",
  expired: "This licence has expired. Renew the subscription to keep using Plus.",
  wrong_product: "This key belongs to a different product.",
  limit_reached: "This key is already in use on the maximum number of devices.",
  provider_error: "Could not reach the licence service. Try again in a moment.",
};

export async function activateLicense(installId: string, body: unknown, deps: HostedDeps): Promise<QuotaResponse> {
  const raw = (body as { licenseKey?: unknown } | null)?.licenseKey;
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!LICENSE_KEY_RE.test(key)) throw new HttpError(400, "invalid_license_key", "That does not look like a licence key");

  const existing = await deps.quota.license(installId);
  const check = existing.licenseKey === key && existing.instanceId ? await deps.license.validate(key, existing.instanceId) : await deps.license.activate(key, installId);
  if (!check.valid) {
    throw new HttpError(402, `license_${check.reason ?? "invalid"}`, LICENSE_MESSAGES[check.reason ?? ""] ?? "Licence could not be activated.");
  }
  await deps.quota.attachLicense(installId, key, check.instanceId ?? existing.instanceId);
  const status = await deps.quota.status(installId, "plus");
  return { ...status, licensed: true };
}

export async function detachLicenseFor(installId: string, deps: HostedDeps): Promise<QuotaResponse> {
  const { licenseKey, instanceId } = await deps.quota.license(installId);
  if (licenseKey && instanceId) await deps.license.deactivate(licenseKey, instanceId);
  await deps.quota.detachLicense(installId);
  const status = await deps.quota.status(installId, "free");
  return { ...status, licensed: false };
}
