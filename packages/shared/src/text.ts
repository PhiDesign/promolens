/**
 * Small text utilities used by the detectors. Kept dependency-free.
 */

export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function countMatches(text: string, re: RegExp): number {
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  return (text.match(new RegExp(re.source, flags)) ?? []).length;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const URL_RE = /\bhttps?:\/\/[^\s<>()"']+/gi;

/** Extract http(s) URLs from free text. */
export function extractUrls(text: string): string[] {
  return (text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?)]+$/, ""));
}

/** "www.example.com" -> "example.com" ; invalid -> undefined */
export function domainOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** "example.com" -> "example" (used to match brand names in text). */
export function domainLabel(domain: string): string {
  const parts = domain.split(".");
  if (parts.length >= 2) {
    // handle co.uk style
    const second = parts[parts.length - 2] ?? "";
    if (["co", "com", "org", "net"].includes(second) && parts.length >= 3) {
      return parts[parts.length - 3] ?? "";
    }
    return second;
  }
  return parts[0] ?? "";
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Reddit-internal and general-purpose hosts that are not "product links". */
export const NON_PRODUCT_DOMAINS: ReadonlySet<string> = new Set([
  "reddit.com", "redd.it", "i.redd.it", "v.redd.it", "preview.redd.it",
  "redditmedia.com", "redditstatic.com",
  "imgur.com", "i.imgur.com", "giphy.com", "tenor.com",
  "youtube.com", "youtu.be", "wikipedia.org", "en.wikipedia.org",
  "github.com", "gist.github.com", "stackoverflow.com", "archive.org",
  "twitter.com", "x.com", "news.ycombinator.com", "medium.com",
  "docs.google.com", "drive.google.com", "google.com", "arxiv.org",
]);

/** Widely known tools; used to tell "familiar" from "obscure" in workflows. */
export const FAMILIAR_TOOLS: readonly string[] = [
  "Google Sheets", "Google Docs", "Google Analytics", "Google Ads", "Google Drive", "Gmail",
  "Excel", "Word", "PowerPoint", "Outlook", "Teams", "OneNote",
  "Notion", "Obsidian", "Evernote", "Trello", "Asana", "Jira", "Airtable", "Monday",
  "ChatGPT", "GPT-4", "GPT-5", "Claude", "Gemini", "Copilot", "Midjourney", "DALL-E", "Perplexity",
  "Slack", "Discord", "Zoom", "Loom", "Calendly",
  "Semrush", "Ahrefs", "Moz", "Search Console", "Hotjar", "Mailchimp", "HubSpot", "Salesforce",
  "WordPress", "Webflow", "Shopify", "Wix", "Squarespace", "Ghost", "Substack",
  "Canva", "Figma", "Photoshop", "Illustrator", "Premiere", "DaVinci Resolve", "CapCut",
  "Zapier", "Make", "IFTTT", "n8n",
  "Stripe", "PayPal", "QuickBooks", "Xero",
  "VS Code", "GitHub", "GitLab", "Docker", "Postman", "Vercel", "Netlify", "AWS", "Firebase", "Supabase",
  "Python", "JavaScript", "TypeScript", "React", "Next.js", "Django", "Rails",
  "Reddit", "Twitter", "YouTube", "TikTok", "Instagram", "LinkedIn", "Facebook",
  "Anki", "Duolingo", "Spotify", "Kindle", "Audible",
];

const FAMILIAR_LOWER = new Set(FAMILIAR_TOOLS.map((t) => t.toLowerCase()));

export function isFamiliarTool(name: string): boolean {
  return FAMILIAR_LOWER.has(name.toLowerCase());
}

/** Common capitalised words that are not product names. */
const NAME_STOPWORDS = new Set([
  "i", "i'm", "i've", "i'd", "i'll", "the", "a", "an", "and", "or", "but", "so", "if", "my", "our", "we", "you", "your", "it", "its",
  "this", "that", "these", "those", "there", "here", "then", "than", "when", "what", "why", "how", "who", "which", "where",
  "after", "before", "because", "also", "just", "now", "today", "yesterday", "tomorrow", "week", "month", "year",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "edit", "tl;dr", "tldr", "update", "note", "ps", "p.s.", "btw", "imo", "imho", "op", "dm", "dms", "pm", "am",
  "yes", "no", "not", "ok", "okay", "thanks", "thank", "please", "hi", "hello", "hey", "everyone", "guys", "people",
  "step", "steps", "tip", "tips", "day", "days", "hour", "hours", "minute", "minutes", "first", "second", "third",
  "finally", "honestly", "anyway", "however", "basically", "literally", "seriously", "same", "every", "each", "some", "many", "most", "all",
  "reddit", "sub", "subreddit", "mods", "mod", "usa", "uk", "eu", "us", "ai", "seo", "api", "saas", "b2b", "b2c", "roi", "kpi", "ceo", "cto", "faq", "url", "pdf", "csv", "html", "css", "app", "tool", "tools",
  "free", "pro", "plus", "premium", "basic", "starter", "team", "enterprise", "business", "lifetime",
  // platforms, marketplaces and generic product words that are not the product being discussed
  "store", "windows", "microsoft", "apple", "google", "android", "ios", "mac", "macos", "linux", "chrome", "safari", "firefox",
  "play", "web", "desktop", "mobile", "cloud", "beta", "alpha", "version", "program", "programme", "show", "guide", "space",
  "english", "french", "german", "spanish", "american", "european", "internet", "wifi", "bluetooth", "usb",
  // capitalised ordinary words that start lines or bullets
  "closed", "open", "update", "edit", "note", "tldr", "tl;dr", "thanks", "hello", "hi", "hey", "yes", "no", "ok", "okay",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
]);

/**
 * Find candidate product/tool names: CamelCase words, capitalised words that
 * are not sentence-initial common words, and words matching linked domains.
 * Returns a map name -> mention count.
 */
export function findNameCandidates(text: string, linkedDomains: string[] = []): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (name: string) => {
    const key = name.trim();
    if (key.length < 3) return;
    if (NAME_STOPWORDS.has(key.toLowerCase())) return;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  // CamelCase / brand-like tokens (e.g. "FlowMatic", "NotionAI", "getResponse")
  for (const m of text.matchAll(/\b([A-Za-z][a-z]+[A-Z][A-Za-z0-9]*)\b/g)) bump(m[1]!);

  // Names with dotted suffix like "flowmatic.io"
  for (const m of text.matchAll(/\b([a-z0-9-]{3,})\.(?:ai|io|app|co|so|dev|xyz|me|tech|tools)\b/gi)) {
    bump(m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase());
  }

  // Multi-word names: runs of 2-3 capitalised words ("Advisory Guide",
  // "Tensor Space"). Counted as one name; their component words are removed
  // from the single-word counts below so "Advisory" does not compete with
  // "Advisory Guide".
  const sentences = splitSentences(text);
  const clean = (raw: string) => raw.replace(/^[("'\[]+|[)"'\],.!?:;]+$/g, "");
  const isCap = (w: string) => /^[A-Z][a-zA-Z0-9]{1,}$/.test(w) && !/^[A-Z]+$/.test(w);
  const phrases = new Map<string, number>();
  for (const s of sentences) {
    const words = s.split(/\s+/).map(clean);
    let i = 0;
    while (i < words.length) {
      if (!isCap(words[i]!) || NAME_STOPWORDS.has(words[i]!.toLowerCase())) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < words.length && j - i < 3 && isCap(words[j]!)) j++;
      if (j - i >= 2) {
        const phrase = words.slice(i, j).join(" ");
        // skip phrases made only of stop-listed/generic words
        if (!words.slice(i, j).every((w) => NAME_STOPWORDS.has(w.toLowerCase()))) {
          phrases.set(phrase, (phrases.get(phrase) ?? 0) + 1);
        }
      }
      i = j;
    }
  }

  // Capitalised words that are not at the start of a sentence
  const initial = new Map<string, number>();
  for (const s of sentences) {
    const words = s.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const w = clean(words[i]!);
      if (!/^[A-Z][a-zA-Z0-9]{2,}$/.test(w) || /^[A-Z]+$/.test(w)) continue;
      if (i === 0) initial.set(w, (initial.get(w) ?? 0) + 1);
      else bump(w);
    }
  }
  // Fold phrases in: count the phrase, and take its words out of the singles.
  for (const [phrase, n] of phrases) {
    counts.set(phrase, (counts.get(phrase) ?? 0) + n);
    for (const w of phrase.split(" ")) {
      const cur = counts.get(w);
      if (cur === undefined) continue;
      if (cur - n <= 0) counts.delete(w);
      else counts.set(w, cur - n);
      const init = initial.get(w);
      if (init !== undefined) initial.set(w, Math.max(0, init - n));
    }
  }
  // Sentence-initial words count when the same name also appears mid-sentence,
  // or when it opens three or more sentences (ordinary words are stop-listed).
  for (const [w, n] of initial) {
    const known = [...counts.keys()].some((k) => k.toLowerCase() === w.toLowerCase());
    if (known || n >= 3) for (let i = 0; i < n; i++) bump(w);
  }

  // Domain labels of outbound links ("flowmatic.io" -> "flowmatic")
  for (const d of linkedDomains) {
    const label = domainLabel(d);
    if (label.length >= 3 && !NON_PRODUCT_DOMAINS.has(d)) {
      const re = new RegExp(`\\b${escapeRegExp(label)}\\b`, "gi");
      const n = countMatches(text, re);
      if (n > 0) {
        // merge into an existing casing if present
        const existing = [...counts.keys()].find((k) => k.toLowerCase() === label.toLowerCase());
        const key = existing ?? label.charAt(0).toUpperCase() + label.slice(1);
        counts.set(key, Math.max(counts.get(key) ?? 0, n));
      }
    }
  }

  // Merge case variants
  const merged = new Map<string, number>();
  for (const [k, v] of counts) {
    const existing = [...merged.keys()].find((m) => m.toLowerCase() === k.toLowerCase());
    if (existing) merged.set(existing, merged.get(existing)! + v);
    else merged.set(k, v);
  }
  return merged;
}
