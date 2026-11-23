# PocketVault

A free Pokémon card collection app inspired by DarkDex's collection workflow, with independent branding and a dark interface. Runs locally without dependencies, registration, subscriptions, or a paid API key.

## Run

From this directory, using Node.js 22 or later:

```sh
node server.mjs
```

Open [PocketVault](http://127.0.0.1:4173). Set `PORT` to use another port. The server binds to your computer only. The `dist/` directory is also suitable for static hosting.

Run the offline unit tests:

```sh
node --test tests/*.test.mjs
```

## Features

- Search the public card catalogue and save cards with quantities, per-card purchase costs, condition, and binder.
- Edit collection entries, organize binders, and view collection value and cost.
- Save wishlist cards with target prices; see whether the latest stored estimate reaches a target while using the app.
- Track set progress by distinct card IDs rather than duplicate copies.
- Export collection rows to CSV or the complete state to JSON. CSV import merges rows; JSON restore replaces the collection, wishlist, binders, and history. Imports and card removals offer a temporary undo action, until another change is saved.
- Refresh available EUR reference prices and record real daily collection snapshots. No historical values are fabricated.

## Data and pricing

Card metadata and artwork come from [TCGdex](https://tcgdex.dev/). Market estimates use the positive EUR `pricing.cardmarket.trend` value, with its provider timestamp. Missing prices stay unavailable. Stored card condition does **not** adjust the estimate; graded values, sales fees, shipping, and taxes are not calculated. These estimates are not offers to buy or guaranteed resale values.

TCGdex documents daily Cardmarket updates, so refreshing repeatedly does not imply a newer price. The six featured cards contain a dated fallback snapshot and bundled artwork for the opening screen. Search and refresh require an internet connection. A failed refresh may leave the last stored estimate visible; check its date. See [TCGdex pricing](https://tcgdex.dev/markets-prices) and [coverage limitations](https://tcgdex.dev/faq).

Collection data is stored in this browser's local storage, per site address. It is not synced between devices, browsers, or different ports. Clearing browser storage removes it. Export a JSON backup before changing browsers or moving to another address; CSV covers collection entries only. Storage capacity is limited by the browser even though there is no subscription card limit.

Daily history begins when you use the app. It is a record of stored collection totals on those days, including additions, removals, and price refreshes—not a backfilled market performance series. Wishlist checks run in the app; there are no background push notifications.

## Scope and credits

This version has no accounts, cloud synchronization, team access, camera recognition, background price jobs, native Excel import, dedicated sealed/graded product tracking, or DarkDex's proprietary valuation system. The source-site review and feature comparison are in [INSPECTION.md](./INSPECTION.md).

TCGdex's [card database](https://github.com/tcgdex/cards-database) is MIT licensed. Pokémon names, card artwork, and related marks belong to their respective rights holders; the database license does not transfer ownership of those assets. PocketVault is independent of DarkDex, Nintendo, The Pokémon Company, and TCGdex. No DarkDex application source or branded artwork is bundled.
