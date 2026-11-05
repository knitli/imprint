# SP-07: Which UI approach gets us accessible forms fastest?

**Status:** Done, November 4, 2026. Synthetic data only. Throwaway code: do not import it into the application.

## The question

Which approach gives us accessible entry forms, with an error summary and field-level errors, for the least custom work? We compared two options:

- **USWDS:** the U.S. Web Design System, served from our own server.
- **Plain HTML:** semantic HTML with about 40 lines of our own CSS.

Both pages share the same behaviour code (`src/app.js`). Only the markup and the CSS class names differ.

## What we built

One screen, built twice:

- a list of the entries in the synthetic LANTERN guide;
- an editor for one entry: description, level, §1.4 reason categories, reason explanation and declassification instruction;
- an **error summary** at the top. Each link in it moves focus to the field with the problem;
- **inline errors** next to each field.

The errors come from a real OpenSCG `validate()` call. To trigger them, we deleted the reason and the declassification instruction from LANTERN's Secret entry `perf-range`. OpenSCG then reports:

| Code | Severity | Pointer | Shown as |
| --- | --- | --- | --- |
| OSCG-V010 | error | `/entries/2/reason` | Error on the categories group |
| OSCG-V013 | error | `/entries/2/declassification` | Error on the declassification select |
| OSCG-V046 | policy_review | `/document_markings/review` | A separate "Needs a person to review" note, **not** an error |

Each finding's JSON pointer is mapped to a form field. The message shown is our own plain-language text, keyed by that field. We did this because OpenSCG's structural messages come straight from the schema library. For example, an empty description produces `Schema check "minLength" failed: must NOT have fewer than 1 characters.` That is accurate, but it is not written for an author.

## How to run it

```bash
npm ci
```

```bash
npm test
```

`npm test` builds both variants, starts a local server on 127.0.0.1, runs every check in the preinstalled Playwright Chromium, and writes `results.json` and `screenshots/`. To look at the pages yourself:

```bash
npm run build && npm run serve
```

Then open `http://127.0.0.1:8077/`.

`test/ajv-standalone-check.mjs` is a separate check of the precompiled-validator option (see below):

```bash
node test/ajv-standalone-check.mjs
```

## Results

Both variants passed every automated check.

| Check | USWDS | Plain HTML |
| --- | --- | --- |
| axe-core violations (initial page, with errors, after fixing) | 0, 0, 0 | 0, 0, 0 |
| axe-core "needs review" items | 2 (`color-contrast` on the two selects; axe cannot read the background behind USWDS's arrow icon) | 0 |
| Tab order: skip link, entry list, then fields in reading order, then button | Yes | Yes |
| Submit with Enter moves focus to the error summary | Yes | Yes |
| Each summary link moves focus to its field | Yes. Categories go to the first checkbox; declassification goes to the select | Yes |
| `aria-invalid="true"` on the failing control | Yes | Yes |
| Error message linked with `aria-describedby` (on the fieldset for checkbox groups) | Yes | Yes |
| Error id removed from `aria-describedby` after a fix | Yes | Yes |
| Fixing both problems with the keyboard alone, then re-checking, clears all errors | Yes | Yes |
| No horizontal scrolling at 320 CSS px (WCAG 1.4.10 reflow) | Yes | Yes, after one fix (below) |
| Requests to any other origin | 0 | 0 |
| Content Security Policy violations (server validation mode) | 0 | 0 |
| Files loaded | 9 | 3 |
| Bytes loaded | 784 KB (USWDS CSS 527 KB, 3 fonts, 2 icons, our 185 KB script) | 195 KB (almost all our script) |
| USWDS assets we must ship (CSS, fonts, images) | 18 MB on disk; the page uses a small part | — |
| Markup and CSS we wrote | 112 lines of HTML, 3 lines of CSS | 103 lines of HTML, 40 lines of CSS |

Our script is 180 KiB minified for both variants. Almost all of it is OpenSCG's validator (ajv and the embedded schema). The first build was 599 KiB, because a dynamic `import()` stopped the bundler from dropping the signing code (`pkijs`). A plain static import fixed that.

### Problems the tests found in the plain variant

Each of these was a one-line CSS fix. Each is also a mistake USWDS had already solved for us:

- A long select option made the whole layout wider than 320 px. Fix: `min-width: 0` on grid children, and `width: 100%` on selects.
- Our `.hint { display: block }` overrode the `hidden` attribute, so a note that should be hidden was showing. Fix: `[hidden] { display: none !important }`.
- A checkbox next to a long label shrank. Fix: `flex: none`.

We found the third one by looking at the screenshot. No automated check caught it.

### Things we learned that apply to either variant

- **`aria-describedby` still reads hidden elements.** Hiding an error message is not enough. The code has to remove the message's id from `aria-describedby` as well. The test checks this.
- **USWDS has no error summary component.** We built one from its error alert (`usa-alert--error`), with `role="region"`, `tabindex="-1"` and a heading. The first version had no role, and axe flagged `aria-labelledby` on a plain `div` as needing review.
- **Do not use the USWDS ".gov banner".** It tells people the site is an official government website. Imprint is not one, so we used a "Synthetic data only" alert instead.
- **Range levels need their own control.** LANTERN's `perf-band` uses a level range with conditions. A single level select cannot show that, so the spike only notes it. A real editor needs this control.

## Does validation in the browser need `'unsafe-eval'`?

**Yes, with OpenSCG 0.1.0 as published.**

Under `script-src 'self'`, the first call to `validate()` in the page fails like this:

> `EvalError: Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script: script-src 'self'`

The cause: ajv compiles the schema into JavaScript at run time, using `new Function`. The same page works when the policy adds `'unsafe-eval'`. We do not want to allow that.

There are two ways around it:

1. **Validate on the local server (tested, works).** The page posts the guide to `POST /api/validate`. The server runs `parseStrict()` and `validate()` and returns the findings. The page then runs under the strict policy with no violations. This is also where requirements §7 wants untrusted input checked ("on the server/trusted process"). The cost is a round trip to localhost for each check. That cost is too small to notice here.
2. **Precompile the schema (tested, works for structure only).** ajv's standalone mode compiles the OpenSCG schema ahead of time, with the same options OpenSCG uses. The result is a 128 KB bundle with no `new Function` or `eval`. It accepts LANTERN, and it rejects an empty description at `/entries/2/description`. However, OpenSCG's `validate()` has no way to use a precompiled validator, and structural messages would come from our code rather than OpenSCG's. Doing this properly needs a change in OpenSCG (see open question 6 in `docs/open-questions.md`).

## Recommendation

**Use USWDS, and run validation on the local server.**

- Every check passed in both variants, but USWDS got there with no layout bugs. In the plain variant we hit three bugs in 40 lines of CSS. More screens would mean more of them.
- Federal users know its patterns, and its components are built and tested against Section 508.
- It costs about 0.6 MB more per page and 18 MB in the install. That is acceptable for an app served from a local or in-boundary server, and npm mirrors make the package easy to get.
- Ship only the USWDS files the pages use, rather than the full 18 MB folder. Compiling USWDS from its Sass sources would shrink the CSS further.

For OpenSCG: ask the maintainers to export a precompiled structural validator, or a way to pass one in. Then validation could also run in the page under a strict policy.

## What would change this

- **If practitioners find USWDS looks too much like a public government website** for a tool used inside agencies, plain HTML is a fine fallback. Budget for writing and testing our own CSS.
- **If OpenSCG ships an eval-free validator,** we can validate in the page as well. Example: live checks as the author types, without a server round trip.
- **If a screen-reader user finds problems** that automated tools missed (see below), they may change which approach is less work.

## What these tests cannot tell us

Automated tools and a scripted keyboard pass catch only part of the problems. These still need people:

- **Screen readers.** Test with NVDA and JAWS on Windows, and VoiceOver on macOS. Check that the error summary is announced when it receives focus, that each field's hint and error are read in a sensible order, and that the entry list's "(2 problems)" text is clear. Ideally the tester uses a screen reader every day.
- **Colour contrast of the USWDS selects.** axe could not measure these. Check them by hand, or with a contrast tool.
- **Zoom to 200% and 400%,** and Windows High Contrast (forced colours) mode.
- **Speech input** (for example Dragon). Check that visible labels match the controls' accessible names, so spoken commands work.
- **Wording.** Whether practitioners understand "Needs a person to review" and the field messages (spike SP-08).

## Versions

| Package | Version |
| --- | --- |
| `@knitli/openscg` | 0.1.0 (exact) |
| `@uswds/uswds` | 3.14.0 (exact) |
| `axe-core` | 4.14.0 (exact) |
| `esbuild` | 0.28.2 (exact) |
| ajv (via OpenSCG) | 8.20.0 |
| Playwright (preinstalled) | 1.63.0 |
| Chromium (preinstalled) | 153.0.8010.12 |
| Node.js | 22.23.4 |

## Files

| Path | What it is |
| --- | --- |
| `src/app.js` | Shared behaviour: maps findings to fields, renders errors, handles focus |
| `src/variant-*.js` | The CSS class names for each variant |
| `src/categories.txt` | The E.O. 13526 §1.4 category labels |
| `public/uswds.html`, `public/plain.html` | Hand-written markup for each variant |
| `public/plain.css`, `public/uswds-extra.css` | The CSS we wrote |
| `build.mjs` | Bundles the scripts with esbuild and copies the USWDS assets |
| `serve.mjs` | Local server: strict policy, plus `POST /api/validate` |
| `test/run.mjs` | All browser checks |
| `test/ajv-standalone-check.mjs` | Precompiled-validator check |
| `results.json` | Output of the last test run |
| `screenshots/` | Initial, errors, fixed and 320 px views of each variant, plus the blocked-validator page. Taken at 2× pixel density |

We chose esbuild over a framework or Vite because two static pages need only one bundling step. A single dependency is also easy to mirror. The spike is meant to compare markup and CSS, not frameworks.
