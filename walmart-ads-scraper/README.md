# Walmart ads scraper (`walmart-search-term-scrapper.exe`)

Scrapes Walmart (**www.walmart.com**) **search-result pages** for search terms
supplied by the VentaWiz backend (`GET /v1/scrapper/search-term-queries`),
reporting the sponsored and organic products found on page one
(`POST /v1/scrapper/search-term-results`).

Part of the **Walmart** bundle. Normally launched by a Walmart build of the
VentaHub agent rather than run by hand — see the [root README](../README.md).
The backend already reserves it: `walmart-ads` in `ventawiz/scrapper/catalog.py`
names this exe and is `enabled=False` until it ships.

**For a full step-by-step walkthrough see [HOW_TO_RUN.md](HOW_TO_RUN.md).**
This file is the quick reference.

## Run it

```bash
npm install
npm run dev-api      # one command: mock backend + full live scrape + summary
npm run dev          # from source, against the URLs in .env
npm run mock         # local mock backend on its own (port 8789)
npm run test:unit    # parsers, result mapping, sponsored retry — no browser
npm test             # everything, including two live walmart.com searches
npm run build:exe    # -> dist/walmart-search-term-scrapper.exe
```

First run opens a setup page for your email + VentaWiz **store IDs** (positive
integers), then walmart.com so you can set a delivery ZIP / store once (and
pass a "Robot or human?" check if one appears). When the agent launches the
scraper it passes `SCRAPE_STORE_IDS`, and no setup form is shown.

Each run fetches the whole queue for those stores once (paged, up to 50 store
ids per request), scrapes every term, and posts one result per term:
`{ store_id, search_term, products: [{ position, mp_product_id, is_sponsored,
price, rating, review_count, delivery_days, title }] }` — up to 5 sponsored + 5
organic, missing values `null`. An empty `products` is still posted. A 409
("already scraped today") counts as success.

## What is sent

```jsonc
{
  "store_id": 13, "search_term": "bluetooth headphones",
  "products": [
    { "position": 1, "mp_product_id": "79GOUUAPX3NP", "is_sponsored": true,
      "price": "USD 363.00", "rating": 4.6, "review_count": 4502,
      "delivery_days": 1, "title": "Bose QuietComfort Headphones ...",
      "item_id": "9744661583" }
  ]
}
```

How each field maps onto Walmart's tile:

| Field | Source on Walmart | Notes |
| --- | --- | --- |
| `mp_product_id` | the tile's `data-item-id` | Walmart's **wpid** (`79GOUUAPX3NP`), the id VentaWiz keys every Walmart listing by (`marketplace_listed_product.mp_product_id` = "wpid (walmart)"), so competitor rows match our own listings. `walmart.com/ip/<wpid>` opens the product. |
| `item_id` *(extra, ignored by the backend)* | the tile's `data-dca-id` | Walmart's numeric **item id** (`9744661583`), the id in the canonical URL. Falls back to the link's `link-identifier`, then the href. |
| `is_sponsored` | the "Sponsored" tag, or the `/sp/track?` ad-click href | Three independent signals; see below. |
| `title` | `[data-automation-id="product-title"]` | Full name; image alt and the link's `<h3>` back it up. |
| `price` | the screen-reader price line (`Price Now $20.99 Was $159.95 …`) | `Now` = current; `Was` is the struck-through old price and never wins. Re-emitted as `USD 20.99`. |
| `rating` | "4.6 out of 5 stars" screen-reader text | Else counted from the star icons. |
| `review_count` | `[data-testid="product-reviews"]`'s `data-value` | Unformatted number. |
| `delivery_days` | the tile's badge lines | Earliest delivery/shipping promise; **pickup lines are ignored**. See below. |

Measured on `bluetooth headphones` (top 20): 20/20 wpid, item id, title, price,
rating and review count; 17/20 delivery promise; 11/20 sponsored.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VH_API_ROOT` | `http://localhost:8000` (`src/embedded.ts`) | VentaWiz server root |
| `QUERIES_API_URL` | `${VH_API_ROOT}/v1/scrapper/search-term-queries` | Where to fetch search terms |
| `RESULTS_API_URL` | `${VH_API_ROOT}/v1/scrapper/search-term-results` | Where to post results |
| `SCRAPE_STORE_IDS` | *(from `user-settings.json`)* | Comma-separated store ids; set by the agent |
| `SCRAPE_MARKETPLACE` | `walmart` | Sent as `marketplace=` on the queue request |
| `VW_AUTH_URL` | `http://localhost:8100` (baked in by CI) | VentaWiz auth service root; tokens come from `POST /v1/token` |
| `VW_CLIENT_ID` | — (the agent passes it) | VentaWiz service account client id, `svc_…` |
| `VW_CLIENT_SECRET` | — (the agent passes it) | Its secret, `vws_…`. Never baked into the exe |
| `SCRAPER_PROFILE_DIR` | `%LOCALAPPDATA%\WalmartSearchTermScrapper\chrome-profile` | Chrome profile holding the location / bot-check cookies |
| `SCRAPE_SHORT_CODES` | *(all)* | Optional local filter on `short_code`, e.g. `WMUS` |
| `BROWSER_VISIBLE` | `0` | `1` shows the browser window |
| `SCRAPE_DELAY_MS` | `30000` | Pause between queries |
| `DEFAULT_WALMART_DOMAIN` | `www.walmart.com` | Host opened on first run |

These defaults come from `src/embedded.ts`, with the token and API root
injected at build time by CI. The agent still overrides all three from the
backend's assignment when it launches this scraper — environment always beats
baked-in.

## Marketplaces

Defined in [`src/marketplaces.ts`](src/marketplaces.ts). Short codes are the
backend's `com_marketplace.short_code` values, not invented here. VentaWiz
hands this scraper every store whose code starts with `WM`.

| Code | Storefront | Currency |
| --- | --- | --- |
| `WMUS` | www.walmart.com — "Walmart US", the only Walmart row today | USD |

An unknown code raises an error naming the valid codes. Adding walmart.ca or
walmart.com.mx is one line here — but re-verify the selectors first; they are
different sites.

## Sponsored detection

Walmart marks a paid grid placement three ways, and the scraper accepts any:

- a `[data-test-id="gpt-sponsored-tag-container"]` element, server-rendered;
- a node whose entire text is `Sponsored` (a real text node, unlike noon's SVG);
- the tile's main link going through the `/sp/track?` ad-click redirect.

`npx tsx scripts/check-sponsored.ts "<term>"` prints all three per tile and
counts disagreements. On the verification query all three agreed on 52/52
tiles (12 sponsored).

The **"Sponsored by \<brand\>"** banner above the grid is a Sponsored Brands
placement. Its tiles are excluded by scoping every selector to the results
grid (`[data-testid="item-stack"]`), which is what VentaWiz wants: only
sponsored products *in the grid* compete with a listing.

## Delivery: which badge counts

A tile carries several badge lines. Only delivery/shipping lines are read;
**pickup** lines are dropped; among the rest the earliest date wins:

| Badge | `delivery_days` |
| --- | --- |
| `Delivery as soon as 13 mins` (local express) | `0` |
| `Free shipping, arrives tomorrow` | `1` |
| `Shipping, arrives Wed, Oct 14` | `N` |
| `Shipping, arrives in 3+ days` | `3` |
| `Free pickup as soon as tomorrow` | ignored |
| `Save with` / `Low stock` / `Best seller` | not a delivery line |

The promise depends on the ZIP / store the session resolved to, which is why
the first run opens walmart.com for the user to set it; Walmart keeps the
choice in the persistent Chrome profile.

## Bot check

Walmart fronts the site with a "Robot or human?" press-and-hold check
(PerimeterX). It is intermittent and per session: in a five-term dev run one
term got it, the four around it did not. The scraper handles it like this:

1. The page is recognised by its **title / wording only** — the hidden
   `#px-captcha` container also sits on normal results pages and is not a
   signal.
2. A blocked term is polled for up to 45 s (the check often clears on its own,
   as it did in that run), then reloaded once, then failed with `BlockedError`.
3. After a blocked term the scraper waits an extra 60 s before the next one;
   after **three** blocked terms in a row it stops the cycle and leaves the
   rest of the queue for the next one (nothing was stored, so they stay due).

If a laptop keeps getting blocked, run once with `BROWSER_VISIBLE=1`, complete
the check in the scraper's own Chrome window, and raise `SCRAPE_DELAY_MS`; the
profile keeps the cleared state.

## Output markers

`[OK]` / `[FAIL]` per query and a final `[DONE]`, parsed by the agent to
classify the run. `[SPONSORED]` lines are diagnostics only (a page with zero
ads is re-checked once after 1.5 s).

## Still to wire up outside this folder

1. **Backend:** flip `walmart-ads` to `enabled=True` in
   `VentaWiz-Backend/src/ventawiz/scrapper/catalog.py` once the exe ships.
2. **Agent:** add a `walmart` kind to `ventahub-agent` (`AGENT_KINDS` in
   `src/config.ts`, the form label in `src/firstRun.ts`, a
   `build:exe:walmart` script and `install/register-task-walmart.ps1`). The
   backend already accepts `agent_kind=walmart` on check-in.
3. **CI:** add `walmart-ads-scraper` to the scraper loop and the release file
   list in `.github/workflows/build-windows-agent.yml`.
