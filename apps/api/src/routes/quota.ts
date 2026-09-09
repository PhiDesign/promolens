/**
 * Hosted-tier routes:
 *   GET  /api/v1/quota            - this install's plan and remaining analyses
 *   POST /api/v1/license          - { licenseKey } activate Plus for this install
 *   DELETE /api/v1/license        - detach the licence from this install
 *
 * The install id travels in the X-PromoLens-Install header (a UUID the
 * extension generates once). No accounts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError, readJsonBody, sendJson } from "../http.js";
import { LICENSE_KEY_RE, type LicenseClient } from "../services/license.js";
import { INSTALL_ID_RE, type PlanName, type QuotaStatus, type QuotaStore } from "../services/quota.js";

export interface QuotaDeps {
  quota: QuotaStore;
  license: LicenseClient;
  maxBodyBytes: number;
}

export function installIdFrom(req: IncomingMessage): string {
  const raw = req.headers["x-promolens-install"];
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !INSTALL_ID_RE.test(id)) throw new HttpError(400, "missing_install_id", "X-PromoLens-Install header must be a UUID");
  return id.toLowerCase();
}

/** Which plan this install is on right now (checks the attached licence, cached). */
export async function planFor(installId: string, deps: Pick<QuotaDeps, "quota" | "license">): Promise<{ plan: PlanName; licenseReason?: string }> {
  const { licenseKey, instanceId } = deps.quota.license(installId);
  if (!licenseKey) return { plan: "free" };
  const check = await deps.license.validate(licenseKey, instanceId);
  if (check.valid) return { plan: "plus" };
  // Provider hiccup: keep Plus rather than punish a paying user for our outage.
  if (check.reason === "provider_error") return { plan: "plus", licenseReason: check.reason };
  return { plan: "free", licenseReason: check.reason };
}

export interface QuotaResponse extends QuotaStatus {
  licensed: boolean;
  licenseReason?: string;
}

export async function handleQuota(req: IncomingMessage, res: ServerResponse, deps: QuotaDeps): Promise<void> {
  const installId = installIdFrom(req);
  const { plan, licenseReason } = await planFor(installId, deps);
  const status = deps.quota.status(installId, plan);
  const body: QuotaResponse = { ...status, licensed: plan === "plus", licenseReason };
  sendJson(res, 200, body);
}

export async function handleLicenseActivate(req: IncomingMessage, res: ServerResponse, deps: QuotaDeps): Promise<void> {
  const installId = installIdFrom(req);
  const body = (await readJsonBody(req, deps.maxBodyBytes)) as { licenseKey?: unknown };
  const key = typeof body.licenseKey === "string" ? body.licenseKey.trim() : "";
  if (!LICENSE_KEY_RE.test(key)) throw new HttpError(400, "invalid_license_key", "That does not look like a licence key");

  const existing = deps.quota.license(installId);
  const check = existing.licenseKey === key && existing.instanceId ? await deps.license.validate(key, existing.instanceId) : await deps.license.activate(key, installId);
  if (!check.valid) {
    const messages: Record<string, string> = {
      not_found: "Licence key not found. Check it was copied completely.",
      inactive: "This licence is not active. If you just subscribed, wait a minute and try again.",
      expired: "This licence has expired. Renew the subscription to keep using Plus.",
      wrong_product: "This key belongs to a different product.",
      limit_reached: "This key is already in use on the maximum number of devices.",
      provider_error: "Could not reach the licence service. Try again in a moment.",
    };
    throw new HttpError(402, `license_${check.reason ?? "invalid"}`, messages[check.reason ?? ""] ?? "Licence could not be activated.");
  }
  deps.quota.attachLicense(installId, key, check.instanceId ?? existing.instanceId);
  const status = deps.quota.status(installId, "plus");
  const response: QuotaResponse = { ...status, licensed: true };
  sendJson(res, 200, response);
}

export async function handleLicenseDetach(req: IncomingMessage, res: ServerResponse, deps: QuotaDeps): Promise<void> {
  const installId = installIdFrom(req);
  const { licenseKey, instanceId } = deps.quota.license(installId);
  if (licenseKey && instanceId) await deps.license.deactivate(licenseKey, instanceId);
  deps.quota.detachLicense(installId);
  const status = deps.quota.status(installId, "free");
  const response: QuotaResponse = { ...status, licensed: false };
  sendJson(res, 200, response);
}
