/**
 * Thin wrapper around chrome.runtime.sendMessage.
 *
 * Returns undefined instead of throwing when the background worker is not
 * reachable (for example right after the extension was reloaded) or does not
 * answer in time, so the content script always falls back to local results.
 */
import type { Message } from "../shared/messages.js";
import { warn } from "./debug.js";

const DEFAULT_TIMEOUT_MS = 1_500;
const TIMEOUTS: Partial<Record<Message["type"], number>> = {
  ENRICH: 30_000, // API client itself times out at 25 s; leave headroom
  HISTORY_GET: 12_000, // three Reddit listing requests
  POST_GET: 12_000, // one Reddit listing request
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
    warn(`message ${message.type} failed`, err instanceof Error ? err.message : err);
    return undefined;
  }
}
