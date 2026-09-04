/**
 * Builds the extension into apps/extension/dist:
 *   - bundles content.js, background.js, popup.js with esbuild (plain IIFE files, no remote code)
 *   - copies public/ (manifest.json, popup.html)
 *   - generates PNG icons
 *
 * Usage: node scripts/build.mjs [--watch]
 */
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateIcons } from "./icons.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, "public"), dist, { recursive: true });
await generateIcons(join(dist, "icons"));

const ctx = await esbuild.context({
  absWorkingDir: root,
  entryPoints: {
    content: "src/content/index.ts",
    background: "src/background/index.ts",
    popup: "src/popup/popup.ts",
  },
  outdir: dist,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome116"],
  sourcemap: true,
  minify: false,
  legalComments: "none",
  logLevel: "info",
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
});

if (watch) {
  await ctx.watch();
  console.log("PromoLens extension: watching for changes (reload the extension in chrome://extensions after edits)");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log(`PromoLens extension built to ${dist}`);
}
