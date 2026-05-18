# Grip Invest — Production Database Schema

Companion notes for the database schema overview shared by the backend team.

- **Interactive file:** [`docs/reference/gripinvest-db-schema-overview.html`](reference/gripinvest-db-schema-overview.html)
  — open it in a browser to explore every table, domain, and relationship.
  It is the backend team's artifact, wrapped in a standalone HTML shell so it
  renders without a host page.
- **Last updated:** 2026-05-18 (snapshot — the live DB evolves; re-request
  from the backend team when it drifts).
- **Why this is here:** the Grip Connect dashboard's Metabase cards are
  analytical aggregations; this is the operational schema underneath them.
  See [`grip-connect-metrics-catalog.md`](grip-connect-metrics-catalog.md)
  for the metrics layer.

---

## Overview

| | |
|---|---|
| Tables | 237 |
| Functional domains | 18 |
| Cross-table relationships | 161 |
| Schemas | 6 |

The six schemas (inferred from table prefixes): `GCI_SCHEMA` (Grip Connect
partner platform), `app`, `calculation`, `dmf` (direct mutual funds),
`portfolio`, and the default/`public` schema (everything unprefixed).

---

## Functional domains

Tables are grouped into 18 domains (table counts from the snapshot):

| Domain | Tables | Notes |
|---|---:|---|
| Other / Misc | 40 | Uncategorised — ledger, bids, leads, IFA, etc. |
| Users & Auth | 30 | `tblusers` is the central hub (30 links) |
| Assets & Securities | 28 | `tblassets`, `securities`, `tblspvs` |
| Orders & Payments | 21 | `tblorders`, `payment_gateway` |
| KYC & Compliance | 20 | depository / Fixerra / nominee KYC |
| Partners & Brokers | 16 | `tblpartners`, vendor reconciliation |
| **GCI Partner Platform** | **13** | **Grip Connect — see below** |
| Mutual Funds (DMF) | 12 | `dmf.*` schema |
| Logs & Audit | 12 | bank / KRA / digilocker logs |
| Referrals & Rewards | 7 | |
| Portfolio | 7 | `portfolio.*` schema |
| Calculations | 6 | `calculation.*` schema |
| Communications | 6 | email / SMS logs |
| App Config | 5 | `app.*` schema |
| Config & Master | 5 | |
| Documents & E-sign | 4 | |
| Reports | 4 | |
| System & Migrations | 1 | `SequelizeMeta` |

Top cross-domain links: Other↔Users&Auth (13), KYC↔Users&Auth (10),
Assets↔Other (9), Assets↔Partners (7), Assets↔Orders (6),
**GCI Partner Platform↔Users&Auth (5)**.

---

## GCI Partner Platform — the Grip Connect schema

All 13 tables live in `GCI_SCHEMA`. This is the operational source-of-truth
for Grip Connect (the dashboard this repo serves). Purposes below are
inferred from table and column names — confirm with the backend team before
relying on them.

| Table | Cols | Links | Inferred purpose |
|---|---:|---:|---|
| `gci_config` | 16 | 6 | Per-partner configuration — the hub of the schema |
| `gci_orders` | 20 | 2 | Orders placed through partner apps |
| `gci_external_users` | 15 | 2 | Partner-app users mapped to Grip identities |
| `gci_kyc_logs` | 15 | 2 | KYC events for Grip Connect users |
| `gci_preferences_logs` | 5 | 2 | Preference-change log |
| `gci_orders_commissions` | 8 | 1 | Commission per order |
| `gci_subscription` | 7 | 1 | Partner subscription records |
| `gci_asset_visibility` | 6 | 1 | Which assets each partner can show |
| `gci_client_credentials` | 7 | 1 | Partner API credentials |
| `user_redirect_logs` | 7 | 1 | Redirects from partner apps into Grip pages |
| `gci_esign_logs` | 9 | 0 | E-sign events |
| `gci_order_logs` | 7 | 0 | Order event log |
| `gci_redirection` | 7 | 0 | Redirection config / log |

### Relationships

- **`gci_config` is the schema hub** — it links to `gci_asset_visibility`,
  `gci_client_credentials`, `gci_external_users`, `gci_kyc_logs`,
  `gci_preferences_logs`, and `gci_subscription`.
- **`external_users` (Users & Auth domain) is the bridge** to the main Grip
  user base. `gci_external_users`, `gci_kyc_logs`, `gci_orders`,
  `gci_preferences_logs`, and `user_redirect_logs` all link to it — this is
  the 5-link GCI↔Users&Auth cross-domain edge.
- `gci_orders` ↔ `gci_orders_commissions` (order → its commission).
- `gci_esign_logs`, `gci_order_logs`, `gci_redirection` have no recorded
  foreign keys — likely append-only log tables.

### How this maps to the dashboard

The Grip Connect dashboard does **not** query these OLTP tables directly. It
reads Metabase cards (named `… CH` — Clickhouse-backed analytical copies)
which aggregate this operational data. The likely lineage, by name:

- `user_redirect_logs` → the redirect / hand-off metrics (Section III).
- `gci_orders` + `gci_orders_commissions` → order counts, AUM, AOV
  (cards 3841 / 3843).
- `gci_kyc_logs` → the registration→KYC funnel (card 4499).

Treat these as hypotheses — the exact card SQL was not reviewed. If a metric
needs auditing to source, ask the data team for the card definition.

---

## Refreshing this snapshot

The HTML is a point-in-time export. When the schema changes materially,
re-request the overview from the backend team and replace
`docs/reference/gripinvest-db-schema-overview.html` (keep the standalone
wrapper). Update the counts in this file to match.
