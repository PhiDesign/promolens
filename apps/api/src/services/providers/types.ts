/**
 * The provider contract lives in the shared package (packages/shared/src/witness.ts)
 * so the extension can run the same providers without a server. Re-exported
 * here to keep API imports short.
 */
export type { AnalysisProvider } from "@promolens/shared";
