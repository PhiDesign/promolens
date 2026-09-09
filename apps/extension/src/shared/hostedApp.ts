/**
 * The hosted PromoLens service (included analyses + PromoLens Plus).
 *
 * HOSTED_API_URL is the deployed copy of apps/api with QUOTA_ENABLED=true.
 * While it is empty, the popup offers only "use my own key".
 */
export const HOSTED_API_URL = "";

/** Lemon Squeezy checkout for PromoLens Plus (public link; safe to ship). */
export const PLUS_CHECKOUT_URL = "https://promolens.lemonsqueezy.com/checkout/buy/0a4792a6-7f97-413a-af9b-dbdfc613ea25";
export const PLUS_PRICE_LABEL = "$4.99 / month";
export const PLUS_MONTHLY_ANALYSES = 500;
export const FREE_INITIAL_ANALYSES = 20;
export const FREE_MONTHLY_ANALYSES = 5;

export function isHostedConfigured(): boolean {
  return /^https:\/\//.test(HOSTED_API_URL.trim());
}
