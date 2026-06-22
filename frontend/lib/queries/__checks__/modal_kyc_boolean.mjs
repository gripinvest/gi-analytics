// Run: node frontend/lib/queries/__checks__/modal_kyc_boolean.mjs
//
// Regression guard for the prod crash where clicking a user_id blew up the
// whole screen. Root cause: obpp_kyc_status (and investment_status) come back
// from DuckDB as BOOLEANs, but UserSearchHistoryModal computed
//   kyc = data.map((r) => (r.kyc || "").trim())...
// `(true || "").trim()` calls .trim() on a boolean -> TypeError, thrown inside
// a useMemo during render -> React error boundary -> full-screen crash.
//
// This asserts (a) the OLD expression throws on boolean true, and (b) the NEW
// logic the modal now uses is crash-safe and yields Yes/No.

const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };

// isTrue: copied verbatim from UserSearchHistoryModal (handles bool / "True" / 1 / "1")
const isTrue = (v) => v === true || v === "True" || v === 1 || v === "1";

// real-shaped rows: kyc + invested are BOOLEAN, gc_name is VARCHAR|null
const rowsKycTrue = [{ kyc: true, gc_name: "ET money", invested: false }];
const rowsKycFalse = [{ kyc: false, gc_name: null, invested: true }];

// (a) the OLD pattern must throw on a KYC-completed (boolean true) user
let oldThrew = false;
try { rowsKycTrue.map((r) => (r.kyc || "").trim()); }
catch (e) { oldThrew = e instanceof TypeError; }
assert(oldThrew, "expected the old (r.kyc||'').trim() pattern to throw TypeError on boolean true");

// (b) the NEW logic must be crash-safe and correct
function summarize(data) {
  const gc = data.map((r) => String(r.gc_name ?? "").trim()).find(Boolean);
  const kycDone = data.some((r) => isTrue(r.kyc));
  return { source: gc ? `GC · ${gc}` : "Platform", kyc: kycDone ? "Yes" : "No" };
}
const a = summarize(rowsKycTrue);
assert(a.kyc === "Yes", `kyc=true -> "Yes", got ${a.kyc}`);
assert(a.source === "GC · ET money", `gc -> "GC · ET money", got ${a.source}`);
const b = summarize(rowsKycFalse);
assert(b.kyc === "No", `kyc=false -> "No", got ${b.kyc}`);
assert(b.source === "Platform", `null gc -> "Platform", got ${b.source}`);

console.log("PASS: modal_kyc_boolean");
