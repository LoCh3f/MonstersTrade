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
npm run check:deploy:staging
```

The smoke test uses an isolated local database. These commands need no Cloudflare credentials and do not publish the app. For interface changes, also check the relevant desktop and mobile flows in a browser. The test suite does not replace visual testing.

Create normal working branches from `develop` and target `develop` in pull requests. Use a supported prefix such as `feature/`, `fix/`, `docs/`, or `ci/`; [Git Flow](docs/GIT_FLOW.md) lists all routes and release commands. Keep the lockfile when changing dependencies. CI requires both `Checks` and `Git Flow` for pull requests and protected branch updates. Once activated on `main`, the independent Git Flow commit status runs from a reviewed immutable policy pin; [activation and trust boundaries](docs/GIT_FLOW.md#trusted-policy-and-activation) explain the rollout and required status verification.

Use Conventional Commits, for example `fix(prices): retain the previous quote after a failed refresh`. Each commit should contain one coherent, meaningful change. Split unrelated work, but keep changes that depend on each other together. PR titles and every newly introduced commit subject must follow the same convention. Use merge commits to preserve this history; squash and rebase merging are disabled.

## Data and deployment changes

- Preserve the browser storage keys, existing row identities, and JSON/CSV compatibility. Test migrations and failed imports without overwriting personal data.
- The Worker stores public catalogue prices only. Do not send holdings, purchase costs, grading, or personal valuations to the service.
- New D1 migrations are numbered, additive where possible, and tested against a fresh database and the previous schema. Do not edit an already applied migration; add a new one.
- Review deployment and schema changes together. Rolling back Worker code does not roll back a database migration; favor schema changes that the previous Worker can still read.
- Keep source dates, missing values, and provider errors explicit. Do not synthesize prices or infer a product variant from an unreviewed mapping.
- Keep credentials, local database files, personal exports, and assistant metadata out of Git. `.gitignore` covers local `.env*`, `.dev.vars*`, `.wrangler/`, `.openai/`, `.codex*` directories, and preview evidence.

Staging and production deployments are configured separately from CI; see [README.md](README.md#github-actions-and-production-setup). Staging uses a separate public Worker and D1 database, with shared account credentials. A passing dry run alone does not prove that a remote database or scheduled invocation is healthy.

## Repository settings

Keep `main` as the default branch. Allow merge commits only, using the PR title as the merge commit title. Disable automatic branch deletion: retain release/hotfix branches until `main` has been merged back into `develop`, then remove completed short-lived branches. Never delete `main` or `develop`.

Protect both `main` and `develop` with required pull requests, `Checks` and `Git Flow`, an up-to-date branch, resolved conversations, and no bypass, force pushes, or deletion. Do not require linear history: Git Flow needs merge ancestry. A sole maintainer need not require an approval that nobody else can provide; add reviewer requirements when a reviewer is available.

Workflow files do not enable these settings by themselves. Confirm the rules in GitHub's repository settings. Keep Actions' default token permission read-only. Production accepts only `main`; staging accepts only `develop`. The separate production tagging job alone needs `contents: write`. The metadata-only trusted PR policy has `statuses: write` to report its result; it never runs PR code. Keep `GIT_FLOW_POLICY_SHA` pinned to a reviewed policy commit and keep fork tokens read-only. Changes to policy files require an explicit review and pin update, not just a passing test.

Dependabot checks npm and GitHub Actions weekly and targets `develop` for version updates. Security updates still use GitHub's default branch, `main`: move the patch through a versioned `hotfix/X.Y.Z` branch and the normal checks instead of bypassing branch routing.

## Reports and rights

Use the issue templates for reproducible bugs or feature requests. For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of posting sensitive details in an issue.

The app being free to use is not a source-code license or permission to redistribute its logo, card artwork, or product photos. Preserve attribution and existing third-party notices. A project source license must be chosen explicitly by the owner.
