// Outreach query builder + mock dataset for the Asset Search dashboard's
// CS-facing Outreach section.
//
// The `asset_search_notify_me_clicked` event ships on the gi-client-web V2
// release (PT-37900). Until it lands in Rudderstack:
//   - The live query returns 0 rows; the dashboard renders mock data with a
//     "pending" pill so leadership + CS can see the shape ahead of time.
//   - The moment events start flowing, the same dashboard auto-switches to
//     real data — no code change required.
//
// Status tracking (new / contacted / converted) is intentionally kept in
// localStorage so CS can use the dashboard immediately without a CRM
// integration. Status keys are scoped per `${user_id}:${issuer}` so the
// same lead across two issuers tracks separately.

// ── live SQL builders (only used post-V2-deploy) ────────────────────────────

/**
 * Per-issuer Notify Me click rollup. Drives the "Demand snapshot" KPI cards
 * and the issuer dropdown in the filter bar.
 */
export const notifyMeByIssuer = `
  SELECT
    mapped_issuer,
    issuer_category,
    COUNT(*)                    AS clicks,
    COUNT(DISTINCT user_id)     AS unique_users,
    MAX(timestamp)              AS last_click_at
  FROM asset_search_notify_me_clicked
  WHERE engine_version = 'v2'
    AND timestamp >= now() - INTERVAL '4 weeks'
  GROUP BY 1, 2
  ORDER BY clicks DESC;
`;

/**
 * Per-user outreach detail. Drives the main table. The join to `users`
 * happens server-side (Metabase native question, parameterized by date
 * range + optional issuer). FE only filters/sorts what comes back.
 */
export const notifyMeOutreachDetail = `
  SELECT
    n.user_id,
    u.email,
    u.phone,
    n.mapped_issuer,
    n.issuer_category,
    n.query_text,
    n.active_tab,
    MIN(n.timestamp) AS first_click_at,
    MAX(n.timestamp) AS last_click_at,
    COUNT(*)         AS click_count
  FROM asset_search_notify_me_clicked n
  LEFT JOIN users u ON u.user_id = n.user_id
  WHERE n.engine_version = 'v2'
    AND n.timestamp >= {{from_date}}
    AND (
      {{issuer}} IS NULL OR n.mapped_issuer = {{issuer}}
    )
  GROUP BY 1, 2, 3, 4, 5, 6, 7
  ORDER BY last_click_at DESC;
`;

// ── mock data (used until events flow) ──────────────────────────────────────

/**
 * Mock dataset sized to reflect realistic per-week volume per the V1
 * analytics — Vedika ~310 zero-result queries across 8 weeks (~39/week),
 * Muthoot ~187, Keertana ~140. If 15% of those convert to Notify Me taps
 * once the CTA ships, we'd see ~6-15 clicks per top issuer per week.
 *
 * Names + emails are realistic Indian patterns. Phone numbers are
 * +91 format with sanitised number bodies. Status mix is biased toward
 * 'new' since CS workflow starts fresh each week.
 */
export const outreachMockSample = [
  // Vedika Credit — catalog_gap; persistent demand, ~100% ZRR in V1
  { user_id: 1284532, email: 'rohit.kapoor@gmail.com',     phone: '+91 9876543210', mapped_issuer: 'Vedika Credit',       issuer_category: 'catalog_gap',  query_text: 'vedika credit',     active_tab: 'bonds', click_count: 2, last_click_at: '2026-05-24T09:14:22+05:30', first_click_at: '2026-05-20T16:02:11+05:30' },
  { user_id: 1538912, email: 'a.menon@outlook.com',         phone: '+91 9123450012', mapped_issuer: 'Vedika Credit',       issuer_category: 'catalog_gap',  query_text: 'vedika',             active_tab: 'bonds', click_count: 1, last_click_at: '2026-05-24T11:38:01+05:30', first_click_at: '2026-05-24T11:38:01+05:30' },
  { user_id: 1612220, email: 'sneha.r@hotmail.com',         phone: '+91 9008711234', mapped_issuer: 'Vedika Credit',       issuer_category: 'catalog_gap',  query_text: 'vedik',              active_tab: 'bonds', click_count: 1, last_click_at: '2026-05-23T17:21:47+05:30', first_click_at: '2026-05-23T17:21:47+05:30' },
  { user_id: 1701445, email: 'arjun.iyer@gmail.com',        phone: '+91 9819007711', mapped_issuer: 'Vedika Credit',       issuer_category: 'catalog_gap',  query_text: 'ved',                active_tab: 'bonds', click_count: 3, last_click_at: '2026-05-25T08:02:09+05:30', first_click_at: '2026-05-19T13:44:33+05:30' },
  { user_id: 1822903, email: 'priya.shetty@yahoo.com',      phone: '+91 9742056601', mapped_issuer: 'Vedika Credit',       issuer_category: 'catalog_gap',  query_text: 'vedika credit',     active_tab: 'bonds', click_count: 1, last_click_at: '2026-05-22T20:11:55+05:30', first_click_at: '2026-05-22T20:11:55+05:30' },

  // Muthoot — availability; cycles in/out, very high ZRR when offline
  { user_id: 1455201, email: 'rakesh.j@gmail.com',           phone: '+91 9930221107', mapped_issuer: 'Muthoot Finance',    issuer_category: 'availability', query_text: 'muthoot',           active_tab: 'bonds', click_count: 2, last_click_at: '2026-05-25T10:55:12+05:30', first_click_at: '2026-05-21T14:22:09+05:30' },
  { user_id: 1488731, email: 'nisha.patel@outlook.com',      phone: '+91 9619883344', mapped_issuer: 'Muthoot Finance',    issuer_category: 'availability', query_text: 'muth',               active_tab: 'bonds', click_count: 1, last_click_at: '2026-05-24T16:08:30+05:30', first_click_at: '2026-05-24T16:08:30+05:30' },
  { user_id: 1601023, email: 'vikram.s@gmail.com',           phone: '+91 9870234511', mapped_issuer: 'Muthoot Finance',    issuer_category: 'availability', query_text: 'muthoot finance',    active_tab: 'bonds', click_count: 1, last_click_at: '2026-05-23T11:45:01+05:30', first_click_at: '2026-05-23T11:45:01+05:30' },
  { user_id: 1733009, email: 'd.bhattacharya@hotmail.com',   phone: '+91 9836012245', mapped_issuer: 'Muthoot Finance',    issuer_category: 'availability', query_text: 'muthoot',           active_tab: 'bonds', click_count: 1, last_click_at: '2026-05-22T09:38:44+05:30', first_click_at: '2026-05-22T09:38:44+05:30' },

  // Keertana — availability; went offline around W3 per V1 data
  { user_id: 1390887, email: 'manish.t@gmail.com',           phone: '+91 9871045620', mapped_issuer: 'Keertana Finserv',   issuer_category: 'availability', query_text: 'keertana',          active_tab: 'bonds', click_count: 2, last_click_at: '2026-05-25T07:18:33+05:30', first_click_at: '2026-05-20T18:55:21+05:30' },
  { user_id: 1502778, email: 'shivani.k@outlook.com',        phone: '+91 9920556677', mapped_issuer: 'Keertana Finserv',   issuer_category: 'availability', query_text: 'keer',               active_tab: 'bonds', click_count: 1, last_click_at: '2026-05-24T13:42:50+05:30', first_click_at: '2026-05-24T13:42:50+05:30' },
  { user_id: 1655124, email: 'rajiv.menon@gmail.com',        phone: '+91 9885002233', mapped_issuer: 'Keertana Finserv',   issuer_category: 'availability', query_text: 'keerthana',          active_tab: 'bonds', click_count: 1, last_click_at: '2026-05-23T15:14:09+05:30', first_click_at: '2026-05-23T15:14:09+05:30' },

  // Mufin Green — availability + alias
  { user_id: 1421099, email: 'aditi.n@yahoo.com',            phone: '+91 9743115522', mapped_issuer: 'Mufin Green Finance', issuer_category: 'availability', query_text: 'mufin',              active_tab: 'bonds', click_count: 1, last_click_at: '2026-05-24T19:55:00+05:30', first_click_at: '2026-05-24T19:55:00+05:30' },
  { user_id: 1559013, email: 'p.subramanian@gmail.com',      phone: '+91 9036557788', mapped_issuer: 'Mufin Green Finance', issuer_category: 'availability', query_text: 'mufin green',       active_tab: 'bonds', click_count: 2, last_click_at: '2026-05-25T11:02:17+05:30', first_click_at: '2026-05-21T10:40:08+05:30' },

  // SBI Bonds — catalog_gap; 100% ZRR in V1, never on platform
  { user_id: 1377544, email: 'k.venkatesh@gmail.com',        phone: '+91 9444023311', mapped_issuer: 'SBI Bonds',          issuer_category: 'catalog_gap',  query_text: 'sbi',                active_tab: 'bonds', click_count: 1, last_click_at: '2026-05-24T08:08:08+05:30', first_click_at: '2026-05-24T08:08:08+05:30' },
  { user_id: 1465701, email: 'tanya.gupta@outlook.com',      phone: '+91 9911445566', mapped_issuer: 'SBI Bonds',          issuer_category: 'catalog_gap',  query_text: 'sbi bonds',         active_tab: 'bonds', click_count: 2, last_click_at: '2026-05-25T16:33:21+05:30', first_click_at: '2026-05-22T11:25:14+05:30' },
  { user_id: 1611009, email: 'a.deshmukh@gmail.com',         phone: '+91 9881102233', mapped_issuer: 'SBI Bonds',          issuer_category: 'catalog_gap',  query_text: 'sbi',                active_tab: 'bonds', click_count: 1, last_click_at: '2026-05-23T20:01:42+05:30', first_click_at: '2026-05-23T20:01:42+05:30' },

  // Mahindra Finance — catalog_gap
  { user_id: 1411212, email: 'sandeep.v@gmail.com',          phone: '+91 9742887766', mapped_issuer: 'Mahindra Finance',   issuer_category: 'catalog_gap',  query_text: 'mahindra',          active_tab: 'bonds', click_count: 1, last_click_at: '2026-05-24T14:22:55+05:30', first_click_at: '2026-05-24T14:22:55+05:30' },
  { user_id: 1577488, email: 'meera.rao@hotmail.com',        phone: '+91 9008234455', mapped_issuer: 'Mahindra Finance',   issuer_category: 'catalog_gap',  query_text: 'mahi',               active_tab: 'bonds', click_count: 1, last_click_at: '2026-05-25T09:11:30+05:30', first_click_at: '2026-05-25T09:11:30+05:30' },

  // Bajaj Finance — catalog_gap
  { user_id: 1499876, email: 'h.bhatia@gmail.com',           phone: '+91 9870556622', mapped_issuer: 'Bajaj Finance',      issuer_category: 'catalog_gap',  query_text: 'bajaj',              active_tab: 'bonds', click_count: 2, last_click_at: '2026-05-25T12:48:11+05:30', first_click_at: '2026-05-20T15:30:01+05:30' },
  { user_id: 1632091, email: 'n.choudhury@yahoo.com',        phone: '+91 9836445577', mapped_issuer: 'Bajaj Finance',      issuer_category: 'catalog_gap',  query_text: 'baja',               active_tab: 'bonds', click_count: 1, last_click_at: '2026-05-24T17:55:44+05:30', first_click_at: '2026-05-24T17:55:44+05:30' },
];

// ── data-state classifier ───────────────────────────────────────────────────

/**
 * Three-state classifier so panel components can render an appropriate
 * affordance (pending pill / sparse-warning / live).
 */
export function dataState(rows, { minRows = 5 } = {}) {
  if (!rows || rows.length === 0) return 'pending';
  if (rows.length < minRows) return 'sparse';
  return 'live';
}

// ── localStorage-backed status tracking ─────────────────────────────────────
//
// Status lifecycle: new → contacted → converted (terminal). Stored as a
// single JSON map under one key so we can serialize a list export easily.
// Migrate this to a server-backed status field whenever the CRM team
// owns the workflow.

const STATUS_KEY = 'gripAnalyticsOutreachStatus';
export const OUTREACH_STATUSES = ['new', 'contacted', 'converted'];

function loadStatusMap() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STATUS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    // Corrupted storage — self-heal by clearing the bad value.
    try { window.localStorage.removeItem(STATUS_KEY); } catch { /* ignore */ }
    return {};
  }
}

function saveStatusMap(map) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STATUS_KEY, JSON.stringify(map));
  } catch {
    /* quota exceeded — accept the loss, CS can re-mark */
  }
}

export function statusKey(row) {
  return `${row.user_id}:${row.mapped_issuer}`;
}

export function getOutreachStatus(row) {
  return loadStatusMap()[statusKey(row)]?.status ?? 'new';
}

export function setOutreachStatus(row, status) {
  if (!OUTREACH_STATUSES.includes(status)) return;
  const map = loadStatusMap();
  map[statusKey(row)] = {
    status,
    updated_at: new Date().toISOString(),
  };
  saveStatusMap(map);
}

export function getAllStatuses() {
  return loadStatusMap();
}
