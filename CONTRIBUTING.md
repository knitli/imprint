# Contributing to Imprint

Thank you for helping. Imprint is at an early stage: we are researching and running small experiments before building the application. That is a good time to question assumptions.

## The one rule that matters most

**Use invented data only.** Never post real, controlled or classified information anywhere in this project: code, tests, examples, issues, pull requests, commit messages or screenshots. That includes guide titles, entry text, organization names, people's names and certificate details. Do not copy restricted government templates or forms.

If you are not sure whether something is safe to share, do not share it. Ask first, in general terms.

## Ways to help now

- **Practitioners:** tell us whether our vocabulary and examples match how SCGs are really written and approved. See [`docs/open-questions.md`](docs/open-questions.md).
- **Developers:** pick up a spike in [`docs/research/README.md`](docs/research/README.md). Open an issue first so work is not duplicated.
- **Accessibility testers:** we especially want people who use screen readers or keyboard-only navigation every day.

## How work is organized

- **Requirements** live in [`docs/requirements/`](docs/requirements/). Each piece of work should name the requirement IDs it serves, for example `M-07`.
- **Spikes** live in [`spikes/`](spikes/). Each answers one question and ends with a short write-up.
- **Design choices** are recorded in [`docs/decisions/`](docs/decisions/). If your pull request makes or reverses one, add a record.
- **Format and schema questions** belong in the [OpenSCG repository](https://github.com/knitli/OpenSCG), not here.

## Pull requests

1. Branch from `main`.
2. Keep each pull request to one change.
3. Say what you checked and what you did not.
4. Fill in the checklist in the pull request template.

## Writing style

Write for a busy reader who may not be a developer and may use assistive technology.

- Use plain words and short sentences.
- Say what something does before how it works.
- Give a concrete example.
- Never describe a validation result, a signature or an export as "compliant", "approved" or "certified". Say exactly what was checked.

## Tooling

- Node.js 22 or later (see `.nvmrc`).
- Pin dependencies to exact versions. Each new dependency should be justified in the pull request, because every package has to be mirrored and reviewed for offline installs.
- The editor settings in `.editorconfig` apply to all files.

## Contributor License Agreement

By submitting a contribution you agree to the [Contributor License Agreement](CLA.md). If you contribute on behalf of an employer, make sure they agree before you submit.

## Code of conduct

Be respectful and assume good faith. Harassment or personal attacks are not tolerated. Report problems to the maintainers at the contact in [CLA.md](CLA.md).
