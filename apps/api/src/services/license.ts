/**
 * Lemon Squeezy licence keys.
 *
 * Their licence endpoints are public (no API key needed): validate tells us
 * whether a key exists and is active and which product it belongs to;
 * activate binds the key to an "instance" (our anonymous install id) so the
 * activation limit set on the product is enforced.
 *
 * Results are cached for a while so every analysis does not round-trip to
 * Lemon Squeezy. Nothing about the customer is stored beyond the key itself.
 */
export interface LicenseCheck {
  valid: boolean;
  /** Why not, in a short code: not_found, inactive, expired, wrong_product, limit_reached, provider_error. */
  reason?: string;
  status?: string;
  instanceId?: string;
  productId?: number;
}

export interface LicenseClientOptions {
  /** Product the key must belong to (Lemon Squeezy numeric product id). */
  productId: number;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  cacheMs?: number;
  now?: () => number;
}

interface LsResponse {
  valid?: boolean;
  error?: string | null;
  license_key?: { status?: string; activation_limit?: number | null; activation_usage?: number };
  instance?: { id?: string } | null;
  meta?: { product_id?: number; variant_id?: number; store_id?: number };
}

export class LicenseClient {
  private readonly fetchFn: typeof fetch;
  private readonly base: string;
  private readonly cache = new Map<string, { at: number; result: LicenseCheck }>();
  private readonly cacheMs: number;
  private readonly now: () => number;

  constructor(private readonly options: LicenseClientOptions) {
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.base = (options.baseUrl ?? "https://api.lemonsqueezy.com/v1/licenses").replace(/\/+$/, "");
    this.cacheMs = options.cacheMs ?? 6 * 60 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  private async call(path: "validate" | "activate" | "deactivate", form: Record<string, string>): Promise<LsResponse | undefined> {
    try {
      const res = await this.fetchFn(`${this.base}/${path}`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(8_000),
      });
      return (await res.json()) as LsResponse;
    } catch {
      return undefined;
    }
  }

  private interpret(body: LsResponse | undefined): LicenseCheck {
    if (!body) return { valid: false, reason: "provider_error" };
    const productId = body.meta?.product_id;
    if (productId !== undefined && productId !== this.options.productId) return { valid: false, reason: "wrong_product", productId };
    const status = body.license_key?.status;
    if (body.valid !== true) {
      const err = (body.error ?? "").toLowerCase();
      if (/not found|invalid/.test(err)) return { valid: false, reason: "not_found", status };
      if (status === "expired" || /expired/.test(err)) return { valid: false, reason: "expired", status };
      if (status === "disabled" || status === "inactive" || /disabled|inactive/.test(err)) return { valid: false, reason: "inactive", status };
      if (/activation limit/.test(err)) return { valid: false, reason: "limit_reached", status };
      return { valid: false, reason: "inactive", status };
    }
    if (status && status !== "active") return { valid: false, reason: status === "expired" ? "expired" : "inactive", status };
    return { valid: true, status, instanceId: body.instance?.id, productId };
  }

  /** Is this key currently good for PromoLens Plus? Cached. */
  async validate(licenseKey: string, instanceId?: string): Promise<LicenseCheck> {
    const key = `${licenseKey}|${instanceId ?? ""}`;
    const hit = this.cache.get(key);
    if (hit && hit.at + this.cacheMs > this.now()) return hit.result;
    const form: Record<string, string> = { license_key: licenseKey };
    if (instanceId) form.instance_id = instanceId;
    const result = this.interpret(await this.call("validate", form));
    // Do not cache provider errors: retry next time.
    if (result.reason !== "provider_error") this.cache.set(key, { at: this.now(), result });
    return result;
  }

  /** Bind the key to this install (counts against the product's activation limit). */
  async activate(licenseKey: string, instanceName: string): Promise<LicenseCheck> {
    const result = this.interpret(await this.call("activate", { license_key: licenseKey, instance_name: instanceName }));
    if (result.valid) this.cache.set(`${licenseKey}|${result.instanceId ?? ""}`, { at: this.now(), result });
    return result;
  }

  async deactivate(licenseKey: string, instanceId: string): Promise<void> {
    await this.call("deactivate", { license_key: licenseKey, instance_id: instanceId });
    this.cache.delete(`${licenseKey}|${instanceId}`);
    this.cache.delete(`${licenseKey}|`);
  }
}

export const LICENSE_KEY_RE = /^[A-Za-z0-9-]{16,80}$/;
