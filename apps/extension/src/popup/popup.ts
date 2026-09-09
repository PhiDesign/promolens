/**
 * Toolbar popup: enable/disable scanning, optional API settings, clear cache.
 * No inline scripts - this file is loaded from popup.html via <script src>.
 */
import { loadSettings, saveSettings } from "../shared/settings.js";
import { isHostedConfigured, PLUS_CHECKOUT_URL, PLUS_PRICE_LABEL } from "../shared/hostedApp.js";
import type { CacheClearResponse, Message, QuotaResponse, RedditStatusResponse, SimpleResponse } from "../shared/messages.js";

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

  // Hosted tier (included analyses / Plus)
  const hosted = isHostedConfigured();
  const providerHosted = $<HTMLInputElement>("providerHosted");
  const providerHostedRow = $<HTMLElement>("providerHostedRow");
  const providerOwnKeyRow = $<HTMLElement>("providerOwnKeyRow");
  const hostedFields = $<HTMLElement>("hostedFields");
  const quotaStatus = $<HTMLDivElement>("quotaStatus");
  const upgradeLink = $<HTMLAnchorElement>("upgradeLink");
  const licenseKey = $<HTMLInputElement>("licenseKey");
  const activateLicense = $<HTMLButtonElement>("activateLicense");
  const removeLicense = $<HTMLButtonElement>("removeLicense");
  const licenseStatus = $<HTMLDivElement>("licenseStatus");
  upgradeLink.href = PLUS_CHECKOUT_URL;
  upgradeLink.textContent = `Upgrade to Plus - ${PLUS_PRICE_LABEL}`;

  const renderQuota = (q: QuotaResponse | undefined) => {
    if (!q) {
      quotaStatus.className = "status";
      quotaStatus.textContent = "Checking your allowance…";
      return;
    }
    if (!q.ok) {
      quotaStatus.className = "status bad";
      quotaStatus.textContent = q.message;
      return;
    }
    const { plan, used, limit, remaining, resetsAt, licensed } = q.quota;
    const reset = resetsAt ? new Date(resetsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
    quotaStatus.className = `status ${remaining > 0 ? "ok" : "bad"}`;
    quotaStatus.textContent = `${plan === "plus" ? "PromoLens Plus" : "Free"}: ${remaining} of ${limit} analyses left this month${reset ? ` (resets ${reset})` : ""}${used ? ` · ${used} used` : ""}`;
    upgradeLink.hidden = licensed;
    removeLicense.hidden = !licensed;
    licenseKey.hidden = licensed;
    activateLicense.hidden = licensed;
  };

  const selectedProvider = () => (providerHosted.checked ? "hosted" : providerLocalApi.checked ? "local-api" : "own-key");
  const renderAi = (s: { apiEnabled: boolean; aiProvider: string; ownKey: string; ownModel: string }) => {
    aiOptions.hidden = !s.apiEnabled;
    providerHosted.checked = s.aiProvider === "hosted";
    providerOwnKey.checked = s.aiProvider === "own-key";
    providerLocalApi.checked = s.aiProvider === "local-api";
    // Choice rows only when there is a choice (hosted service configured).
    providerHostedRow.hidden = !hosted;
    providerOwnKeyRow.hidden = !hosted && s.aiProvider !== "local-api";
    hostedFields.hidden = !hosted || s.aiProvider !== "hosted";
    ownKeyFields.hidden = s.aiProvider !== "own-key";
    // The local-API option is a developer setting: its fields only appear when it
    // was enabled outside the popup (see docs/testing.md).
    localApiFields.hidden = s.aiProvider !== "local-api";
    (providerLocalApi.closest("label") as HTMLElement | null)!.hidden = s.aiProvider !== "local-api";
    ownModel.value = s.ownModel;
    if (s.ownKey && !ownKey.value) ownKey.placeholder = `saved key ending …${s.ownKey.slice(-4)}`;
    if (hosted && s.apiEnabled && s.aiProvider === "hosted") {
      renderQuota(undefined);
      void send<QuotaResponse>({ type: "QUOTA_GET" }).then(renderQuota);
    }
  };
  renderAi(settings);
  apiEnabled.addEventListener("change", async () => {
    const saved = await saveSettings({ apiEnabled: apiEnabled.checked });
    renderAi(saved);
  });
  for (const radio of [providerHosted, providerOwnKey, providerLocalApi]) {
    radio.addEventListener("change", async () => {
      const saved = await saveSettings({ aiProvider: selectedProvider() });
      renderAi(saved);
    });
  }
  activateLicense.addEventListener("click", async () => {
    const key = licenseKey.value.trim();
    if (!key) {
      licenseStatus.className = "status bad";
      licenseStatus.textContent = "Paste the licence key from your Lemon Squeezy receipt email.";
      return;
    }
    licenseStatus.className = "status";
    licenseStatus.textContent = "Activating…";
    const res = await send<QuotaResponse>({ type: "LICENSE_ACTIVATE", licenseKey: key });
    if (res?.ok) {
      await saveSettings({ licenseKey: key });
      licenseKey.value = "";
      licenseStatus.className = "status ok";
      licenseStatus.textContent = "PromoLens Plus is active on this device.";
    } else {
      licenseStatus.className = "status bad";
      licenseStatus.textContent = res?.message ?? "Could not reach the PromoLens service.";
    }
    renderQuota(res);
  });
  removeLicense.addEventListener("click", async () => {
    const res = await send<QuotaResponse>({ type: "LICENSE_DETACH" });
    await saveSettings({ licenseKey: "" });
    licenseStatus.className = "status";
    licenseStatus.textContent = res?.ok ? "Licence removed from this device." : (res?.message ?? "");
    renderQuota(res);
  });
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
