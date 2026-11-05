// Can the OpenSCG 0.1 schema be compiled ahead of time (no eval in the page)?
// Uses ajv's standalone mode with the same options OpenSCG uses. Synthetic data only.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { Ajv2020 } = require("ajv/dist/2020.js");
const addFormats = require("ajv-formats");
const standaloneCode = require("ajv/dist/standalone").default;
const schema = JSON.parse(readFileSync(require.resolve("@knitli/openscg/schema/0.1/guide.schema.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, code: { source: true } });
addFormats(ajv);
const code = standaloneCode(ajv, ajv.compile(schema));
mkdirSync("out", { recursive: true });
writeFileSync("out/guide-validator.standalone.cjs", code);
// Bundle it for the browser, then check the bundle contains no runtime code generation.
const { build } = await import("esbuild");
const out = await build({ entryPoints: ["out/guide-validator.standalone.cjs"], bundle: true, minify: true, format: "esm", platform: "browser", write: false });
const bundled = out.outputFiles[0].text;
const usesEval = /new Function|\beval\(/.test(bundled);
const mod = { default: require("../out/guide-validator.standalone.cjs") };
const lantern = JSON.parse(readFileSync("node_modules/@knitli/openscg/examples/synthetic-lantern.json", "utf8"));
const broken = structuredClone(lantern); broken.entries[2].description = "";
const v = mod.default;
console.log(JSON.stringify({ source_bytes: code.length, browser_bundle_bytes: bundled.length, bundle_uses_eval: usesEval, lantern_valid: v(lantern), broken_valid: v(broken), broken_errors: v.errors?.map((e) => e.instancePath) }));
