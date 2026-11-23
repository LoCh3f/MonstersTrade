# Working in Monstertrade

- Use Conventional Commits: `type(optional-scope): short description`. Keep each commit small, focused, and independently understandable. Split unrelated changes; keep dependent changes together.
- Follow [Git Flow](docs/GIT_FLOW.md). Normal work starts from and targets `develop`. Only versioned `release/X.Y.Z` and `hotfix/X.Y.Z` branches target `main`. Keep `main` as the default branch.
- Preserve merge ancestry. Use merge commits, never squash or rebase shared branches. Give local merge commits conventional subjects, such as `chore: sync main into develop`.
- Do not bypass the required `Checks` and `Git Flow` checks or push directly to protected branches. Synchronize `main` back into `develop` after releases/hotfixes; retain the release branch until synchronization completes.
- Use Node.js 24 and `npm ci`. `dist/` contains the browser app's source, not disposable build output. Follow [CONTRIBUTING.md](CONTRIBUTING.md) for validation and data compatibility.
- Keep collections and personal valuations in the browser. Cloudflare stores public price data only. Staging and production must use different D1 databases.
- Keep secrets, browser exports, local databases, and assistant metadata out of Git. Preserve the README animation and existing third-party attribution.
