import { build } from "esbuild";
const r = await build({
  entryPoints: ["browser-entry.js"], bundle: true, format: "iife", platform: "browser",
  outfile: "out/browser-bundle.js", minify: true, metafile: true, logLevel: "warning",
});
const bytes = Object.values(r.metafile.outputs)[0].bytes;
console.log(`browser bundle: ${(bytes / 1024).toFixed(0)} KiB`);
