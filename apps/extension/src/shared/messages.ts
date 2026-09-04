/**
 * Messages exchanged between the content script, popup and the background
 * service worker via chrome.runtime.sendMessage.
 */
import type { AnalysisResult, AuthorHistory, PostInput, Signal } from "@promolens/shared/light";

export type Message =
  | { type: "CACHE_GET"; hash: string }
  | { type: "CACHE_PUT"; hash: string; result: AnalysisResult }
  | { type: "CACHE_CLEAR" }
  | { type: "ENRICH"; hash: string; post: PostInput; localSignals: Signal[] }
  | { type: "API_HEALTH"; baseUrl?: string }
  /** Public posting history of one author, fetched on the user's click. */
  | { type: "HISTORY_GET"; author: string }
  /** Full content of one post (body, links, top comments), fetched on the user's click on a feed card. */
  | { type: "POST_GET"; permalink: string };

export type HistoryResponse = { ok: true; history: AuthorHistory } | { ok: false; reason: string };
export type PostGetResponse = { ok: true; post: PostInput } | { ok: false; reason: string };

export interface CacheGetResponse {
  ok: true;
  result?: AnalysisResult;
}

export type EnrichResponse = { ok: true; result: AnalysisResult } | { ok: false; reason: string };

export interface SimpleResponse {
  ok: boolean;
  message?: string;
}

export interface CacheClearResponse {
  ok: true;
  removed: number;
}
