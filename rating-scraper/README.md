# Amazon review scraper (`AmazonReviewScrapper.exe`)

Scrapes Amazon **product pages and review pages** for the ASINs in the VentaWiz
review queue (`GET /v1/scrapper/review-queries`) of the configured **store ids**,
and posts one result per product page to `POST /v1/scrapper/reviews`:

- the product's **rating** (`rating`) and total review count (`rating_count`)
- **critical reviews** (paged, up to `maxReviewPages`) as `critical_reviews: { reviews: [...] }`
- whether the page has **A+ content** (`aplus_content`: `yes` / `no`)
- the **delivery promise**, normalised to a day count (`delivery_promise_days`)

Each queue item carries `store_id`, `product_ids` (every listing the page
answers for) and `short_code`; the first two are copied verbatim into the
result. A `404` means a product id is not a focused listing of that store and
is reported as `[FAIL]`.

Part of the **Amazon** bundle, alongside
[`amazon-ads-scraper/`](../amazon-ads-scraper/). Normally launched by
the VentaWiz agent rather than run by hand — see the
[root README](../README.md).

## Delivery promise days

Amazon renders the promise as free text in the storefront's own language
("FREE delivery Thursday, 21 August", "Entrega GRATIS el jueves, 21 de agosto",
"Lieferung Donnerstag, 21. August"). [`src/delivery.ts`](src/delivery.ts) parses
it and reports a whole number of days:

```
deliveryPromiseDays = promisedDeliveryDate − today
```

So `1` is tomorrow and `0` is same-day. When the page shows no readable promise
the value is `null` — deliberately not `0`, so zero keeps its literal meaning.

## Run it

```bash
npm install
npm run dev          # from source
npm run setup        # re-run the first-run login only
npm run build:exe    # -> dist/AmazonReviewScrapper.exe
```

A standalone first run opens a setup page for your email + VentaWiz **store
IDs** (whole numbers), then Amazon for a one-time sign-in. When the agent
launches it with `SCRAPE_STORE_IDS`, the setup page is skipped. **Set the delivery pincode while you're there** — the delivery
promise is location-dependent and will be wrong or missing without it.

## Service account

There is no shared token. Every VentaWiz call is authenticated with a
**VentaWiz service account** — `VW_CLIENT_ID` (`svc_…`) + `VW_CLIENT_SECRET`
(`vws_…`). [`src/api/auth.ts`](src/api/auth.ts) exchanges them for a
short-lived bearer token at `POST {VW_AUTH_URL}/v1/token` (OAuth
`client_credentials`), caches it until 60 s before expiry, and re-exchanges
once on a 401. When the agent launches this scraper it passes all three
variables; for a standalone run put them in `.env`. Missing credentials print
`[FAIL]` + `[DONE]` and the run exits without opening Chrome; a rejected
id/secret reads `client id/secret rejected — check the service account`, and a
403 reads `service account lacks scrapper:run`.

A VentaWiz admin creates the account in VentaWiz-Auth —
`POST /v1/service-principals?application=ventawiz` (the secret is shown **once**) — and grants it
`scrapper:run` with `POST /v1/grants` (`"application": "ventawiz"`), for every store or per store. See the
[root README](../README.md#2-credentials--ventawiz-service-accounts).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VH_API_ROOT` | `http://localhost:8000` (real host baked in at build time) | VentaWiz server root, no `/api` prefix |
| `QUERIES_API_URL` | `<root>/v1/scrapper/review-queries` | Where to fetch ASINs |
| `RESULTS_API_URL` | `<root>/v1/scrapper/reviews` | Where to post results |
| `VW_AUTH_URL` | `http://localhost:8100` (real host baked in at build time) | VentaWiz auth service root; token exchange is `POST /v1/token` |
| `VW_CLIENT_ID` | *(set by the agent)* | VentaWiz service account client id, `svc_…` |
| `VW_CLIENT_SECRET` | *(set by the agent)* | VentaWiz service account secret, `vws_…` — never commit it |
| `SCRAPER_PROFILE_DIR` | `%LOCALAPPDATA%\AmazonReviewScraper\chrome-profile` | Chrome profile holding the login |
| `SCRAPE_STORE_IDS` | *(from `user-settings.json`)* | Comma-separated VentaWiz store ids, e.g. `13,16` |
| `SCRAPE_MARKETPLACE` | `amazon` | Sent as `marketplace=` on the queue request |
| `SCRAPE_SHORT_CODES` | *(all)* | Optional local filter on `short_code`, e.g. `AZUS,AZUK` |
| `BROWSER_VISIBLE` | `0` | `1` shows the browser window |
| `SCRAPE_DELAY_MS` | `5000` | Pause between products |
| `DEFAULT_AMAZON_DOMAIN` | `amazon.in` | Domain used for the first-run login |

The agent sets the API URLs, auth URL, service account, store ids, marketplace, profile dir and
browser visibility itself when it launches this scraper.

## Marketplaces

Same 16 Amazon short codes as the ads scraper, defined in
[`src/marketplaces.ts`](src/marketplaces.ts):

```
AZIN AZUS AZUK AZAU AZCA AZDE AZFR AZIT
AZES AZNL AZBE AZMX AZPO AZSW AZAE AZSA
```

## Output markers

`[OK]` / `[FAIL]` per product and a final `[DONE]`. The agent parses these to
classify a run — don't change them without updating
`ventahub-agent/src/spawn.ts`.
