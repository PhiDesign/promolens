/**
 * Detects whether Reddit is currently in a dark theme.
 * Checks Reddit's html classes first, then falls back to the actual page
 * background luminance, then to the OS preference.
 */
export type Theme = "light" | "dark";

function luminance(rgb: string): number | undefined {
  const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
  if (!m) return undefined;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  if (a === 0) return undefined; // transparent - not informative
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function detectTheme(doc: Document = document): Theme {
  const html = doc.documentElement;
  const cls = html.className || "";
  if (/\bdark\b|theme-dark/i.test(cls)) return "dark";
  if (/theme-light/i.test(cls)) return "light";
  const ds = html.dataset;
  if (ds.theme === "dark" || ds.colorMode === "dark") return "dark";
  if (ds.theme === "light" || ds.colorMode === "light") return "light";

  try {
    const view = doc.defaultView;
    if (view && doc.body) {
      const bodyLum = luminance(view.getComputedStyle(doc.body).backgroundColor);
      const htmlLum = luminance(view.getComputedStyle(html).backgroundColor);
      const lum = bodyLum ?? htmlLum;
      if (lum !== undefined) return lum < 0.5 ? "dark" : "light";
      if (view.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
    }
  } catch {
    /* ignore */
  }
  return "light";
}
