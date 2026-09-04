# VH-Scrappers

Monorepo for Dom Ventas' marketplace scrapers and the Windows agent that runs
them on employee laptops.

Three marketplaces — **Amazon**, **Flipkart**, **noon** — each with an *ads*
(search-term) scraper and a *review/rating* scraper, plus one **agent** per
marketplace that decides what to run and reports back to the backend.

---

## How it fits together

The agent is the only thing scheduled on a laptop. Everything else it launches.

```
Windows Task Scheduler (every 4h)
        │
        ▼
  VentaHubAgent*.exe ──POST /checkin──► backend   (declares its agentKind)
        │                                  │
        │            ◄──assignments────────┘      (which scrapers, which endpoints)
        ▼
  <marketplace> scraper .exe   ──► scrapes ──► POST results
        │
        └── stdout [OK] / [FAIL] / [DONE] ──► agent ──POST /runs──► backend
```

The agent passes the backend's endpoints down to each scraper as environment
variables, so **the marketplace API paths live on the server, not in the exes**.

### One agent per marketplace, and why

Chromium locks a persistent profile, so a single agent cannot hold signed-in
sessions for three sites at once. Each agent therefore gets its own Chrome
profile, home directory, device id, lock file and scheduled task. They run
independently and can share one folder on disk.

All three are built from *one* codebase, differing only by the
`EMBEDDED_AGENT_KIND` constant baked in at package time.

---

## What to install on a laptop

Install only the bundle(s) that laptop needs. Every bundle needs Google Chrome.

| Bundle | Agent | Ads scraper | Review scraper | Scheduled task |
| --- | --- | --- | --- | --- |
| **Amazon** | `VentaHubAgent.exe` | `search-term-scrapper.exe` | `AmazonReviewScrapper.exe` | `register-task.ps1` |
| **Flipkart** | `VentaHubAgentFlipkart.exe` | `flipkart-search-term-scrapper.exe` | `FlipkartReviewScrapper.exe` | `register-task-flipkart.ps1` |
| **noon** | `VentaHubAgentNoon.exe` | `noon-search-term-scrapper.exe` | `noon-review-scrapper.exe` | `register-task-noon.ps1` |

**Setup:**

1. Copy the bundle's files into one folder (e.g. `C:\VentaHub`).
2. Double-click the agent exe **once** — enter email + profile IDs, sign in to
   that marketplace, set the delivery pincode, close the tab.
3. Right-click the matching `register-task*.ps1` → **Run with PowerShell**.

Repeat per bundle. The token is baked into the agent exe, so no `.env` is
needed on a laptop.

---

## Repository layout

| Folder | What it is | Docs |
| --- | --- | --- |
| [`ventahub-agent/`](ventahub-agent/) | The launcher — builds all three agent exes | [README](ventahub-agent/README.md) |
| [`amazon-ads-scraper/`](amazon-ads-scraper/) | Amazon search-term / ads | [README](amazon-ads-scraper/README.md) |
| [`rating-scraper/`](rating-scraper/) | Amazon reviews + delivery promise | [README](rating-scraper/README.md) |
| [`flipkart ads scarpper-v1/`](flipkart%20ads%20scarpper-v1/) | Flipkart search-term / ads | [README](flipkart%20ads%20scarpper-v1/README.md) |
| [`flipkart scarpper rating-v1/`](flipkart%20scarpper%20rating-v1/) | Flipkart reviews + delivery | [README](flipkart%20scarpper%20rating-v1/README.md) |
| [`noon ads scrapper-v1/`](noon%20ads%20scrapper-v1/) | noon search-term / ads | [README](noon%20ads%20scrapper-v1/README.md) |
| [`noon review scrapper-v1/`](noon%20review%20scrapper-v1/) | noon reviews | [README](noon%20review%20scrapper-v1/README.md) |

> Four folder names contain spaces. Always quote them in shell commands:
> `cd "flipkart ads scarpper-v1"`.

---

# Developer guide

## 1. Pull the repo

```bash
git clone https://github.com/Dom-Ventas/VH-Scrappers.git
cd VH-Scrappers
```

Each package is independent with its own `node_modules` — there is no workspace
root. Install only what you're working on:

```bash
cd amazon-ads-scraper && npm install
```

Requires **Node 20** and **Google Chrome** (the scrapers drive the installed
Chrome; they do not download Chromium — `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`).

## 2. Credentials

There is **one** credential: the scrapper bearer token, which must match the
backend's `SCRAPPER_API_TOKEN`.

### Local development — use a `.env`

Never hardcode the token. Copy the example and fill it in:

```bash
cd ventahub-agent
cp .env.example .env
# edit .env: API_TOKEN=<token>
```

`.env` is gitignored in every package. At runtime `API_TOKEN` from the
environment always wins over anything baked into the exe, so a `.env` beside a
built exe overrides the build-time value — handy for pointing a release build at
a staging backend.

### Release builds — the token comes from a GitHub secret

Every package — the agent **and all six scrapers** — has a `src/embedded.ts`
committed with an **empty** token on purpose:

```ts
export const EMBEDDED_TOKEN = '';
export const EMBEDDED_API_ROOT = 'https://domventas.info/backend';
export const EMBEDDED_AGENT_KIND = 'amazon';
```

CI rewrites `EMBEDDED_TOKEN` in each package from the `SCRAPPER_API_TOKEN` repo
secret just before packaging, so all nine released exes are self-contained while
the token never enters source control. The build fails loudly if injection
doesn't take.

`EMBEDDED_API_ROOT` is **not** injected — it is committed, so changing the
backend host is a code change and a merge, not a workflow input. Each scraper
also commits its own `QUERY_ENDPOINT` / `RESULTS_ENDPOINT` paths.

Precedence at runtime is always: **environment > baked-in**. When the agent
launches a scraper it sets `QUERIES_API_URL`, `RESULTS_API_URL` and `API_TOKEN`
from the backend's assignment, and those win. The baked values are the fallback
that makes a scraper exe work when run on its own.

> **Never commit a real token to any `embedded.ts`.** If you paste one in to test a
> local build, revert the line before committing:
> `git checkout -- ventahub-agent/src/embedded.ts`.
> The file is tracked, so a careless `git add -A` puts the token in history
> permanently and it has to be rotated.

## 3. Build

Every package produces a Windows x64 exe via `pkg`, and cross-builds fine from
macOS or Linux.

```bash
# any scraper
cd amazon-ads-scraper && npm run build:exe

# all three agents at once
cd ventahub-agent && npm run build:exe:all
```

`build:exe:all` runs three full builds back to back. Each one rewrites
`EMBEDDED_AGENT_KIND`, recompiles, then packages:

| Script | Kind baked | Output |
| --- | --- | --- |
| `build:exe:flipkart` | `flipkart` | `dist/VentaHubAgentFlipkart.exe` |
| `build:exe:noon` | `noon` | `dist/VentaHubAgentNoon.exe` |
| `build:exe` | `amazon` | `dist/VentaHubAgent.exe` |

Amazon is built **last** on purpose, so the working tree is left on the
committed default. An interrupted `build:exe:all` leaves `embedded.ts` stuck on
`flipkart` or `noon` — check `git diff` before rebuilding.

A `Failed to make bytecode … appIcon.png` warning during packaging is expected
and harmless; it is a Playwright asset, not code.

### Release via CI (preferred)

**Actions → "Build Windows Agent" → Run workflow →** enter a release tag.

The workflow injects the token once, builds all nine exes plus the three
PowerShell installers, and publishes them as a GitHub Release. Prefer this over
hand-assembling a release from local builds.

## 4. Testing without a Windows laptop

Run any package straight from source:

```bash
cd amazon-ads-scraper && npm run dev
```

To exercise an agent as a different marketplace without rebuilding, override the
baked constant:

```bash
cd ventahub-agent && VH_AGENT_KIND=flipkart npm run dev
```

This is for debugging only — in production, one exe means one marketplace.

## 5. The agent → scraper contract

Every scraper reads the same environment variables, so all six are
interchangeable from the agent's point of view. The agent sets these when it
spawns a child:

| Variable | Set by the agent to |
| --- | --- |
| `QUERIES_API_URL` | `apiRoot` + the assignment's `queryEndpoint` |
| `RESULTS_API_URL` | `apiRoot` + the assignment's `resultsEndpoint` |
| `API_TOKEN` | the agent's token |
| `SCRAPER_PROFILE_DIR` | the agent's shared Chrome profile |
| `BROWSER_VISIBLE` | `1` to show browser windows, else `0` |
| `SCRAPE_SHORT_CODES` | assignment's marketplace codes, when present |

These **override** each scraper's own defaults, so the backend controls which
endpoints and marketplaces a run targets.

The agent also derives run status from each scraper's stdout, counting `[OK]`
and `[FAIL]` lines and requiring a final `[DONE]`. **Any new scraper must emit
those markers** or its runs will be reported as `partial`.

### Adding a marketplace

Add the short code to that scraper's `src/marketplaces.ts`, then have the
backend include it in the assignment's `shortCodes`. An unknown code raises
`Unknown short_code` at runtime rather than scraping the wrong storefront.
