/**
 * Toolbar popup: enable/disable scanning, optional API settings, clear cache.
 * No inline scripts - this file is loaded from popup.html via <script src>.
 */
import { loadSettings, saveSettings } from "../shared/settings.js";
import type { CacheClearResponse, Message, RedditStatusResponse, SimpleResponse } from "../shared/messages.js";

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

async function send<T>(message: Message): Promise<T | undefined> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch {
    return undefined;
  }
}

async function init(): Promise<void> {
  const enabled = $<HTMLInputElement>("enabled");
  const historyEnabled = $<HTMLInputElement>("historyEnabled");
  const feedEnabled = $<HTMLInputElement>("feedEnabled");
  const apiEnabled = $<HTMLInputElement>("apiEnabled");
  const apiBaseUrl = $<HTMLInputElement>("apiBaseUrl");
  const checkApi = $<HTMLButtonElement>("checkApi");
  const apiStatus = $<HTMLDivElement>("apiStatus");
  const clearCache = $<HTMLButtonElement>("clearCache");
  const cacheStatus = $<HTMLDivElement>("cacheStatus");
  const version = $<HTMLElement>("version");

  version.textContent = `v${chrome.runtime.getManifest().version}`;

  const settings = await loadSettings();
  enabled.checked = settings.enabled;
  historyEnabled.checked = settings.historyEnabled;
  feedEnabled.checked = settings.feedEnabled;
  apiEnabled.checked = settings.apiEnabled;
  apiBaseUrl.value = settings.apiBaseUrl;

  enabled.addEventListener("change", () => void saveSettings({ enabled: enabled.checked }));
  historyEnabled.addEventListener("change", () => void saveSettings({ historyEnabled: historyEnabled.checked }));
  feedEnabled.addEventListener("change", () => void saveSettings({ feedEnabled: feedEnabled.checked }));
  apiEnabled.addEventListener("change", () => void saveSettings({ apiEnabled: apiEnabled.checked }));
  apiBaseUrl.addEventListener("change", async () => {
    const saved = await saveSettings({ apiBaseUrl: apiBaseUrl.value.trim() });
    apiBaseUrl.value = saved.apiBaseUrl;
  });

  checkApi.addEventListener("click", async () => {
    apiStatus.className = "status";
    apiStatus.textContent = "Checking…";
    const res = await send<SimpleResponse>({ type: "API_HEALTH", baseUrl: apiBaseUrl.value.trim().replace(/\/+$/, "") });
    apiStatus.className = `status ${res?.ok ? "ok" : "bad"}`;
    apiStatus.textContent = res?.message ?? "Could not reach the background worker";
  });

  // Deeper analysis: provider choice, own key, and a "save and test" that asks
  // for the api.openai.com permission in the same click (a user gesture).
  const aiOptions = $<HTMLElement>("aiOptions");
  const providerOwnKey = $<HTMLInputElement>("providerOwnKey");
  const providerLocalApi = $<HTMLInputElement>("providerLocalApi");
  const ownKeyFields = $<HTMLElement>("ownKeyFields");
  const localApiFields = $<HTMLElement>("localApiFields");
  const ownKey = $<HTMLInputElement>("ownKey");
  const ownModel = $<HTMLSelectElement>("ownModel");
  const saveOwnKey = $<HTMLButtonElement>("saveOwnKey");
  const OPENAI_ORIGIN = "https://api.openai.com/*";

  const renderAi = (s: { apiEnabled: boolean; aiProvider: string; ownKey: string; ownModel: string }) => {
    aiOptions.hidden = !s.apiEnabled;
    providerOwnKey.checked = s.aiProvider === "own-key";
    providerLocalApi.checked = s.aiProvider === "local-api";
    ownKeyFields.hidden = s.aiProvider !== "own-key";
    localApiFields.hidden = s.aiProvider !== "local-api";
    ownModel.value = s.ownModel;
    if (s.ownKey && !ownKey.value) ownKey.placeholder = `saved key ending …${s.ownKey.slice(-4)}`;
  };
  renderAi(settings);
  apiEnabled.addEventListener("change", () => renderAi({ ...settings, apiEnabled: apiEnabled.checked, aiProvider: providerOwnKey.checked ? "own-key" : "local-api" }));
  for (const radio of [providerOwnKey, providerLocalApi]) {
    radio.addEventListener("change", async () => {
      const saved = await saveSettings({ aiProvider: providerOwnKey.checked ? "own-key" : "local-api" });
      renderAi(saved);
    });
  }
  ownModel.addEventListener("change", () => void saveSettings({ ownModel: ownModel.value }));
  saveOwnKey.addEventListener("click", async () => {
    apiStatus.className = "status";
    const key = ownKey.value.trim();
    if (key) {
      let granted = true;
      try {
        granted = await chrome.permissions.request({ origins: [OPENAI_ORIGIN] });
      } catch {
        granted = false;
      }
      if (!granted) {
        apiStatus.className = "status bad";
        apiStatus.textContent = "PromoLens needs permission to contact api.openai.com to use your key.";
        return;
      }
      await saveSettings({ ownKey: key, ownModel: ownModel.value, aiProvider: "own-key", apiEnabled: true });
      ownKey.value = "";
      ownKey.placeholder = `saved key ending …${key.slice(-4)}`;
    }
    apiStatus.textContent = "Testing the key…";
    const res = await send<SimpleResponse>({ type: "AI_TEST" });
    apiStatus.className = `status ${res?.ok ? "ok" : "bad"}`;
    apiStatus.textContent = res?.message ?? "Could not reach the background worker";
  });

  // Official Reddit API login: only shown when the app is configured.
  const redditSection = $<HTMLElement>("redditSection");
  const dataApiEnabled = $<HTMLInputElement>("dataApiEnabled");
  const redditLogin = $<HTMLButtonElement>("redditLogin");
  const redditLogout = $<HTMLButtonElement>("redditLogout");
  const redditStatus = $<HTMLDivElement>("redditStatus");
  dataApiEnabled.checked = settings.dataApiEnabled;
  dataApiEnabled.addEventListener("change", () => void saveSettings({ dataApiEnabled: dataApiEnabled.checked }));
  const renderReddit = (s: RedditStatusResponse | undefined) => {
    if (!s?.configured) {
      redditSection.hidden = true;
      return;
    }
    redditSection.hidden = false;
    redditLogin.hidden = s.loggedIn;
    redditLogout.hidden = !s.loggedIn;
    redditStatus.className = `status ${s.ok ? (s.loggedIn ? "ok" : "") : "bad"}`;
    redditStatus.textContent = s.message ?? (s.loggedIn ? `Logged in as u/${s.username ?? "?"}` : "Not logged in - reading public pages with your browser session.");
  };
  renderReddit(await send<RedditStatusResponse>({ type: "REDDIT_STATUS" }));
  redditLogin.addEventListener("click", async () => {
    redditStatus.className = "status";
    redditStatus.textContent = "Opening Reddit…";
    renderReddit(await send<RedditStatusResponse>({ type: "REDDIT_LOGIN" }));
  });
  redditLogout.addEventListener("click", async () => renderReddit(await send<RedditStatusResponse>({ type: "REDDIT_LOGOUT" })));

  clearCache.addEventListener("click", async () => {
    const res = await send<CacheClearResponse>({ type: "CACHE_CLEAR" });
    cacheStatus.textContent = res?.ok ? `Removed ${res.removed} cached result${res.removed === 1 ? "" : "s"}.` : "Could not clear the cache.";
  });
}

void init();
