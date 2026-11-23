# DarkDex inspection and PocketVault scope

Inspected on **23 November 2026**. The review covered public pages and visible product previews; it did not access an authenticated DarkDex collection or verify its internal implementation.

## Public reference

| Source | Observation |
| --- | --- |
| [DarkDex homepage](https://darkdex.app/) | Pokémon collection dashboard, searchable catalogue, market value versus cost, wishlists, binders, and set progress. The presentation uses a dark interface with card artwork and value summaries. |
| [Plans](https://darkdex.app/pricing) | A free tier limited to 150 cards and one binder; paid tiers advertise expanded collection and import/export capabilities. Plan details and launch offers can change. |
| [Pokémon catalogue](https://darkdex.app/pokemon) | Public sets grouped by series, with card counts and links to card lists. |

DarkDex advertises multi-source, AI-assisted valuation and notifications. These are claims on the public site, not mechanisms independently validated by this review. Its logged-in screens, backend, and source code were not copied.

## Independent implementation

| Area | PocketVault |
| --- | --- |
| Collection | Browser-local add/edit/remove, quantities, purchase costs, condition, and binders; no subscription card limit. |
| Catalogue | TCGdex search and details, including language selection supported by the UI. |
| Valuation | Explicit Cardmarket EUR trend references via TCGdex, with source dates. No proprietary AI model or condition/grade adjustments. |
| Wishlist | Target price and in-app status; no background notifications. |
| Set progress | Distinct card counts against catalogue set totals; extra copies do not advance completion. |
| Transfers | CSV collection export/merge and complete JSON backup/replace, with UI undo. No native Excel workbook import. |
| History | Real daily local snapshots gathered during app use. No invented price history or background collection. |
| Accounts and special products | No accounts, cross-device sync, teams, or dedicated sealed/graded inventory. |

The first version reproduces the core collection workflow with its own name and implementation. It is not full DarkDex feature parity or a replacement for its proprietary data services.

## Free data feasibility

[TCGdex's FAQ](https://tcgdex.dev/faq) confirms no API key is required and no hard rate limits are published; clients should cache requests. A live response was checked for cross-origin access and returned `Access-Control-Allow-Origin: *`.

[TCGdex pricing documentation](https://tcgdex.dev/markets-prices) describes embedded Cardmarket EUR data with daily updates. Marketplace coverage, artwork, and prices can be missing; the FAQ also notes mapping accuracy limitations. PocketVault keeps missing prices unavailable and exposes provider dates. The live API supplied `variants_detailed`, although parts of the documentation still described that field as forthcoming.

The implementation uses documented [card search and pagination](https://tcgdex.dev/rest/filtering-sorting-pagination), [card details](https://tcgdex.dev/reference/card), and [image URLs](https://tcgdex.dev/assets). Six real card images and dated reference-price records are bundled for the initial experience. This is a small fallback snapshot, not an offline mirror of the catalogue.

The [TCGdex database repository](https://github.com/tcgdex/cards-database) is MIT licensed. Card artwork and Pokémon trademarks retain their original ownership; PocketVault uses independent branding and includes attribution.
