/**
 * Thin wrapper around chrome.runtime.sendMessage.
 *
 * Returns undefined instead of throwing when the background worker is not
 * reachable (for example right after the extension was reloaded) or does not
 * answer in time, so the content script always falls back to local results.
 */
import type { Message } from "../shared/messages.js";
import { debug, warn } from "./debug.js";

const DEFAULT_TIMEOUT_MS = 1_500;
const TIMEOUTS: Partial<Record<Message["type"], number>> = {
  ENRICH: 60_000, // API client itself times out at 55 s; leave headroom
  HISTORY_GET: 20_000, // three Reddit listing requests, each capped at 10 s in the worker
  POST_GET: 20_000, // one Reddit listing request, capped at 10 s in the worker
};

export async function send<T>(message: Message): Promise<T | undefined> {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) return undefined;
    const timeoutMs = TIMEOUTS[message.type] ?? DEFAULT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        warn(`no reply from background worker for ${message.type} within ${timeoutMs} ms`);
        resolve(undefined);
      }, timeoutMs);
    });
    try {
      const response = await Promise.race([chrome.runtime.sendMessage(message) as Promise<T | undefined>, timeout]);
      return response ?? undefined;
    } finally {
      clearTimeout(timer); // a reply arrived: no phantom warning later
    }
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    // Expected when the extension is reloaded or the worker restarts while a
    // request is in flight: the caller falls back to the local result.
    if (/message channel closed|Extension context invalidated|Receiving end does not exist/i.test(text)) {
      debug(`message ${message.type}: background worker went away (${text})`);
    } else {
      warn(`message ${message.type} failed`, text);
    }
    return undefined;
  }
}
