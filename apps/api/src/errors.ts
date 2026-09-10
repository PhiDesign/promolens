/** An error that maps directly to an HTTP status and a short machine-readable code. Transport-agnostic. */
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

export function errorBody(err: HttpError): { error: { code: string; message: string; details?: unknown } } {
  return { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } };
}
