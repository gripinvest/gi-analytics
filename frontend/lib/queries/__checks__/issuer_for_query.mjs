// Run: node frontend/lib/queries/__checks__/issuer_for_query.mjs
import { issuerForQuery } from "../assetSearch.js";
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };
assert(issuerForQuery("muthoot finance") === "Muthoot Finance", "muthoot");
assert(issuerForQuery("ved") === "Vedika Credit", "vedika prefix");
assert(issuerForQuery("zzz nope") === null, "unmapped -> null");
assert(issuerForQuery("") === null, "empty -> null");
console.log("PASS: issuer_for_query");
