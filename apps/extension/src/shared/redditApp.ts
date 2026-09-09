/**
 * Reddit Data API app registration.
 *
 * Fill in REDDIT_CLIENT_ID with the client id of the "installed app" you
 * registered at https://www.reddit.com/prefs/apps once Reddit has approved
 * Data API access for PromoLens (see docs/reddit-compliance.md). Installed
 * apps have no secret: the client id ships inside the extension by design.
 *
 * While it is empty, the "Log in with Reddit" option stays hidden and the
 * extension keeps reading public pages with the user's own browser session.
 *
 * When you fill it in, also restore in public/manifest.json:
 *   "permissions": ["storage", "identity"]
 *   "host_permissions": [..., "https://oauth.reddit.com/*"]
 * They were removed for the store build so the install prompt stays minimal.
 */
export const REDDIT_CLIENT_ID = "";

/** Read-only scopes: who is logged in, public posts/comments, public user listings. */
export const REDDIT_SCOPES = ["identity", "read", "history"] as const;

export const REDDIT_AUTHORIZE_URL = "https://www.reddit.com/api/v1/authorize";
export const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
export const REDDIT_OAUTH_API = "https://oauth.reddit.com";

export function isRedditAppConfigured(): boolean {
  return REDDIT_CLIENT_ID.trim().length > 0;
}
