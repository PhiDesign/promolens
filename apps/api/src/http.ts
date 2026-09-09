/**
 * Tiny helpers on top of node:http - JSON responses, safe body reading with a
 * size limit, and CORS. Kept small on purpose so the whole server is readable.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, err: HttpError): void {
  sendJson(res, err.status, {
    error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
  });
}

/** Read and parse a JSON body, rejecting bodies larger than `maxBytes`. */
export function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new HttpError(413, "payload_too_large", `Request body exceeds ${maxBytes} bytes`));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        reject(new HttpError(413, "payload_too_large", `Request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        reject(new HttpError(400, "empty_body", "Request body is empty"));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "invalid_json", "Request body is not valid JSON"));
      }
    });
    req.on("error", () => reject(new HttpError(400, "read_error", "Failed to read request body")));
  });
}

/** Match an Origin against allow-list entries; `chrome-extension://*` style wildcards are supported. */
export function originAllowed(origin: string | undefined, patterns: string[]): boolean {
  if (!origin) return false;
  return patterns.some((p) => {
    if (p === "*") return true;
    if (!p.includes("*")) return p === origin;
    const re = new RegExp("^" + p.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    return re.test(origin);
  });
}

/**
 * Apply CORS headers. Returns true when the request was a preflight that has
 * been fully answered (so the caller should stop).
 */
export function applyCors(req: IncomingMessage, res: ServerResponse, allowedOrigins: string[]): boolean {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin, allowedOrigins)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-PromoLens-Install, X-PromoLens-License");
    res.setHeader("Access-Control-Expose-Headers", "X-PromoLens-Quota-Used, X-PromoLens-Quota-Limit, X-PromoLens-Quota-Plan");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(origin && originAllowed(origin, allowedOrigins) ? 204 : 403);
    res.end();
    return true;
  }
  return false;
}

export function clientKey(req: IncomingMessage): string {
  const ip = req.socket.remoteAddress ?? "unknown";
  const origin = req.headers.origin ?? "no-origin";
  return `${ip}|${origin}`;
}
