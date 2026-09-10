/**
 * Node transport for the hosted tier (see services/hostedTier.ts):
 *   GET  /api/v1/quota
 *   POST /api/v1/license     { licenseKey }
 *   DELETE /api/v1/license
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "../http.js";
import { activateLicense, detachLicenseFor, parseInstallId, quotaFor, type HostedDeps } from "../services/hostedTier.js";

export { planFor, type QuotaResponse } from "../services/hostedTier.js";

export interface QuotaDeps extends HostedDeps {
  maxBodyBytes: number;
}

export function installIdFrom(req: IncomingMessage): string {
  return parseInstallId(req.headers["x-promolens-install"]);
}

export async function handleQuota(req: IncomingMessage, res: ServerResponse, deps: QuotaDeps): Promise<void> {
  sendJson(res, 200, await quotaFor(installIdFrom(req), deps));
}

export async function handleLicenseActivate(req: IncomingMessage, res: ServerResponse, deps: QuotaDeps): Promise<void> {
  const installId = installIdFrom(req);
  const body = await readJsonBody(req, deps.maxBodyBytes);
  sendJson(res, 200, await activateLicense(installId, body, deps));
}

export async function handleLicenseDetach(req: IncomingMessage, res: ServerResponse, deps: QuotaDeps): Promise<void> {
  sendJson(res, 200, await detachLicenseFor(installIdFrom(req), deps));
}
