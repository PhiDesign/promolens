/**
 * User settings, stored in chrome.storage.local under one key.
 */
export interface Settings {
  /** Show the PromoLens button on post pages. */
  enabled: boolean;
  /** On click, also send the post to the optional local API (language-model witness). Off by default. */
  apiEnabled: boolean;
  apiBaseUrl: string;
  /** Cached results older than this are ignored. */
  cacheTtlHours: number;
  /** On click, also read the author's public posting history (same site, your own session). */
  historyEnabled: boolean;
  /** Also show the button on feed cards; a click fetches the post in the background and scores it. */
  feedEnabled: boolean;
  /** When logged in with Reddit, read posts and profiles through the official Data API instead of the page session. */
  dataApiEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  apiEnabled: false,
  apiBaseUrl: "http://127.0.0.1:8787",
  cacheTtlHours: 24,
  historyEnabled: true,
  feedEnabled: true,
  dataApiEnabled: true,
};

export const SETTINGS_KEY = "promolens:settings";

function sanitize(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const url = typeof r.apiBaseUrl === "string" && /^https?:\/\//.test(r.apiBaseUrl) ? r.apiBaseUrl.replace(/\/+$/, "") : DEFAULT_SETTINGS.apiBaseUrl;
  const ttl = typeof r.cacheTtlHours === "number" && r.cacheTtlHours > 0 && r.cacheTtlHours <= 24 * 30 ? r.cacheTtlHours : DEFAULT_SETTINGS.cacheTtlHours;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_SETTINGS.enabled,
    apiEnabled: typeof r.apiEnabled === "boolean" ? r.apiEnabled : DEFAULT_SETTINGS.apiEnabled,
    apiBaseUrl: url,
    cacheTtlHours: ttl,
    historyEnabled: typeof r.historyEnabled === "boolean" ? r.historyEnabled : DEFAULT_SETTINGS.historyEnabled,
    feedEnabled: typeof r.feedEnabled === "boolean" ? r.feedEnabled : DEFAULT_SETTINGS.feedEnabled,
    dataApiEnabled: typeof r.dataApiEnabled === "boolean" ? r.dataApiEnabled : DEFAULT_SETTINGS.dataApiEnabled,
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    return sanitize(stored[SETTINGS_KEY]);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = sanitize({ ...current, ...patch });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** Subscribe to settings changes. Returns an unsubscribe function. */
export function onSettingsChanged(cb: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "local" || !(SETTINGS_KEY in changes)) return;
    cb(sanitize(changes[SETTINGS_KEY]?.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
