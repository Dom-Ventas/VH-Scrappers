# Amazon review scraper (`AmazonReviewScrapper.exe`)

Scrapes Amazon **product pages and review pages** for ASINs supplied by the
backend, and reports back:

- the product's **rating** and total review count
- **critical reviews** (paged, up to `maxReviewPages`)
- the **delivery promise**, normalised to a day count

Part of the **Amazon** bundle, alongside
[`amazon-ads-scraper/`](../amazon-ads-scraper/). Normally launched by
`VentaHubAgent.exe` rather than run by hand — see the
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

First run opens a setup page for your email + profile IDs, then Amazon for a
one-time sign-in. **Set the delivery pincode while you're there** — the delivery
promise is location-dependent and will be wrong or missing without it.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `QUERIES_API_URL` | `…/backend/api/v1/scrapper/review-queries` | Where to fetch ASINs |
| `RESULTS_API_URL` | `…/backend/api/v1/scrapper/reviews` | Where to post results |
| `API_TOKEN` | *(baked in by CI)* | Bearer token; must match the backend |
| `SCRAPER_PROFILE_DIR` | `%LOCALAPPDATA%\AmazonReviewScraper\chrome-profile` | Chrome profile holding the login |
| `SCRAPE_SHORT_CODES` | *(all)* | Comma-separated filter, e.g. `AZUS,AZUK` |
| `BROWSER_VISIBLE` | `0` | `1` shows the browser window |
| `SCRAPE_DELAY_MS` | `5000` | Pause between products |
| `DEFAULT_AMAZON_DOMAIN` | `amazon.in` | Domain used for the first-run login |

The agent sets the first six itself when it launches this scraper.

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
