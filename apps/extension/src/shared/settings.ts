/**
 * User settings, stored in chrome.storage.local under one key.
 */
/** hosted = PromoLens's included analyses (free allowance / Plus); own-key = the user's OpenAI key; local-api = developer server. */
export type AiProvider = "hosted" | "own-key" | "local-api";

export interface Settings {
  /** Show the PromoLens button on post pages. */
  enabled: boolean;
  /** Every click runs the rules plus a language model. Where the model runs: PromoLens's included analyses, the user's own OpenAI key, or a local API server (developers). */
  aiProvider: AiProvider;
  /** Own-key mode: stored only in this extension's storage on this device; sent only to the provider. */
  ownKey: string;
  ownModel: string;
  /** Hosted mode: the PromoLens Plus licence key the user activated (kept for display; the server holds the binding). */
  licenseKey: string;
  /** Local-API mode. */
  apiBaseUrl: string;
  /** Cached results older than this are ignored. */
  cacheTtlHours: number;
  /** Also show the button on feed cards; a click fetches the post in the background and scores it. */
  feedEnabled: boolean;
  /** When logged in with Reddit, read posts and profiles through the official Data API instead of the page session. */
  dataApiEnabled: boolean;
}

export const OWN_KEY_MODELS = ["gpt-5-mini", "gpt-5", "gpt-4.1-mini", "gpt-4.1"] as const;

import { isHostedConfigured } from "./hostedApp.js";

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  aiProvider: isHostedConfigured() ? "hosted" : "own-key",
  ownKey: "",
  ownModel: "gpt-5-mini",
  licenseKey: "",
  apiBaseUrl: "http://127.0.0.1:8787",
  cacheTtlHours: 24,
  feedEnabled: true,
  dataApiEnabled: true,
};

export const SETTINGS_KEY = "promolens:settings";

function sanitize(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const url = typeof r.apiBaseUrl === "string" && /^https?:\/\//.test(r.apiBaseUrl) ? r.apiBaseUrl.replace(/\/+$/, "") : DEFAULT_SETTINGS.apiBaseUrl;
  const ttl = typeof r.cacheTtlHours === "number" && r.cacheTtlHours > 0 && r.cacheTtlHours <= 24 * 30 ? r.cacheTtlHours : DEFAULT_SETTINGS.cacheTtlHours;
  const ownKey = typeof r.ownKey === "string" ? r.ownKey.trim().slice(0, 300) : "";
  const ownModel = typeof r.ownModel === "string" && /^[A-Za-z0-9._-]{2,64}$/.test(r.ownModel.trim()) ? r.ownModel.trim() : DEFAULT_SETTINGS.ownModel;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_SETTINGS.enabled,
    aiProvider:
      r.aiProvider === "local-api" ? "local-api" : r.aiProvider === "hosted" && isHostedConfigured() ? "hosted" : r.aiProvider === "own-key" ? "own-key" : DEFAULT_SETTINGS.aiProvider,
    ownKey,
    ownModel,
    licenseKey: typeof r.licenseKey === "string" ? r.licenseKey.trim().slice(0, 80) : "",
    apiBaseUrl: url,
    cacheTtlHours: ttl,
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
