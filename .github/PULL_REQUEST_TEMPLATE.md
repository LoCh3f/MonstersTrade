## Change

Describe the problem and the resulting behavior. Link a related issue when useful.

## Git Flow

- [ ] The PR title and new commit subjects use Conventional Commits; each commit is small and focused.
- [ ] Normal work targets `develop`; `release/X.Y.Z` and `hotfix/X.Y.Z` target `main`.
- [ ] For a release/hotfix, the branch version matches `package.json` and both lockfile versions, and advances `main` (hotfix: patch only).

Merge with a merge commit. After a release/hotfix, merge `main` back into `develop` before deleting its branch. See [Git Flow](https://github.com/LoCh3f/MonstersTrade/blob/main/docs/GIT_FLOW.md).

## Validation

Record the checks you ran and their result. For UI changes, describe the desktop/mobile flows checked; use screenshots with synthetic data only.

## Deployment and compatibility

Mention any D1 migration, browser data/import change, new configuration, or provider mapping. If none, write “None.” Explain the rollback implications of schema changes.
