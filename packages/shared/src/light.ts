/**
 * Zod-free entry point for the content script (keeps the injected bundle
 * small). Everything except the runtime schemas.
 */
export * from "./types.js";
export * from "./criteria.js";
export * from "./detectors.js";
export * from "./scoring.js";
export * from "./labels.js";
export * from "./hash.js";
export * from "./history.js";
export * from "./verdict.js";
export * from "./limits.js";
export {
  normalizeWhitespace,
  splitSentences,
  extractUrls,
  domainOf,
  findNameCandidates,
  isFamiliarTool,
  FAMILIAR_TOOLS,
  NON_PRODUCT_DOMAINS,
} from "./text.js";
