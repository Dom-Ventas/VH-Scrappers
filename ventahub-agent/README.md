# VentaHub Agent (launcher)

One small Windows exe you install on every employee laptop, **one per
marketplace** (Amazon, Flipkart, noon). Windows Task Scheduler runs each one
every ~4 hours. Each run it:

1. **Checks in** with VentaHub (`POST /api/v1/scrapper/checkin`) sending a stable
   device id + email + profile IDs, and the `agentKind` this exe was built as.
2. VentaHub replies with **which scraper(s) this laptop should run today** for
   that marketplace (the manager controls this centrally — no laptop change
   needed to switch).
3. The agent **runs the assigned scraper exe(s)** (e.g. `search-term-scrapper.exe`,
   `AmazonReviewScrapper.exe`) as child processes, sharing **one** Chrome
   profile so the employee signs in to that marketplace only once.
4. It **reports each run** (`POST /api/v1/scrapper/runs`) so the fleet is visible
   in VentaHub.

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
directory, the first-run sign-in domain, and the `agentKind` sent on check-in:

| Kind | Exe | Home directory | First-run domain |
|------|-----|----------------|------------------|
| `amazon` | `VentaHubAgent.exe` | `%LOCALAPPDATA%\VentaHubAgent` | www.amazon.in |
| `flipkart` | `VentaHubAgentFlipkart.exe` | `%LOCALAPPDATA%\VentaHubAgentFlipkart` | www.flipkart.com |
| `noon` | `VentaHubAgentNoon.exe` | `%LOCALAPPDATA%\VentaHubAgentNoon` | www.noon.com |

Because the kind is declared on check-in, the backend serves each exe only its
own marketplace's scrapers.

## How it decides what to run

Assignment is per **device**, keyed by an auto-generated `deviceId` (stored in
`%LOCALAPPDATA%\VentaHubAgent\device.id` and mirrored to `%PROGRAMDATA%`). A
device with no explicit assignment inherits the **global default**. The manager
changes assignments in VentaHub (see the backend admin API); changes take
effect on the device's next check-in.

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
Those exes have the token baked in — **no `.env` needed**.

Put one bundle's files together in a folder (e.g. `C:\VentaHub\`). The three
bundles can share a single folder:

| Bundle | Files |
|--------|-------|
| Amazon | `VentaHubAgent.exe` + `search-term-scrapper.exe` + `AmazonReviewScrapper.exe` + `install\register-task.ps1` |
| Flipkart | `VentaHubAgentFlipkart.exe` + `flipkart-search-term-scrapper.exe` + `FlipkartReviewScrapper.exe` + `install\register-task-flipkart.ps1` |
| noon | `VentaHubAgentNoon.exe` + `noon-search-term-scrapper.exe` + `noon-review-scrapper.exe` + `install\register-task-noon.ps1` |

> Only if you build **locally** (not from a Release), the exe has no token
> baked in — add a `.env` next to it with `API_TOKEN=<token>` (see `.env.example`).

Then on the laptop:

1. **Double-click the agent exe once.** It asks for the employee email +
   profile IDs, then opens that marketplace for a one-time sign-in. Sign in, set
   the delivery pincode, close that tab. The first cycle then runs.
2. **Right-click the matching `register-task*.ps1` → Run with PowerShell.** This
   registers that agent's scheduled task to run every 4 hours.

Repeat both steps per bundle installed — each agent has its own login, its own
task and its own device id. Chrome must be installed.

## Config

Set via a `.env` next to the exe or environment variables (see `.env.example`):

| var | default | purpose |
|-----|---------|---------|
| `API_TOKEN` | **required** | static scrapper Bearer token (never hard-coded in source) |
| `VH_API_ROOT` | `https://domventas.info/backend` | VentaHub server root |
| `DEFAULT_AMAZON_DOMAIN` | `www.amazon.in` | domain passed to Amazon scrapers |
| `VH_AGENT_KIND` | *(baked in)* | override the built-in kind — **debug only** |
| `BROWSER_VISIBLE` | `0` | `1` = show child browser (debug) |
| `VH_SCRAPER_DIR` | agent exe's folder | where the scraper exes live |

## Where things live on the laptop

Per marketplace — `VentaHubAgent`, `VentaHubAgentFlipkart` or
`VentaHubAgentNoon`:

```
%LOCALAPPDATA%\<agent dir>\
  agent-config.json        email + profile IDs + deviceId
  device.id                stable device id (also mirrored in %PROGRAMDATA%)
  chrome-profile\          this agent's logged-in Chrome profile
  cycle.lock               guards against overlapping cycles
  last-assignment.json     cached assignment (offline fallback)
  logs\agent.log           rolling agent log
```

## Troubleshooting

- **Wrong scraper running / nothing running** → check the device's assignment in
  VentaHub. A `disabled` device gets nothing.
- **Re-imaged laptop lost its assignment** → `device.id` was lost; it
  re-registered as a new device on the global default. Re-apply its assignment
  by hostname in VentaHub.
- **The site asks to log in again** → double-click that agent's exe once to
  refresh its Chrome profile login.
- **`scraper exe not found`** → the assigned scraper exe is missing from the
  agent's folder. Check the assignment's `exeName` against the files you copied.
- **Only one marketplace runs** → each agent is a separate install. Check that
  the other agent's exe was run once and its scheduled task registered.
