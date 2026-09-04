import type { ServerResponse } from "node:http";
import { ANALYSIS_VERSION, type HealthResponse } from "@promolens/shared";
import { sendJson } from "../http.js";

const startedAt = Date.now();

export function handleHealth(res: ServerResponse, providerName: string): void {
  const body: HealthResponse = {
    status: "ok",
    version: ANALYSIS_VERSION,
    provider: providerName,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
  sendJson(res, 200, body);
}
