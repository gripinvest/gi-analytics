# Ideation — Grip Analytics

Captured 2026-05-13. Living docs; mark sections **shipped** as they land in `main`,
and keep the trade-offs paragraph even after — it's the part that's expensive to
re-derive.

## The ambition (user input, 2026-05-13)

> *"Maintain some semblance of an analytics platform — an editorial of all data for our company. Be it feature specific, be it core journeys, be it investments, AOMs, could be anything. Enable anyone to create a dashboard based on certain integrations and APIs."*

That framing — **"an editorial of all data, anyone can author"** — is the
through-line. Each thread below either widens what data the platform can pull
in (integrations), lowers what it costs to author a new dashboard
(multi-project), makes the result more durable (PWA / offline), or guards the
quality bar at small viewports (mobile-first).

## The threads

| Thread | One-line | Doc |
|---|---|---|
| **Multi-project platform** | Many projects across feature, journey, domain, external. Generic config-driven dashboards as the default; bespoke as the exception. | [multi-project-platform.md](./multi-project-platform.md) |
| **Config-driven dashboards** | One `GenericDashboard` renders from a `project.json` `dashboard` config. AI-authored from plain language against a defined widget catalogue; unmet requests become developer tickets. Interactive `explorer` sections, a plug-and-play component repository, any data source. | [config-dashboard.md](./config-dashboard.md) |
| **Mobile-first, always** | Standing principle. Every UI starts at ≤375px. | [mobile-first.md](./mobile-first.md) |
| **PWA + installable + offline** | Goal: installable home-screen app + offline-resilient reading. Chat offline is **not** a goal. | [pwa-offline.md](./pwa-offline.md) |
| **Data integrations + refresh** | Pluggable adapters per source (Metabase today; Sentry, Google Play, App Store, New Relic, YouTube, custom DBs next). Platform owns canonical raw data. | [data-integrations.md](./data-integrations.md) |
| **Issuer deep-dive** | Per-keyword breakdown inside each issuer, a "leaving on the table" view for unavailable issuers, explicit answers to Nikhil's three questions. | [issuer-deepdive.md](./issuer-deepdive.md) |

## How they interact

```
multi-project ──┬──► config-dashboard (generic dashboards = the §C1 default, specified)
                │
                ├──► data-integrations (each project picks 1+ source adapters)
                │
                ├──► mobile-first  (each new dashboard must clear the same bar)
                │
                └──► pwa-offline   (each project's queries need to be cache-able)

config-dashboard ◄──► data-integrations (config renders the table; the adapter fills it — decoupled)
data-integrations ──► pwa-offline (refresh must invalidate the SW cache)
```

Working order, given the user direction:
1. **multi-project** sets the contracts (`project.json.integrations`, `queries`, `dashboard`).
2. **data-integrations** wires the first adapter (Metabase) end-to-end.
3. **pwa-offline** adds the SW + manifest once §2 has defined what's cache-able and what triggers invalidation.
4. **mobile-first** is the constraint applied at every step.

## How to use these docs

Each per-topic doc has the same shape:

1. **Why** — the problem in one short paragraph.
2. **Pointers** — concrete decisions or options, bullet-shaped.
3. **Trade-offs** — what gets worse when this gets better.
4. **Open questions** — what needs the user's call before code happens.
5. **Suggested first slice** — the smallest version that proves the idea without committing the whole architecture.

When picking up a thread, read the doc top-to-bottom once, then **answer the open questions before writing code**. Most failures here will come from skipping that step.

## Status of the open questions (updated 2026-05-17)

User has answered the following directly:

- **Many projects, not few.** Plan for 30+. Categories include feature, journey, domain (investments / marketing / support), external (YouTube channel comparison, app-store metrics).
- **Anyone authors a dashboard.** Self-serve creation is a roadmap target; engineer-driven via a CLI is fine for week 1. **Confirmed 2026-05-17:** the end state is people building their own dashboards over diverse sources — YouTube (our channel vs others), app-team metrics from New Relic + Play Console + App Store, etc. → drove [config-dashboard.md](./config-dashboard.md).
- **Installable PWA is a goal.** Home-screen icon, standalone display.
- **Chat offline is not a goal.** When offline, the chat shows a short message and stays disabled.
- **Today's data flow is Metabase → manual CSVs**; the goal is to replace the manual step with API-driven adapters owned by the platform.

Progress since 2026-05-13:

- **Second project shipped — Grip Connect** (partner-distribution analytics). Built bespoke alongside asset_search, as multi-project §C's migration plan called for. That gives the two concrete examples the [config-dashboard.md](./config-dashboard.md) schema is extracted from.
- **Per-project chat context** landed — `project.json.chat_context` + a project-aware router. The "many projects" chat concern in multi-project §E is partially addressed.

Remaining gating answers needed before code lands:

- **Which Metabase cards** correspond to which asset_search CSVs (needed for the first refresh slice).
- **Which non-Metabase integration is next** (Sentry / Google Play / App Store / New Relic / YouTube) — chooses the second adapter and how generic `base.py` ends up being.
- **What's the first born-config-driven project** ([config-dashboard.md](./config-dashboard.md) open question 3) — not a port of the two bespoke dashboards; a genuinely new, simple one that proves the schema.
