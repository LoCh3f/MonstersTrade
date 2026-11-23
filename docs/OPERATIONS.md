# Operating the public price service

Collections and personal valuations stay in browser storage. Cloudflare holds only public prices and refresh metadata. A database restore does not recover a user's browser collection; users should keep JSON exports.

## Request limits and capacity

Production and staging have independent rate-limit namespaces. The general allowance is 120 requests per minute so one normal collection refresh of at most 100 items fits with navigation requests. New or retryable unconfirmed card lookups have a separate 10-per-minute limit. Requests beyond a limit receive HTTP 429 with `Retry-After`; clients retain previous prices.

The key is a hash of Cloudflare's client-IP header, used only by the rate-limit binding. Neither the address nor its hash is stored in D1 or operational logs. Shared networks can share an allowance. Cloudflare's [rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) are approximate and local to each Cloudflare location; they are not a strict worldwide quota. Both limiter bindings are required for deployed readiness.

The strict D1 upstream-call budget remains 1,000/day in production and 100/day in staging. Unconfirmed cards may use at most one quarter of that budget by default, reserving capacity for existing prices. `MAX_NEW_CARD_REQUESTS_PER_DAY` can override that allowance without exceeding the overall cap. Failed cards do not consume confirmed catalogue slots; at most 256 provisional/negative records are retained. When all confirmed slots are in use, new entries wait for inactive slots to expire.

Sealed searches use a bounded catalogue snapshot and indexed lookups for at most 24 selected products. Empty or out-of-range pages avoid product scans. A guarded repair handles a previous Worker updating the feed between migration and deployment. `tests/worker-runtime.test.mjs` measures actual local D1 reads, and `tests/backend-migrations.test.mjs` checks populated upgrades. Local timings do not establish production CPU usage or guarantee Free-plan capacity. Both databases still share account quotas.

## Diagnostics and releases

Wrangler enables sampled logs (10%) and traces (1%) with query-string redaction and automatic invocation logs disabled. Structured `public_price_service` events contain service/outcome and bounded numeric status/counter fields. They intentionally omit collection data, card identifiers, client addresses, provider bodies and raw error messages. Inspect Worker errors and D1 row usage in Cloudflare when refreshes fail or HTTP 429/503 responses increase. Sampled logs are not a complete audit trail.

Version preview URLs are disabled. The named production and staging workers.dev origins remain available. Keep this configuration in Wrangler so later deployments preserve it.

The deployment pipeline checks health and the full `deployCommit` SHA before tagging a production release. A healthy response from an older revision is not a successful rollout. Use the [Git Flow deployment controls](GIT_FLOW.md#deployment-controls) for the policy pin, environment restrictions and credential setup.

## Recovery

Keep migrations additive and compatible with the previous Worker. A migration is applied before code publication, so the previous code can still run briefly against the updated schema. A failed upload does not undo a migration.

D1 Time Travel is automatic: the Workers Free plan retains seven days, while this application can retain 365 days of price observations. Check the database and recovery timestamp before performing a restore; record the current bookmark so recovery can itself be reversed. Restoring D1 changes shared public prices, not local user collections. A Worker-version rollback does not restore D1. See [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) and [Worker rollback limitations](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

Enable administrator MFA, keep recovery codes private, and renew expiring environment credentials before their deadline. Worker-scoped Editor tokens reduce deployment privilege; direct D1 migration permissions and Worker bindings still need separate consideration when assessing isolation within one Cloudflare account.
