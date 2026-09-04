import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError, readJsonBody, sendJson } from "../http.js";
import type { AnalysisService } from "../services/analysisService.js";
import { assertValidResponse, parseAnalyzeRequest } from "../validation/validate.js";

export interface AnalyzeRouteDeps {
  service: AnalysisService;
  maxBodyBytes: number;
}

export async function handleAnalyze(req: IncomingMessage, res: ServerResponse, deps: AnalyzeRouteDeps): Promise<void> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json");
  }
  const body = await readJsonBody(req, deps.maxBodyBytes);
  const request = parseAnalyzeRequest(body);
  const result = await deps.service.analyze(request);
  sendJson(res, 200, assertValidResponse(result));
}
