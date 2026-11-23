# Contributing to Monstertrade

Use Node.js 24 (see `.nvmrc`) and install the committed dependency versions with `npm ci`. The browser app is buildless: the files in `dist/` are source files and must be committed. The Worker and D1 migrations live in `worker/` and `migrations/`.

## Development and checks

```sh
npm ci
npm run db:migrate:local
npm run dev:cloudflare
```

Before opening a pull request, run the same checks as CI:

```sh
npm run check
npm test
npm run test:smoke
npm run check:deploy
```

The smoke test uses an isolated local database. These commands need no Cloudflare credentials and do not publish the app. For interface changes, also check the relevant desktop and mobile flows in a browser. The test suite does not replace visual testing.

Create a short-lived branch from `main`, make a focused change, and open a pull request explaining the resulting behavior and validation. Keep the lockfile when changing dependencies. GitHub Actions runs the `CI` workflow with the `Checks` job for pull requests and pushes to `main`.

## Data and deployment changes

- Preserve the browser storage keys, existing row identities, and JSON/CSV compatibility. Test migrations and failed imports without overwriting personal data.
- The Worker stores public catalogue prices only. Do not send holdings, purchase costs, grading, or personal valuations to the service.
- New D1 migrations are numbered, additive where possible, and tested against a fresh database and the previous schema. Do not edit an already applied migration; add a new one.
- Review deployment and schema changes together. Rolling back Worker code does not roll back a database migration; favor schema changes that the previous Worker can still read.
- Keep source dates, missing values, and provider errors explicit. Do not synthesize prices or infer a product variant from an unreviewed mapping.
- Keep credentials, local database files, personal exports, and assistant metadata out of Git. `.gitignore` covers local `.env*`, `.dev.vars*`, `.wrangler/`, `.openai/`, `.codex*` directories, and preview evidence.

Production deployment is configured separately from CI; see [README.md](README.md#github-actions-and-production-setup). A passing dry run alone does not prove that a remote database or scheduled invocation is healthy.

## Repository settings

Use `main` as the default branch, squash merges, and automatic deletion of merged branches. Where the repository plan supports branch protection or rulesets, require pull requests, the `Checks` status, resolved conversations, and an up-to-date branch; block branch deletion and force pushes. A sole maintainer should not require an approval that nobody else can provide. Add reviewer requirements when a reviewer is available.

Workflow files do not enable these settings by themselves. Confirm the rules in GitHub's repository settings. Keep Actions' default token permission read-only and restrict production deployments to `main`. Dependabot checks npm and GitHub Actions weekly; review and merge its pull requests through the same checks.

## Reports and rights

Use the issue templates for reproducible bugs or feature requests. For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of posting sensitive details in an issue.

The app being free to use is not a source-code license or permission to redistribute its logo, card artwork, or product photos. Preserve attribution and existing third-party notices. A project source license must be chosen explicitly by the owner.
