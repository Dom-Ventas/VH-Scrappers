# VentaWiz Agent (launcher)

One small Windows exe you install on every employee laptop, **one per
marketplace** (Amazon, Flipkart, noon). Windows Task Scheduler runs each one
every **2 hours**. Each run is one cycle:

1. **Checks in** with VentaWiz (`POST /v1/scrapper/checkin`) sending
   `{ device_id, agent_kind, store_ids, email, hostname, os, agent_version }` —
   a stable device id, the VentaWiz store ids entered at first run, and the
   kind this exe was built as.
2. VentaWiz replies with **which scraper(s) to run this cycle** for that
   marketplace: an administrator's pinned scrapers if any, otherwise this
   2-hour block's kind (even UTC blocks ads, odd blocks reviews).
3. The agent **runs the assigned scraper exe(s)** (e.g. `search-term-scrapper.exe`,
   `AmazonReviewScrapper.exe`) one after another as child processes, passing
   `SCRAPE_STORE_IDS` and `SCRAPE_MARKETPLACE`, and sharing **one** Chrome
   profile so the employee signs in to that marketplace only once.
4. It **reports each run** (`POST /v1/scrapper/runs`, snake_case, best-effort)
   so the fleet is visible in VentaWiz.

The schedule must be every 2 hours, not 4: a 4-hour task would always land in
the same kind of block and never run the other kind.

If the check-in fails, the agent replays the assignment cached by the last
successful check-in **only if it is at most 2 hours old** (the last cycle);
otherwise it does nothing that cycle.

Every call to VentaWiz is authenticated with the laptop's **VentaWiz service
account** (client ID `svc_…` + client secret `vws_…`, entered at first run):
`src/auth.ts` exchanges it for a short-lived bearer token at
`POST {VW_AUTH_URL}/v1/token` (OAuth `client_credentials`), caches it until 60 s
before expiry, and re-exchanges once on a 401. The agent hands the
**credentials** (not a token) to each scraper as `VW_CLIENT_ID` /
`VW_CLIENT_SECRET` / `VW_AUTH_URL`, since a scraper run outlives one token.
There is no shared token anywhere.

It does **not** modify or merge the scrapers — it just coordinates them. Adding
a future scraper = ship its exe + add one catalog entry in the backend; the
agent needs no change.

## Three agents, one codebase

A laptop runs **one agent exe per marketplace**. Chromium locks a persistent
profile, so a single agent cannot hold signed-in sessions for three sites at
once. Each agent therefore gets its own Chrome profile, home directory, device
id, lock file and scheduled task, and they run independently.

All three are built from this one codebase and differ only by the
`EMBEDDED_AGENT_KIND` constant in `src/embedded.ts`, which drives the home
directory, the first-run sign-in domain, and the `agent_kind` sent on check-in:

| Kind | Exe | Home directory | First-run domain |
|------|-----|----------------|------------------|
| `amazon` | `VentaHubAgent.exe` | `%LOCALAPPDATA%\VentaHubAgent` | www.amazon.in |
| `flipkart` | `VentaHubAgentFlipkart.exe` | `%LOCALAPPDATA%\VentaHubAgentFlipkart` | www.flipkart.com |
| `noon` | `VentaHubAgentNoon.exe` | `%LOCALAPPDATA%\VentaHubAgentNoon` | www.noon.com |

Because the kind is declared on check-in, the backend serves each exe only its
own marketplace's scrapers.

## How it decides what to run

Assignment is per **device**, keyed by an auto-generated device id (stored in
`%LOCALAPPDATA%\VentaHubAgent\device.id` and mirrored to `%PROGRAMDATA%`). A
device seen for the first time is registered as `active`. A device runs, in
order of precedence:

1. nothing, if its status is not `active` (`disabled`, `retired`);
2. the scrapers an administrator pinned for it (`assigned_scraper_keys` in
   `app_scraper_device`), of its own marketplace;
3. otherwise this 2-hour block's kind — ads or reviews — for its marketplace.

There are no admin endpoints yet; status and pins are edited directly in
`app_scraper_device`. Changes take effect on the device's next check-in.

The store ids are checked on every check-in: a store that does not exist, is
deleted, or belongs to another marketplace gets a `404` — the agent was set up
with the wrong store ids.

## Build

```bash
npm install
npm run build:exe:all   # all three agent exes (node20-win-x64)
```

Or one at a time:

| Script | Kind baked | Output |
|--------|-----------|--------|
| `npm run build:exe` | `amazon` | `dist/VentaHubAgent.exe` |
| `npm run build:exe:flipkart` | `flipkart` | `dist/VentaHubAgentFlipkart.exe` |
| `npm run build:exe:noon` | `noon` | `dist/VentaHubAgentNoon.exe` |

Each script runs `scripts/set-agent-kind.mjs <kind>` to rewrite the
`EMBEDDED_AGENT_KIND` line, then recompiles and packages. `build:exe:all` builds
amazon **last** so the working tree is left on the committed default — an
interrupted run leaves `embedded.ts` on another kind, so check `git diff` before
rebuilding.

Also build the scrapers (in their folders): `npm run build:exe`.

To test one build as another marketplace without rebuilding, set
`VH_AGENT_KIND=flipkart`. Debug only — in production one exe means one
marketplace.

## Deploy to a laptop

**Easiest: download the prebuilt bundle** from the repo's
[Releases](../../releases) (produced by the *Build Windows Agent* workflow).
Those exes carry no secret — only the VentaWiz API and auth hosts are baked
in — so **no `.env` is needed**; the service account is entered at first run.

Put one bundle's files together in a folder (e.g. `C:\VentaHub\`). The three
bundles can share a single folder:

| Bundle | Files |
|--------|-------|
| Amazon | `VentaHubAgent.exe` + `search-term-scrapper.exe` + `AmazonReviewScrapper.exe` + `install\register-task.ps1` |
| Flipkart | `VentaHubAgentFlipkart.exe` + `flipkart-search-term-scrapper.exe` + `FlipkartReviewScrapper.exe` + `install\register-task-flipkart.ps1` |
| noon | `VentaHubAgentNoon.exe` + `noon-search-term-scrapper.exe` + `noon-review-scrapper.exe` + `install\register-task-noon.ps1` |

> If you build **locally** (not from a Release), set `VH_API_ROOT` and
> `VW_AUTH_URL` in `.env` before `npm run build:exe:baked`, or the exe calls the
> committed localhost defaults (see `.env.example`).

Before setting up a laptop, get its **service account** from a VentaWiz admin:

1. The admin creates it in VentaWiz-Auth — `POST /v1/service-principals` for
   the tenant. The reply contains the `client_id` (`svc_…`) and the
   `client_secret` (`vws_…`); **the secret is shown once** and cannot be read
   back later.
2. The admin grants it `scrapper:run` — `POST /v1/grants`, at client scope
   (all the tenant's stores) or store scope (only the stores this laptop may
   scrape).

Then on the laptop:

1. **Double-click the agent exe once.** It asks for the employee email,
   VentaWiz **store IDs** (whole numbers, one per line or comma-separated, up to
   50), and the service account's **Client ID** (`svc_…`) and **Client secret**
   (`vws_…`), then opens that marketplace for a one-time sign-in. Sign in, set the
   delivery pincode, close that tab. The first cycle then runs.
2. **Right-click the matching `register-task*.ps1` → Run with PowerShell.** This
   registers that agent's scheduled task to run every 2 hours.

Upgrading a laptop from the VentaHub build: its `agent-config.json` holds AMS
profile IDs, which are not store IDs, so the agent shows the setup form again
on its next run. Double-click the exe once to enter the store IDs. The device
id is kept.

Upgrading from a shared-token build: its `agent-config.json` has no client
id/secret, so the setup form appears again (email and store IDs pre-filled)
to enter the service account. The device id is kept.

Repeat both steps per bundle installed — each agent has its own login, its own
task and its own device id. Chrome must be installed.

## Config

Set via a `.env` next to the exe or environment variables (see `.env.example`):

| var | default | purpose |
|-----|---------|---------|
| `VH_API_ROOT` | baked in (`http://localhost:8000` in source) | VentaWiz server root; endpoints are `/v1/scrapper/...` under it |
| `VW_AUTH_URL` | baked in (`http://localhost:8100` in source) | VentaWiz auth service root; token exchange is `POST /v1/token` under it |
| `VW_CLIENT_ID` / `VW_CLIENT_SECRET` | *(from first run)* | dev override of the saved service account; both must be set |
| `DEFAULT_AMAZON_DOMAIN` | `www.amazon.in` | domain passed to Amazon scrapers |
| `VH_AGENT_KIND` | *(baked in)* | override the built-in kind — **debug only** |
| `BROWSER_VISIBLE` | `0` | `1` = show child browser (debug) |
| `VH_SCRAPER_DIR` | agent exe's folder | where the scraper exes live |

## Where things live on the laptop

Per marketplace — `VentaHubAgent`, `VentaHubAgentFlipkart` or
`VentaHubAgentNoon`:

```
%LOCALAPPDATA%\<agent dir>\
  agent-config.json        email + store IDs + deviceId + service account
                           (client id + secret — per user, never logged)
  device.id                stable device id (also mirrored in %PROGRAMDATA%)
  chrome-profile\          this agent's logged-in Chrome profile
  cycle.lock               legacy; cleared at startup
  last-assignment.json     last check-in reply + cachedAt (replayed only if ≤ 2h old)
  logs\agent.log           rolling agent log
```

## Troubleshooting

- **Wrong scraper running / nothing running** → check the device's row in
  `app_scraper_device` (status, pinned scrapers). A `disabled` device gets
  nothing. Ads and reviews alternate every 2 hours, so one cycle runs only one
  kind unless scrapers are pinned.
- **`checkin 404`** → a store id entered at setup does not exist, is deleted, or
  is another marketplace's. Delete `agent-config.json` and run the exe once to
  re-enter them.
- **`client id/secret rejected — check the service account`** → the token
  exchange returned 401: wrong id/secret, or the service principal was
  deleted. Delete `agent-config.json` and run the exe once to enter a new pair
  (the device id is kept).
- **`service account lacks scrapper:run`** → the API returned 403. A VentaWiz
  admin must grant `scrapper:run` to that client id (`POST /v1/grants`).
- **`checkin 404` for a store you expected** → also check the service
  account's grant: a store outside a store-scoped grant (or another tenant's
  store) looks exactly like a missing one.
- **Re-imaged laptop lost its pins** → `device.id` was lost; it re-registered
  as a new device. Re-apply its pins by hostname.
- **The site asks to log in again** → double-click that agent's exe once to
  refresh its Chrome profile login.
- **`scraper exe not found`** → the assigned scraper exe is missing from the
  agent's folder. Check the assignment's `exe_name` against the files you copied.
- **Only one marketplace runs** → each agent is a separate install. Check that
  the other agent's exe was run once and its scheduled task registered.
