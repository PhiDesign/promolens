/**
 * Tiny debug logger. Prints to the page console with a [PromoLens] prefix so
 * problems on real Reddit pages can be diagnosed from DevTools. Never logs
 * post content - only ids, states and timings.
 */
const PREFIX = "[PromoLens]";

export function debug(...args: unknown[]): void {
  try {
    console.debug(PREFIX, ...args);
  } catch {
    /* ignore */
  }
}

export function warn(...args: unknown[]): void {
  try {
    console.warn(PREFIX, ...args);
  } catch {
    /* ignore */
  }
}
