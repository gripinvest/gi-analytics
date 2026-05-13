# Ideation — Grip Analytics

Captured 2026-05-13. Living docs; mark sections **shipped** as they land in `main`,
and keep the trade-offs paragraph even after — it's the part that's expensive to
re-derive.

Four threads, in roughly the order they unblock each other:

| Thread | One-line | Doc |
|---|---|---|
| **Multi-project platform** | Make adding a new project a 1-file change, not a 10-file change. | [multi-project-platform.md](./multi-project-platform.md) |
| **Mobile-first, always** | Standing principle. Every UI starts at ≤375px. | [mobile-first.md](./mobile-first.md) |
| **PWA + offline** | The data is mostly static once fetched — make the app installable and useful offline. | [pwa-offline.md](./pwa-offline.md) |
| **Data refresh button** | Per-project refresh: pull from Metabase, write CSVs, reload DuckDB, bust caches. | [data-refresh.md](./data-refresh.md) |

## How these interact

The four aren't independent. Decisions in one constrain the others:

```
multi-project ──┐
                ├──► data-refresh (each project needs its own source-of-truth pipeline)
                │
                ├──► mobile-first  (each new dashboard must clear the same bar)
                │
                └──► pwa-offline   (each new project's queries need to be cache-able)

data-refresh ──────► pwa-offline   (refresh must invalidate the SW cache for that project)
```

So: **work the multi-project shape first** (it sets the API contracts the others depend on),
then refresh (since PWA caching is downstream of "what's a cacheable resource"),
then PWA. Mobile-first is a constraint applied at every step, not a separate slice.

## How to use these docs

Each per-topic doc has the same shape:

1. **Why** — the problem in one short paragraph.
2. **Pointers** — concrete decisions or options, bullet-shaped. The point isn't "do this," it's "here are the choices and what each implies."
3. **Trade-offs** — what gets worse when this gets better.
4. **Open questions** — anything that needs the user's call before code happens.
5. **Suggested first slice** — the smallest version that proves the idea without committing the whole architecture.

When picking up a thread, read the doc top-to-bottom once, then **answer the open questions before writing code**. Most failures here will come from skipping that step.
