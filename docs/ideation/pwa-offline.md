# PWA + offline

> **Status update (2026-05-13, user input):** **installable on the home screen is a goal** (not just offline-resilience). **Chat offline is not a goal** — when offline, the chat panel shows a clear "the editor needs to be online" message and stays hidden / disabled. Other open questions in §F still need user input.

## Why

The data this app shows is mostly **historical product analytics** — weekly
aggregates, not minute-to-minute telemetry. Once a session has loaded the
queries for project X, those queries don't change until the user explicitly
hits Refresh (see [data-refresh.md](./data-refresh.md)). That's exactly the
shape that benefits from a service worker: cache the queries on first load,
serve from cache thereafter, network is the exception not the rule.

PWA also unlocks "Add to Home Screen" — the demo is something you might want
to open on a phone, and at that point an icon on the home screen + offline
support is the difference between "a website" and "an app."

## Pointers

### A. The three things a PWA needs

1. **Web App Manifest** (`/manifest.webmanifest`)
   - `name`, `short_name`, `icons`, `theme_color`, `background_color`, `display: "standalone"`, `start_url: "/"`, `scope: "/"`
   - Icons: we already have `app/icon.svg`. Add 192×192 and 512×512 PNGs for Android/Chrome install banners (SVG icons are not always honoured for install).
   - Theme color: `#0F2F4D` (classic) or `#1B1818` (editorial). Per-design theme would need JS to swap — leave at classic for the install state.

2. **Service worker** (`/sw.js`)
   - Registered from the root layout (client component, useEffect with `'serviceWorker' in navigator`).
   - Strategy table — see §B.

3. **HTTPS** — Vercel already gives us this.

### B. The caching strategy table

| Resource | Strategy | Why |
|---|---|---|
| App shell (HTML, JS, CSS, icons) | **Cache-first**, revalidate in background | The shell is immutable per deploy. Serve instantly, update on next visit. |
| Google Fonts CSS + woff2 (Fraunces, Newsreader, Plex Mono, Inter) | **Cache-first**, ~30d TTL | Fonts are huge (~250KB total) and rarely change. Cache aggressively. |
| `/api/proxy/api/projects` (list) | **Stale-while-revalidate** | Cheap; new projects appear within one visit. |
| `/api/proxy/api/projects/<id>` (metadata) | **Stale-while-revalidate** | Same. |
| `/api/proxy/api/projects/<id>/query` (POST, the bulk) | **Cache-first, indexed by request body hash**, until busted | The expensive bit. The 19 queries the asset_search dashboard fires are deterministic given (project, sql) — perfect cache keys. |
| `/api/proxy/api/chat/*` | **Network-only** | SSE streaming + LLM calls. No useful cache. |
| `/api/login`, `/api/logout` | **Network-only** | Auth must hit the server. |
| `/api/proxy/api/upload/*` | **Network-only** | Side-effectful. |

The `/api/proxy/.../query` row is the architecturally interesting one — POSTs are
not in the default SW cache shape. Need a custom cache that hashes
`(url, body)` → cache key. Lightweight in a SW.

### C. Implementation choice

Three reasonable libraries; pick one:

- **`next-pwa`** — old, widely used, Next 14 support is via `@ducanh2912/next-pwa` fork. Quick to wire but the fork's compatibility is fragile.
- **`@serwist/next`** — modern Workbox successor; first-class Next 14 + 15 support. Recommended.
- **Roll our own** — ~120 lines, no dependency. Full control. Worth doing if the demo is meant as a showcase, painful if it's meant to ship and be forgotten.

Recommend **Serwist**: lowest risk, fastest path, leaves a clean exit if we ever want to rip it out.

### D. Offline UX

Things the user sees that we should design, not punt on:

- **Network status indicator**: a small `OFFLINE` chip in the top bar when `navigator.onLine === false`. Doesn't need to be ugly; in editorial mode it can read "*reading offline*" in italic mono.
- **Stale data marker**: when a query came from cache, mark the affected stat / chart with a faint "as of <timestamp>" note. The cache stores `{value, fetchedAt}` together; the marker reads from `fetchedAt`.
- **Login while offline**: degrade gracefully. If a stored session cookie is valid and the SW serves the shell, show the cached project — but the chat is gone and the refresh button is disabled with a tooltip.
- **First-visit-offline**: nothing to serve. Show a single offline page (cached at install time) with "Connect and reload."

### E. Auth + SW interaction

The `grip-auth` cookie is HTTP-only and sent automatically by `fetch`. The SW
intercepts the fetch but the cookie passes through unchanged. No extra plumbing
needed. *But:* if the cookie has expired and the server returns 401, the SW
should NOT serve a cached version — that would silently show stale data to a
logged-out user. The cache strategy must skip the cache on 401 / 403 responses
and fall through to the network (which will then redirect to /login).

### F. Storage budget

Quotas are forgiving (often hundreds of MB) but not unlimited. The 19 queries × 6 weeks of asset_search data is small (kB range). A future project with 100K rows × N queries could be hostile.

- Cap the query cache to, say, 200 entries with LRU eviction (Serwist has this built in).
- Don't cache obviously huge responses (e.g. >1MB) — let them go through.
- Per-project bust: when the user hits Refresh on project X, delete every cache entry whose URL starts with `/api/proxy/api/projects/X/`.

### G. Updating the app

Service workers ship a notoriously confusing update model. Use the standard
"new SW waiting" pattern:

- New SW installs in the background.
- When the user navigates next, show a small "*new edition available — reload?*" prompt (one button, dismissible).
- Don't auto-reload mid-session. That's how you lose unsaved chat threads.

## Trade-offs

- **Service workers add a debugging tax**. "It works locally but stale on prod" is the canonical SW bug. Mitigate by always shipping with a versioned cache name (`grip-analytics-v<git-sha>`) so a deploy fully invalidates old caches.
- **The chat experience is degraded offline.** That's the right call — LLM chat without network is not "the data you cached, with no AI", it's confusing. Disable the trigger and explain.
- **Editorial fonts are heavy** (~250KB). Caching helps after first visit but the first paint is paid in full. Consider `font-display: optional` on Fraunces so the editorial mode falls back to system serif on a slow first paint and snaps to Fraunces when ready.
- **SW serving stale auth state** is the most likely user-visible bug. The 401-pass-through rule in §E is the load-bearing one — get it right.

## Open questions

1. ~~Is "installable" a goal in itself?~~ **Answered: yes.** Icon on the home screen, standalone display, full manifest tuning. The first slice (§ Suggested first slice) is unchanged but the install banner now matters.
2. ~~How important is the chat working offline?~~ **Answered: not a goal.** When offline, the chat trigger renders disabled with a short italic line: *"The editor needs to be online — try again when connected."* No queueing, no local conversation store. One less moving part.
3. Should refresh be available offline (queued for when reconnect)? Recommend: online-only, because the Metabase / Sentry / etc. APIs are unreachable offline anyway. Show the Refresh button greyed out with a tooltip.
4. Per-design theme color on install — worth the JS swap, or accept one theme for the install screen? With editorial likely to be the chosen install impression, recommend defaulting `theme_color` to the editorial paper-cream + ink. The classic dashboard still works perfectly on the cream background.

## Suggested first slice

The smallest thing that proves the model without committing to the full strategy:

1. Add the manifest (`app/manifest.webmanifest`) + 192/512 PNG icons. That alone makes the site installable and the address bar lose its "URL" look on Android.
2. Wire Serwist with **one strategy**: cache-first for the app shell. Skip the API caching for the first pass.
3. Verify Lighthouse PWA score is green, install on phone, confirm it opens standalone.
4. **Then**, in a second pass, layer the POST-query caching with the cache-busting hooks from [data-refresh.md](./data-refresh.md). Don't do them together — the SW debug surface is much smaller when one strategy is in flight.

Pre-requisite: [data-refresh.md](./data-refresh.md) needs to define how a refresh notifies the SW (postMessage or a dedicated invalidate endpoint). Without that contract, the POST cache is unsafe.
