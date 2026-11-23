# Security policy

Security fixes target the latest code on `main`. Older deployments should update before reporting an issue that may already be fixed.

## Reporting a vulnerability

Do not include credentials, personal collection exports, private account details, or a working exploit in a public issue. If this repository offers **Security → Report a vulnerability**, use that private channel. Otherwise contact the repository owner privately through an established contact channel; if none is available, open an issue asking for a private reporting channel without disclosing the vulnerability.

Include the affected commit or deployment, a concise impact description, and reproduction steps using synthetic data. Mention whether the issue concerns browser storage, JSON/CSV imports, the public price API, remote images, or deployment. No response deadline or bounty is promised.

## Boundaries

Personal holdings and valuations live in browser storage. The Cloudflare database holds public prices, source identifiers, refresh state, and public price history. Price providers and remote image hosts receive the public requests required to serve their content. Collection export files contain personal data and should not be attached to issues.

Keep Cloudflare tokens in GitHub Actions repository secrets or the local shell, never in commits. If a credential is exposed, revoke or rotate it with its issuer and review its use; deleting a file from the latest commit does not remove it from Git history.

Third-party catalogue or price errors can be reported as ordinary bugs with public product IDs and source dates. A wrong or stale market price is not, by itself, a security vulnerability.
