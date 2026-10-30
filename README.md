# VH-Scrappers

Monorepo for Dom Ventas' marketplace scrapers and the Windows agent that runs
them on employee laptops.

Three marketplaces — **Amazon**, **Flipkart**, **noon** — each with an *ads*
(search-term) scraper and a *review/rating* scraper, plus one **agent** per
marketplace that decides what to run and reports back to the **VentaWiz**
backend (`/v1/scrapper/...`).

---

## How it fits together

The agent is the only thing scheduled on a laptop. Everything else it launches.

```
Windows Task Scheduler (every 2h)
        │
        ▼
  VentaHubAgent*.exe ──POST /v1/scrapper/checkin──► VentaWiz
        │              (device_id, agent_kind, store_ids)  │
        │                                                  │
        │            ◄──assignments────────────────────────┘  (which scrapers, which endpoints)
        ▼
  <marketplace> scraper .exe ──GET  /v1/scrapper/search-term-queries | review-queries
        │                    ──POST /v1/scrapper/search-term-results | reviews
        │                       (?store_id=…&marketplace=…)
        └── stdout [OK] / [FAIL] / [DONE] ──► agent ──POST /v1/scrapper/runs──► VentaWiz
```

The unit of work is a VentaWiz **store id**, entered once per agent at first
run. The agent passes the store ids, the assignment's marketplace and the
backend's endpoints down to each scraper as environment variables, so **the API
paths live on the server, not in the exes**.

The task must run every **2 hours**: the server alternates ads and reviews per
2-hour UTC block (even blocks ads, odd blocks reviews), so a 4-hour schedule
would always land on the same kind and never run the other. When a check-in
fails, the agent replays its cached assignment only if it is from the last
cycle (≤ 2 hours old); otherwise it does nothing.

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
2. Double-click the agent exe **once** — enter email, VentaWiz **store IDs**
   (whole numbers, one per line or comma-separated) and the laptop's VentaWiz
   **service account**: **Client ID** (`svc_…`) and **Client secret** (`vws_…`),
   from a VentaWiz admin (see [Service accounts](#2-credentials--ventawiz-service-accounts)).
   Then sign in to that marketplace, set the delivery pincode, close the tab.
3. Right-click the matching `register-task*.ps1` → **Run with PowerShell**. It
   schedules that agent every 2 hours.

An agent upgraded from the VentaHub build asks for store IDs again on its next
run — the old AMS profile IDs are not store IDs. An agent upgraded from a
shared-token build asks again for the client ID + secret (email and store IDs
are pre-filled). Its device id is kept either way.

Repeat per bundle. No secret ships in any exe and no `.env` is needed on a
laptop: the service account entered at setup is stored in that agent's
`agent-config.json` under the user's `%LOCALAPPDATA%`.

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

## 2. Credentials — VentaWiz service accounts

There is no shared token any more — not in the backend, not in any exe, not in
CI. Each tenant gets a **VentaWiz service account** (a DV-Auth service
principal): a client ID `svc_…` and a client secret `vws_…`. A laptop's agent
holds one, and scrapes only that tenant's stores.

### How it works

1. The agent (or a standalone scraper) exchanges the credentials for a
   short-lived bearer token — OAuth `client_credentials`:
   `POST {VW_AUTH_URL}/v1/token` with
   `{"grant_type":"client_credentials","client_id":"svc_…","client_secret":"vws_…"}`
   → `{"access_token":"…","token_type":"Bearer","expires_in":600}`.
2. Every `/v1/scrapper/*` call carries `Authorization: Bearer <access_token>`.
   The backend takes the tenant from the token and requires the
   `scrapper:run` permission.
3. Each package's `src/api/auth.ts` (the agent's `src/auth.ts`) caches the
   token until 60 s before it expires and exchanges again; on a 401 from the
   API it re-exchanges once and retries once. A 401 from `/v1/token` means the
   client id/secret were rejected and is never retried; a 403 from the API
   means the account lacks `scrapper:run`.

The agent passes the **credentials** (not a token) to each scraper as
`VW_CLIENT_ID` / `VW_CLIENT_SECRET` / `VW_AUTH_URL`, because a scraper run
outlives a 10-minute token.

### Creating a service account (VentaWiz admin)

In VentaWiz-Auth (DV-Auth), as an admin **signed in to that tenant** (holding
`users:edit` and `grants:edit`). The admin calls act in the caller's tenant,
and the account's tokens carry it.

**Name the `ventawiz` application on both calls.** Left out, it defaults to the
caller's own application, which from the DV-Auth admin is `dv-auth`. The
account's tokens would then be addressed to DV-Auth, the VentaWiz backend would
answer every scraper call with 401, and `scrapper:run` could not be granted.

1. **Create the service principal** —
   `POST /v1/service-principals?application=ventawiz` with
   `{"display_name": "Scrapers — <client>"}`. The response contains the
   `principal_id`, the `client_id` (`svc_…`) and the `client_secret` (`vws_…`).
   **The secret is shown once** — copy it straight to whoever sets up the
   laptop; it cannot be read back later (create a new one if it is lost).
2. **Grant it `scrapper:run`** — `POST /v1/grants` with
   `{"application": "ventawiz", "principal_id": "<principal_id>",
   "subject_kind": "permission", "subject_ref": "scrapper:run"}`. With no
   scope it covers **every store** of the tenant; add
   `"scope_kind": "store", "scope_id": <store id>` (one grant per store) to
   limit it — any other store id then behaves as if it did not exist.

Then enter the client ID + secret in the agent's first-run form.

### Local development — use a `.env`

Copy the example and fill in a dev service account:

```bash
cd amazon-ads-scraper
cp .env.example .env
# edit .env: VW_CLIENT_ID=svc_…  VW_CLIENT_SECRET=vws_…  (VW_AUTH_URL defaults to http://localhost:8100)
```

`.env` is gitignored in every package. A standalone scraper run without
credentials prints `[FAIL]` + `[DONE]` and exits. For the agent,
`VW_CLIENT_ID` + `VW_CLIENT_SECRET` in its `.env` override the account saved at
first run (dev only).

### Release builds — only the hosts are baked in

Every package — the agent **and all six scrapers** — has a `src/embedded.ts`
holding public hosts only, committed as local dev servers:

```ts
export const EMBEDDED_API_ROOT = 'http://localhost:8000';
export const EMBEDDED_AUTH_ROOT = 'http://localhost:8100';
export const EMBEDDED_AGENT_KIND = 'amazon'; // agent only
```

CI rewrites `EMBEDDED_API_ROOT` from the `VH_API_ROOT` repository variable and
`EMBEDDED_AUTH_ROOT` from the `VW_AUTH_URL` repository variable, and fails if
either is unset or the injection doesn't take. Locally, `scripts/build-exe.js`
(agent, Amazon ads scraper) does the same from `.env`. At runtime `VH_API_ROOT`
/ `VW_AUTH_URL` in a `.env` override the baked values. `EMBEDDED_API_ROOT` is
the server root — endpoints are `/v1/scrapper/...` directly under it, with no
`/api` prefix. Each scraper also commits its own `QUERY_ENDPOINT` /
`RESULTS_ENDPOINT` paths.

Precedence at runtime is always: **environment > baked-in**. When the agent
launches a scraper it sets `QUERIES_API_URL`, `RESULTS_API_URL`, `VW_AUTH_URL`,
`VW_CLIENT_ID` and `VW_CLIENT_SECRET`, and those win.

> **Never commit a client secret** — not to `embedded.ts`, not to a
> `.env.example`. If one leaks, delete that service principal in VentaWiz-Auth
> and create a new one.

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

The workflow bakes in the `VH_API_ROOT` and `VW_AUTH_URL` repository variables
(no secret), builds all nine exes plus the three
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
| `QUERIES_API_URL` | `apiRoot` + the assignment's `query_endpoint` |
| `RESULTS_API_URL` | `apiRoot` + the assignment's `results_endpoint` |
| `VW_AUTH_URL` | the agent's auth service root |
| `VW_CLIENT_ID` | the agent's service account client id |
| `VW_CLIENT_SECRET` | the agent's service account secret (env only — never written to `user-settings.json`) |
| `SCRAPE_STORE_IDS` | the agent's store ids, comma-separated |
| `SCRAPE_MARKETPLACE` | the assignment's `marketplace` (`amazon` \| `flipkart` \| `noon`) |
| `SCRAPER_PROFILE_DIR` | the agent's shared Chrome profile |
| `BROWSER_VISIBLE` | `1` to show browser windows, else `0` |
| `DEFAULT_AMAZON_DOMAIN` | the Amazon site for Amazon scrapers |

These **override** each scraper's own defaults, so the backend controls which
endpoints a run targets. The agent also seeds `user-settings.json` in the
profile with `{ emailId, storeIds, firstRunCompletedAt }` so the scraper skips
its own first-run form.

The agent also derives run status from each scraper's stdout, counting `[OK]`
and `[FAIL]` lines and requiring a final `[DONE]`. **Any new scraper must emit
those markers** or its runs will be reported as `partial`.

### Adding a marketplace

Add the short code to that scraper's `src/marketplaces.ts`. Each queue item
carries its store's `short_code`, so stores of the new code start flowing as
soon as the backend serves them. An unknown code raises `Unknown short_code` at
runtime rather than scraping the wrong storefront.
