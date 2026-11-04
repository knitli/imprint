// Bundle each variant with esbuild, inline the category checkboxes into the
// HTML, and copy the USWDS assets we serve ourselves (no CDN).
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";

rmSync("out", { recursive: true, force: true });
mkdirSync("out/dist", { recursive: true });
cpSync("public", "out", { recursive: true });

const cats = readFileSync("src/categories.txt", "utf8").trim().split("\n").map((l) => l.split("|"));
const uswds = cats.map(([v, t]) => `          <div class="usa-checkbox">
            <input class="usa-checkbox__input" id="cat-${v.slice(4,5)}" type="checkbox" name="categories" value="${v}">
            <label class="usa-checkbox__label" for="cat-${v.slice(4,5)}">${v} ${t}</label>
          </div>`).join("\n");
const plain = cats.map(([v, t]) => `        <div class="checkbox">
          <input id="cat-${v.slice(4,5)}" type="checkbox" name="categories" value="${v}">
          <label for="cat-${v.slice(4,5)}">${v} ${t}</label>
        </div>`).join("\n");
for (const [file, marker, html] of [["uswds.html", "<!--CATEGORIES-USWDS-->", uswds], ["plain.html", "<!--CATEGORIES-PLAIN-->", plain]]) {
  const p = `out/${file}`;
  writeFileSync(p, readFileSync(p, "utf8").replace(marker, html));
}

// USWDS: precompiled CSS plus the fonts and images it references.
const src = "node_modules/@uswds/uswds/dist";
for (const d of ["css", "fonts", "img"]) cpSync(`${src}/${d}`, `out/vendor/uswds/${d}`, { recursive: true });

for (const v of ["uswds", "plain"]) {
  await build({
    entryPoints: [`src/variant-${v}.js`],
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    outfile: `out/dist/${v}.js`,
    metafile: true,
    logLevel: "warning",
  });
  console.log(`${v}.js: ${(statSync(`out/dist/${v}.js`).size / 1024).toFixed(0)} KiB`);
}
