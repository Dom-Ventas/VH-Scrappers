# VentaHub Agent (launcher)

One small Windows exe you install on every employee laptop. Windows Task
Scheduler runs it every ~4 hours. Each run it:

1. **Checks in** with VentaHub (`POST /api/v1/scrapper/checkin`) sending a stable
   device id + email + profile IDs.
2. VentaHub replies with **which scraper(s) this laptop should run today** (the
   manager controls this centrally — no laptop change needed to switch).
3. The agent **runs the assigned scraper exe(s)** (e.g. `search-term-scrapper.exe`,
   `AmazonReviewScrapper.exe`) as child processes, sharing **one** Chrome
   profile so the employee logs into Amazon only once.
4. It **reports each run** (`POST /api/v1/scrapper/runs`) so the fleet is visible
   in VentaHub.

It does **not** modify or merge the scrapers — it just coordinates them. Adding
a future scraper = ship its exe + add one catalog entry in the backend; the
agent needs no change.

## How it decides what to run

Assignment is per **device**, keyed by an auto-generated `deviceId` (stored in
`%LOCALAPPDATA%\VentaHubAgent\device.id` and mirrored to `%PROGRAMDATA%`). A
device with no explicit assignment inherits the **global default**. The manager
changes assignments in VentaHub (see the backend admin API); changes take
effect on the device's next check-in.

## Build

```bash
npm install
npm run build:exe    # -> dist/VentaHubAgent.exe  (node20-win-x64)
```

Also build the scrapers (in their folders): `npm run build:exe`.

## Deploy to a laptop

**Easiest: download the prebuilt bundle** from the repo's
[Releases](../../releases) (produced by the *Build Windows Agent* workflow).
Those exes have the token baked in — **no `.env` needed**.

Put these together in one folder (e.g. `C:\VentaHub\`):

```
VentaHubAgent.exe
search-term-scrapper.exe
AmazonReviewScrapper.exe
install\register-task.ps1
```

> Only if you build **locally** (not from a Release), the exe has no token
> baked in — add a `.env` next to it with `API_TOKEN=<token>` (see `.env.example`).

Then on the laptop:

1. **Double-click `VentaHubAgent.exe` once.** It asks for the employee email +
   AMS profile IDs, then opens Amazon for a one-time sign-in. Sign in, set the
   delivery pincode, close that tab. The first cycle then runs.
2. **Right-click `install\register-task.ps1` → Run with PowerShell.** This
   registers the "VentaHub Scraper Agent" scheduled task to run every 4 hours.

That's it. The agent runs unattended from then on. Chrome must be installed.

## Config

Set via a `.env` next to the exe or environment variables (see `.env.example`):

| var | default | purpose |
|-----|---------|---------|
| `API_TOKEN` | **required** | static scrapper Bearer token (never hard-coded in source) |
| `VH_API_ROOT` | `https://domventas.info/backend` | VentaHub server root |
| `DEFAULT_AMAZON_DOMAIN` | `www.amazon.in` | domain for first-run login |
| `BROWSER_VISIBLE` | `0` | `1` = show child browser (debug) |
| `VH_SCRAPER_DIR` | agent exe's folder | where the scraper exes live |

## Where things live on the laptop

```
%LOCALAPPDATA%\VentaHubAgent\
  agent-config.json        email + profile IDs + deviceId
  device.id                stable device id (also mirrored in %PROGRAMDATA%)
  chrome-profile\          the single shared, logged-in Chrome profile
  last-assignment.json     cached assignment (offline fallback)
  logs\agent.log           rolling agent log
```

## Troubleshooting

- **Wrong scraper running / nothing running** → check the device's assignment in
  VentaHub. A `disabled` device gets nothing.
- **Re-imaged laptop lost its assignment** → `device.id` was lost; it
  re-registered as a new device on the global default. Re-apply its assignment
  by hostname in VentaHub.
- **Amazon asks to log in again** → double-click the exe once to refresh the
  shared Chrome profile login.
