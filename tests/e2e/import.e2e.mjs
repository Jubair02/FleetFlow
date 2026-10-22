// End-to-end checks for bulk delivery import (pasted / mapped rows):
// validation, duplicate handling, idempotent retries, chunked large
// imports, limits and organization isolation.
//
// ⚠ MUTATES DATA (imports ~1,200 deliveries). Run ONLY against a server
// backed by a disposable database containing the demo seed:
//
//   E2E_BASE_URL=http://localhost:3001 node tests/e2e/import.e2e.mjs
const BASE = process.env.E2E_BASE_URL;
if (!BASE) {
  console.error("Set E2E_BASE_URL to a server backed by a disposable database. Aborting.");
  process.exit(2);
}

let pass = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { failures.push(name); console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ""); }
}

class Client {
  constructor() { this.cookie = ""; }
  async req(method, path, body) {
    const h = { Origin: BASE };
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h["Content-Type"] = "application/json";
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get("set-cookie");
    if (sc && sc.includes("ff_session=")) this.cookie = sc.split(";")[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  get(p) { return this.req("GET", p); }
  post(p, b) { return this.req("POST", p, b ?? {}); }
}

const stamp = Date.now().toString(36);
const ref = (n) => `PX-${stamp}-${n}`;
const row = (rowNumber, values) => ({ rowNumber, values });
const good = (rowNumber, n, extra = {}) =>
  row(rowNumber, {
    order_ref: ref(n),
    recipient_name: `Shop ${n}`,
    recipient_phone: `0171${String(1000000 + n).slice(-7)}`,
    pickup_address: "Central Depot, Tejgaon, Dhaka",
    delivery_address: `House ${n}, Road ${n % 20}, Mirpur, Dhaka`,
    priority: "normal",
    ...extra,
  });

async function main() {
  const admin = new Client();
  const north = new Client();
  const driver = new Client();
  await admin.post("/api/auth/login", { email: "admin@fleetflow.test", password: "Admin123!" });
  await north.post("/api/auth/login", { email: "admin2@fleetflow.test", password: "Admin123!" });
  await driver.post("/api/auth/login", { email: "driver@fleetflow.test", password: "Driver123!" });

  console.log("\n# Access");
  let r = await driver.post("/api/deliveries/import", { mode: "preview", source: "PASTE", fileName: "Pasted rows", rows: [good(2, 1)] });
  check("driver can't import → 403", r.status === 403, r.status);

  // An existing delivery for the "likely duplicate" check (same phone + address + day)
  const existingDay = "2030-03-10";
  r = await admin.post("/api/deliveries", {
    recipientName: "Existing Shop", recipientPhone: "01755123456", pickupAddress: "Central Depot, Tejgaon, Dhaka",
    deliveryAddress: "Plot 9, Banani, Dhaka", expectedAt: `${existingDay}T12:00:00+06:00`,
  });
  check("seed an existing delivery", r.status === 201, r);
  const existingCode = r.data.delivery?.trackingCode;

  console.log("\n# Preview of pasted rows");
  const rows = [
    good(2, 1),
    good(3, 2, { expected_delivery: "15/03/2030 14:30", recipient_email: `c2-${stamp}@x.test` }),
    row(4, { recipient_phone: "01711999000", delivery_address: "Gulshan 2, Dhaka", pickup_address: "Depot" }), // missing name
    good(5, 4, { expected_delivery: "31/02/2030" }), // impossible date
    good(6, 1), // exact order ref duplicate in file
    row(7, { recipient_name: "Banani Store", recipient_phone: "+880 1755-123456", pickup_address: "Central Depot, Tejgaon, Dhaka", delivery_address: "Plot 9, Banani, Dhaka", expected_delivery: existingDay }), // likely dup of existing
  ];
  const body = { mode: "preview", source: "PASTE", fileName: "Pasted rows", rows };
  r = await admin.post("/api/deliveries/import", body);
  const t = r.data.totals;
  check("preview totals: 2 valid, 2 invalid, 2 duplicates", r.status === 200 && t?.valid === 2 && t.invalid === 2 && t.duplicates === 2, r.data.totals ?? r.data);
  const byRow = Object.fromEntries((r.data.rows ?? []).map((x) => [x.rowNumber, x]));
  check("row 4: missing recipient name", byRow[4]?.status === "invalid" && byRow[4].errors.some((e) => e.field === "recipient_name"), byRow[4]);
  check("row 5: impossible date rejected", byRow[5]?.status === "invalid" && byRow[5].errors.some((e) => e.field === "expected_delivery"), byRow[5]);
  check("row 6: exact order-ref duplicate in file", byRow[6]?.status === "duplicate" && byRow[6].duplicateOf?.kind === "order_ref_in_file", byRow[6]?.duplicateOf);
  check("row 7: likely duplicate of the existing delivery", byRow[7]?.status === "duplicate" && byRow[7].duplicateOf?.kind === "likely_existing" && byRow[7].duplicateOf.trackingCode === existingCode, byRow[7]?.duplicateOf);
  check("contentHash + plan room reported", typeof r.data.contentHash === "string" && "monthlyDeliveriesRemaining" in r.data, Object.keys(r.data));
  r = await admin.get(`/api/deliveries?search=${ref(1)}`);
  check("preview saved nothing", r.data.total === 0, r.data.total);

  r = await admin.post("/api/deliveries/import", { ...body, rows: rows.map((x) => ({ rowNumber: x.rowNumber, values: { ...x.values, recipient_name: undefined } })) });
  check("unmapped required column → every row explains it", r.status === 200 && r.data.totals?.valid === 0 && r.data.rows.every((x) => x.errors.some((e) => e.field === "recipient_name")), r.data.totals ?? r.data);
  r = await admin.post("/api/deliveries/import", { ...body, rows: [good(2, 1), good(2, 2)] });
  check("duplicate row numbers rejected → 400", r.status === 400, r.status);

  console.log("\n# Commit, override & idempotent retry");
  const commit = (extra) => admin.post("/api/deliveries/import", { mode: "commit", source: "PASTE", fileName: "Pasted rows", rows, ...extra });
  r = await commit({});
  check("commit without idempotencyKey → 400", r.status === 400, r.status);
  const key = `sess-${stamp}:0`;
  r = await commit({ idempotencyKey: key, allowLikelyDuplicates: [6, 7] });
  check("commit: imported 3 (incl. overridden likely dup), skipped 1, failed 2", r.status === 201 && r.data.imported === 3 && r.data.skipped === 1 && r.data.failed === 2 && r.data.replayed === false, r.data);
  check("row 7 imported via override; row 6 (exact ref) never", r.data.importedRows?.includes(7) && r.data.skippedRows?.includes(6), [r.data.importedRows, r.data.skippedRows]);
  const firstBatch = r.data.batchId;
  r = await commit({ idempotencyKey: key, allowLikelyDuplicates: [6, 7] });
  check("retry with the same key → replayed, same result", r.status === 200 && r.data.replayed === true && r.data.batchId === firstBatch && r.data.imported === 3, r.data);
  r = await admin.get(`/api/deliveries?importBatchId=${firstBatch}`);
  check("no duplicate deliveries after the retry", r.data.total === 3, r.data.total);
  r = await commit({ idempotencyKey: `sess-${stamp}-other:0`, allowLikelyDuplicates: [7] });
  check("same content with a new key → 409 already imported", r.status === 409, r);
  r = await admin.get(`/api/deliveries?search=${ref(2)}`);
  check("pasted date parsed in Dhaka time (15 Mar 14:30 +06)", r.data.items?.[0]?.expectedAt === "2030-03-15T08:30:00.000Z", r.data.items?.[0]?.expectedAt);

  console.log("\n# Limits");
  const many = (start, count, rowStart = 2) => Array.from({ length: count }, (_, i) => good(rowStart + i, start + i));
  r = await admin.post("/api/deliveries/import", { mode: "commit", source: "PASTE", fileName: "Big", rows: many(100000, 501), idempotencyKey: `big-${stamp}:x` });
  check("commit chunk over 500 rows → 400", r.status === 400, r.status);
  r = await admin.post("/api/deliveries/import", { mode: "preview", source: "PASTE", fileName: "Huge", rows: many(200000, 5001) });
  check("preview over 5,000 rows → 400/413", r.status === 400 || r.status === 413, r.status);

  console.log("\n# Large import in chunks (1,200 rows)");
  const big = many(10000, 1200);
  const t0 = Date.now();
  r = await admin.post("/api/deliveries/import", { mode: "preview", source: "CSV", fileName: "orders-1200.csv", rows: big });
  check("preview 1,200 rows: all valid", r.status === 200 && r.data.totals?.valid === 1200, r.data.totals ?? r.data);
  const before = (await admin.get("/api/deliveries?pageSize=5")).data.total;
  const chunks = [big.slice(0, 500), big.slice(500, 1000), big.slice(1000)];
  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    results.push(await admin.post("/api/deliveries/import", { mode: "commit", source: "CSV", fileName: "orders-1200.csv", rows: chunks[i], idempotencyKey: `big-${stamp}:${i}` }));
  }
  check("3 chunk commits succeed (500 + 500 + 200)", results.every((x) => x.status === 201) && results.map((x) => x.data.imported).join() === "500,500,200", results.map((x) => [x.status, x.data.imported ?? x.data.error]));
  r = await admin.post("/api/deliveries/import", { mode: "commit", source: "CSV", fileName: "orders-1200.csv", rows: chunks[1], idempotencyKey: `big-${stamp}:1` });
  check("retrying a finished chunk replays it", r.status === 200 && r.data.replayed === true && r.data.imported === 500, r.data);
  const after = (await admin.get("/api/deliveries?pageSize=5")).data.total;
  check("exactly 1,200 new deliveries", after - before === 1200, { before, after });
  console.log(`  (1,200-row preview + 3 commits took ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  console.log("\n# Isolation & compatibility");
  r = await north.get(`/api/deliveries?importBatchId=${firstBatch}`);
  check("other organization can't see the imported batch", r.data.total === 0, r.data.total);
  r = await north.post("/api/deliveries/import", { mode: "commit", source: "PASTE", fileName: "Pasted rows", rows: [good(2, 777777)], idempotencyKey: key });
  check("same idempotency key in another org is independent (imports, not a replay)", r.status === 201 && r.data.replayed === false && r.data.imported === 1, r.data);
  r = await admin.post("/api/deliveries/import", { mode: "preview", fileName: "legacy.csv", csv: "recipient_name,recipient_phone,delivery_address,pickup_address\nLegacy Shop,01711222333,Dhaka 1212,Depot Dhaka" });
  check("legacy CSV body still works", r.status === 200 && r.data.totals?.valid === 1, r.data.totals ?? r.data);

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
