# Git Flow

`main` is the default branch and deploys production. `develop` integrates work and deploys public staging. Use native Git commands; the git-flow extension is not required.

## Branch routes

| Branch | Start from | PR target |
| --- | --- | --- |
| `feature/*`, `fix/*`, `docs/*`, `chore/*`, `ci/*`, `build/*`, `refactor/*`, `perf/*`, `test/*`, `style/*` | `develop` | `develop` |
| `dependabot/*` version updates | `develop` | `develop` |
| `release/X.Y.Z` | `develop` | `main` |
| `hotfix/X.Y.Z` | `main` | `main` |
| `fix/*`, `docs/*`, `chore/*`, `ci/*`, `test/*` for stabilization | The release/hotfix branch being prepared | That `release/X.Y.Z` or `hotfix/X.Y.Z` branch |
| `main` after a release/hotfix | Existing `main` | `develop` |
| `sync/*` for sync conflicts | `develop`, then merge current `main` | `develop` |

Release, hotfix, and sync branches must belong to this repository. A sync branch must include the current `main` commit. Both protected branches require `Checks`, `Git Flow`, an up-to-date PR, and resolved conversations, with no bypass. Force pushes and deletion are blocked; linear history is not required.

PR titles and all newly introduced commit subjects use Conventional Commits, including merge commits. Keep commits small and coherent. Merge PRs with **Create a merge commit**; its title comes from the PR title. Squash and rebase merging are disabled because they discard the ancestry used by this workflow. Existing historical commits are not rewritten.

## Everyday work

Start from the latest integration branch:

```sh
git fetch origin
git switch -c feature/collection-filter origin/develop
# Make one coherent change, then stage its files.
git add dist/app.js
git commit -m "feat(collection): add a sealed-product filter"
git push -u origin feature/collection-filter
```

Open the PR against `develop`, explain the result, and record validation. If `develop` advances, merge it into your branch with a conventional message:

```sh
git fetch origin
git merge --no-ff -m "chore: merge develop into collection filter" origin/develop
git push
```

After the PR merges and CI succeeds on the latest `develop`, CD deploys [staging](https://monstertrade-staging.loch3f.workers.dev) when enabled. Review the affected flows there. Staging has separate public price data; browser collections are also separate because its origin differs from production.

## Releases and hotfixes

A release name uses stable SemVer with no prefix or prerelease suffix: `release/1.0.1`. Its version must match `package.json`, the top-level `package-lock.json` version, and `packages[""].version` in that lockfile. It must be numerically greater than the version on `main`. Choose the next appropriate version; `1.0.1` is the initial Git Flow release example:

```sh
git fetch origin
git switch -c release/1.0.1 origin/develop
npm version 1.0.1 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore(release): prepare 1.0.1"
git push -u origin release/1.0.1
```

Open `release/1.0.1` → `main` with a conventional title such as `chore(release): release 1.0.1`. The branch must include current `main`; merge `origin/main` into it with a conventional merge subject if necessary, then resolve conflicts and rerun checks. Changes needed to make a release ready should be small, focused commits on the release branch, or PRs from a stabilization branch listed above. Start a stabilization branch from its target release/hotfix branch; general feature work continues through `develop`.

For an urgent production fix, create `hotfix/X.Y.Z` from `origin/main`, commit the fix, then update and commit both version files as above. A hotfix keeps `main`'s major/minor and advances its patch number. For example, `main` at `1.0.1` can receive `hotfix/1.0.2`. Open the hotfix PR against `main`.

After merging, successful CI on the latest `main` triggers production deployment when enabled. CD checks for a conflicting version tag before deployment. Only after deployment and its health check succeed does the tagging job create `vX.Y.Z` at the exact deployed SHA. An existing tag at that SHA is safe to retry; a tag at a different SHA is an error and must never be force-moved. A later production change needs a new release/hotfix version.

If CI, migration, deployment, health checking, or tagging fails, inspect the failed job before retrying. A retry must still refer to the latest target branch. A successful D1 migration remains applied even if publication fails; keep migrations compatible with the previous Worker. A failed tagging job can be retried after checking the deployment and tag state.

Dependabot security updates target the default branch even though version updates target `develop`. Bring a security patch into a versioned hotfix and follow this route; do not bypass the PR branch checks.

## Synchronize after production

After each release/hotfix, open `main` → `develop` with title `chore: sync main into develop`. Merge it using a merge commit after the required checks pass. This preserves the release version and any production fixes in integration history.

If that PR conflicts, create a conflict-resolution branch from `develop` and include current `main`:

```sh
git fetch origin
git switch -c sync/release-1.0.1 origin/develop
git merge --no-ff -m "chore: sync main into develop" origin/main
# If conflicts occur, resolve and stage the affected files, then:
# git commit -m "chore: sync main into develop"
git push -u origin sync/release-1.0.1
```

Open this same-repository `sync/*` branch against `develop`. If `main` advances meanwhile, merge its latest revision again. After synchronization completes, delete the completed release/hotfix/sync branches manually. Never delete `main` or `develop`; automatic branch deletion is disabled so it cannot remove a branch still needed for synchronization.

## Deployment controls

The [README setup table](../README.md#github-actions-and-production-setup) lists the repository secrets and variables. Production and staging share deployment credentials but use separate Workers and D1 databases. PR checks and other branch runs receive no cloud credentials.

| Target | Required branch | Automatic flag | Database variable | Health URL variable |
| --- | --- | --- | --- | --- |
| `production` | `main` | `CLOUDFLARE_DEPLOY_ENABLED` | `CLOUDFLARE_DATABASE_ID` | `MONSTERTRADE_URL` |
| `staging` | `develop` | `CLOUDFLARE_STAGING_DEPLOY_ENABLED` | `CLOUDFLARE_STAGING_DATABASE_ID` | `MONSTERTRADE_STAGING_URL` |

Automatic deployment requires the corresponding flag to equal `true`, successful push CI, and the latest branch SHA. For manual runs, select **Actions → Deploy to Cloudflare → Run workflow**, then select the branch and matching `target` from the table. Manual runs repeat validation; mismatched branch/target combinations are rejected.

`npm run check:deploy` and `npm run check:deploy:staging` validate both bundles without credentials or publication. To deploy staging locally, supply both real database IDs and run `npm run deploy -- --staging --migrate`. The script rejects matching IDs to prevent staging from using production's price history. Production uses `npm run deploy -- --migrate`. Local deployment does not create the GitHub release tag; use CD for normal releases.
