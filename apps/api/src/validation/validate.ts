import { AnalyzeRequestSchema, AnalyzeResponseSchema, type AnalyzeRequest, type AnalyzeResponse } from "@promolens/shared";
import { HttpError } from "../http.js";

/** Parse an unknown request body into a validated AnalyzeRequest (400 on failure). */
export function parseAnalyzeRequest(body: unknown): AnalyzeRequest {
  const parsed = AnalyzeRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, "invalid_request", "Request did not match the analyze schema", {
      issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return parsed.data;
}

/** Final guard before sending a response: it must match the shared schema. */
export function assertValidResponse(response: unknown): AnalyzeResponse {
  const parsed = AnalyzeResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new HttpError(500, "invalid_response", "Server produced a response that failed schema validation");
  }
  return parsed.data;
}
