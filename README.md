# Imprint

Imprint is an open, self-hostable application for writing, checking, signing and exporting **security classification guides (SCGs)**. It reads and writes [OpenSCG](https://github.com/knitli/OpenSCG), an open format for SCGs.

> **Status: early development.** You can write, check, freeze and import guides. Exports, signing and the UDS package are being built. Nothing here is ready for real use.

> **Imprint is not an official government tool, and it does not make classification decisions.** It helps people write and communicate guidance. It does not grant classification authority, approve a guide, or replace an agency's own processes. A guide that passes every check is complete and consistent, not approved. A valid signature proves who signed which bytes, not that the signer had authority.

## What Imprint will do

For one person working on their own machine, or a self-hosted server:

1. Start a guide, or import an OpenSCG file.
2. Write each entry in plain language: what the information is, its level, why, and when it can be declassified.
3. See exactly which fields are missing or inconsistent, and which items need a policy expert.
4. Preview the guide as JSON, PDF and a spreadsheet, all clearly labeled **DRAFT / NOT APPROVED**.
5. Freeze a revision and have the original classification authority sign it with the credential their organization already gave them.
6. Verify the signature and export matching files.

The full requirements are in [`docs/requirements/requirements.md`](docs/requirements/requirements.md).

## Run it

Needs Node.js 22.18 or later.

```bash
npm ci
```

Start the demo. It accepts only synthetic guides and keeps nothing after it stops:

```bash
IMPRINT_MODE=demo npm start
```

Then open http://127.0.0.1:8460/. To keep your guides, run `npm start` instead; they are saved in `./imprint-data`, or in the folder named by `IMPRINT_DATA`. The server listens only on your own machine unless you set `IMPRINT_HOST`.

To try it with an example, import `node_modules/@knitli/openscg/examples/synthetic-lantern.json` from the home page.

### Checks

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
npm test
```

End-to-end tests drive Chromium with the keyboard only and run axe-core on every page:

```bash
npm run test:e2e
```

## Where things are

| Path | What it is |
| --- | --- |
| [`src/core/`](src/core/) | Storage and the guide service: create, save, freeze, import |
| [`src/web/`](src/web/) | The local web server, forms and pages |
| [`test/`](test/) | Unit tests and end-to-end keyboard and accessibility tests |
| [`docs/requirements/`](docs/requirements/) | Requirements, the Git/UDS addendum, and a traceability table |
| [`docs/research/`](docs/research/) | The research and spike plan, with results so far |
| [`docs/decisions/`](docs/decisions/) | Decision records: what we chose and why |
| [`docs/open-questions.md`](docs/open-questions.md) | Questions that need someone outside the code to answer |
| [`spikes/`](spikes/) | Throwaway experiments. Not product code. |

## Relationship to OpenSCG

OpenSCG is a separate project with its own repository, license (Apache-2.0) and releases. Imprint uses a pinned OpenSCG release, currently **0.1.0**, and must pass its conformance suite ([decision 0002](docs/decisions/0002-pin-openscg.md)). You can use OpenSCG without Imprint. Report format or schema problems to the [OpenSCG repository](https://github.com/knitli/OpenSCG/issues).

## Synthetic data only

**Never put real, controlled or classified information in this repository, its issues or its pull requests.** That includes guide titles, entry text, people's names and certificate details. All examples must be invented and labeled as such. If you are unsure whether something is safe, leave it out and ask.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions are made under the [Contributor License Agreement](CLA.md).

## Security

Report security problems privately: see [SECURITY.md](SECURITY.md). Do not open a public issue.

## License

Imprint is currently licensed under the [GNU Affero General Public License v3.0](LICENSE). The final licensing approach, including a possible commercial license alongside AGPL, is still under legal review (requirements §9). "Imprint" is a working project name; no trademark clearance has been done.
