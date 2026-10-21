// End-to-end checks for the business-readiness features (sign-up, settings,
// onboarding, staff, plan limits, CSV import, email outbox, reports).
//
// ⚠ MUTATES DATA. Run ONLY against a server backed by a disposable database
// (e.g. a Neon branch or a separate schema), never production:
//
//   E2E_BASE_URL=http://localhost:3001 E2E_DATABASE_URL="<disposable db url>" \
//     node tests/e2e/business.e2e.mjs
//
// E2E_DATABASE_URL is passed to scripts/set-plan.mjs to test plan limits.
import { deflateSync } from "zlib";
import { execFileSync } from "child_process";

const BASE = process.env.E2E_BASE_URL;
const DB_URL = process.env.E2E_DATABASE_URL;
if (!BASE || !DB_URL) {
  console.error("Set E2E_BASE_URL and E2E_DATABASE_URL (disposable database only). Aborting.");
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
    let payload = body;
    if (body !== undefined && !(body instanceof FormData)) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers: h, body: payload });
    const sc = res.headers.get("set-cookie");
    if (sc && sc.includes("ff_session=")) this.cookie = sc.split(";")[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  get(p) { return this.req("GET", p); }
  post(p, b) { return this.req("POST", p, b ?? {}); }
  patch(p, b) { return this.req("PATCH", p, b); }
  login(email, password) { return this.post("/api/auth/login", { email, password }); }
}

function png() {
  const w = 2, h = 2, raw = Buffer.alloc((w * 4 + 1) * h, 255);
  for (let y = 0; y < h; y++) raw[y * (w * 4 + 1)] = 0;
  const T = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const stamp = Date.now().toString(36);
const ownerEmail = `owner-${stamp}@e2e.test`;

async function main() {
  const owner = new Client();

  console.log("\n# Sign-up & company settings");
  let r = await owner.get("/api/auth/signup");
  check("sign-up is enabled", r.status === 200 && r.data.enabled === true, r.data);
  r = await owner.post("/api/auth/signup", { companyName: `E2E Distributors ${stamp}`, name: "Owner Person", email: ownerEmail, password: "Owner-pass-123", phone: "+880 1711 000000" });
  check("company sign-up → 201 and signed in", r.status === 201 && r.data.user?.role === "ADMIN", r);
  const orgName = `E2E Distributors ${stamp}`;
  r = await new Client().post("/api/auth/signup", { companyName: "Dup Co", name: "Someone Else", email: ownerEmail, password: "Another-pass-123" });
  check("sign-up with an existing email → 409", r.status === 409, r);
  r = await owner.get("/api/onboarding");
  check("new company: onboarding not done", r.status === 200 && r.data.allDone === false && r.data.steps.length >= 5, r.data);
  r = await owner.patch("/api/org", { timezone: "Mars/Olympus" });
  check("invalid timezone rejected → 400", r.status === 400, r);
  r = await owner.patch("/api/org", { phone: "+880 1711 000000", address: "Plot 12, Tejgaon I/A, Dhaka 1208", defaultPickupAddress: "E2E Warehouse, Tejgaon, Dhaka 1208" });
  check("company settings saved", r.status === 200, r);
  r = await owner.get("/api/org");
  check("settings read back (default pickup)", r.data.organization?.defaultPickupAddress === "E2E Warehouse, Tejgaon, Dhaka 1208" && r.data.organization?.plan === "trial", r.data);
  r = await owner.get("/api/onboarding");
  check("onboarding: company step done", r.data.steps.find((s) => s.key.toLowerCase().includes("company"))?.done === true, r.data.steps);
  r = await owner.get("/api/deliveries");
  check("tenant isolation: new company sees 0 deliveries", r.data.total === 0, r.data.total);

  console.log("\n# Team, passwords & plan limits");
  r = await owner.post("/api/vehicles", { registrationNumber: `E2E-${stamp}`.slice(0, 20), type: "VAN" });
  check("add vehicle", r.status === 201, r);
  const vehicleId = r.data.vehicleId;
  r = await owner.post("/api/drivers", { name: "Rahim Uddin", email: `rahim-${stamp}@e2e.test`, password: "Temp-pass-123", phone: "+880 1712 111111", licenseNumber: "DHK-E2E-1", maxActiveJobs: 5 });
  check("add driver", r.status === 201, r);
  const driverId = r.data.driverId;
  const driver = new Client();
  r = await driver.login(`rahim-${stamp}@e2e.test`, "Temp-pass-123");
  check("admin-created driver must change password", r.status === 200 && r.data.user?.mustChangePassword === true, r.data);
  r = await driver.post("/api/auth/password", { currentPassword: "Temp-pass-123", newPassword: "Rahim-own-pass-1" });
  check("driver changes password", r.status === 200, r);
  r = await driver.get("/api/auth/me");
  check("mustChangePassword cleared", r.data.user?.mustChangePassword === false, r.data);
  r = await new Client().login(`rahim-${stamp}@e2e.test`, "Temp-pass-123");
  check("old password no longer works", r.status === 401, r.status);
  r = await owner.post(`/api/drivers/${driverId}/password`, {});
  check("admin resets driver password → temp password returned once", r.status === 200 && typeof r.data.temporaryPassword === "string" && r.data.temporaryPassword.length >= 8, r);
  r = await driver.get("/api/my/jobs");
  check("reset signs the driver out", r.status === 401, r.status);
  r = await driver.login(`rahim-${stamp}@e2e.test`, (await owner.post(`/api/drivers/${driverId}/password`, { password: "Fresh-pass-123" })).data.temporaryPassword);
  check("driver signs in with reset password (must change)", r.status === 200 && r.data.user?.mustChangePassword === true, r.data);
  await driver.post("/api/auth/password", { currentPassword: "Fresh-pass-123", newPassword: "Rahim-own-pass-2" });

  r = await owner.post("/api/staff", { name: "Dispatcher One", email: `disp1-${stamp}@e2e.test` });
  check("add dispatcher → temp password", r.status === 201 && r.data.temporaryPassword, r);
  const disp1 = r.data.userId;
  r = await owner.get("/api/staff");
  const me = r.data.items?.find((s) => s.isYou);
  r = await owner.patch(`/api/staff/${me.id}`, { action: "deactivate" });
  check("cannot deactivate yourself", r.status >= 400 && r.status < 500, r);
  r = await owner.patch(`/api/staff/${disp1}`, { action: "deactivate" });
  check("deactivate a dispatcher", r.status === 200, r);
  await owner.post("/api/staff", { name: "Dispatcher Two", email: `disp2-${stamp}@e2e.test` });
  await owner.post("/api/staff", { name: "Dispatcher Three", email: `disp3-${stamp}@e2e.test` });
  r = await owner.post("/api/staff", { name: "Dispatcher Four", email: `disp4-${stamp}@e2e.test` });
  check("trial plan: 4th active admin blocked → 403", r.status === 403 && /plan/i.test(r.data.error), r);

  const setPlan = (plan) =>
    execFileSync(process.execPath, ["scripts/set-plan.mjs", "--org", orgName, "--plan", plan], { env: { ...process.env, DATABASE_URL: DB_URL }, encoding: "utf8" });
  const out = setPlan("starter");
  check("set-plan script switches plan", /starter/i.test(out), out.slice(-300));
  r = await owner.get("/api/billing");
  check("billing shows new plan + usage", r.status === 200 && r.data.plan?.code === "starter" && r.data.usage?.drivers === 1, r.data);
  const extra = [];
  for (let i = 2; i <= 5; i++) {
    extra.push((await owner.post("/api/drivers", { name: `Driver ${i}`, email: `d${i}-${stamp}@e2e.test`, password: "Temp-pass-123", phone: `+880 17130000${i}0`, licenseNumber: `LIC-${i}` })).status);
  }
  check("starter: drivers 2–5 allowed", extra.every((s) => s === 201), extra);
  r = await owner.post("/api/drivers", { name: "Driver Six", email: `d6-${stamp}@e2e.test`, password: "Temp-pass-123", phone: "+880 1713000060", licenseNumber: "LIC-6" });
  check("starter: 6th driver blocked → 403", r.status === 403 && /Starter/.test(r.data.error), r);
  setPlan("growth");

  console.log("\n# CSV import");
  r = await owner.get("/api/deliveries/import/template");
  check("template download is CSV", r.status === 200 && /order_ref/.test(r.data) && (r.headers.get("content-disposition") || "").includes("attachment"), r.headers.get("content-type"));
  const csv = [
    "order_ref,recipient_name,recipient_phone,recipient_email,pickup_address,delivery_address,instructions,priority,expected_delivery",
    `INV-${stamp}-1,Karim Ahmed,01711-222333,karim-${stamp}@e2e.test,,"House 5, Road 3, Dhanmondi, Dhaka",Call first,high,`,
    `INV-${stamp}-2,Nusrat Jahan,+880 1811 444555,,,"Flat 4B, Uttara Sector 7, Dhaka",,normal,2030-01-15 14:00`,
    `INV-${stamp}-3,,01911-666777,,,"Mirpur 10, Dhaka",,low,`,
    `INV-${stamp}-1,Duplicate Ref,01711-999000,,,"Gulshan 1, Dhaka",,,`,
    `INV-${stamp}-5,Bad Date,01711-555111,,,"Banani, Dhaka",,urgent,31/02/2030`,
  ].join("\r\n");
  const body = { fileName: `orders-${stamp}.csv`, csv };
  r = await owner.post("/api/deliveries/import", { ...body, mode: "preview" });
  check("preview counts: 2 valid, 2 invalid, 1 duplicate", r.status === 200 && r.data.totals?.valid === 2 && r.data.totals?.invalid === 2 && r.data.totals?.duplicates === 1, r.data.totals);
  const errRow = r.data.rows?.find((x) => x.rowNumber === 4);
  check("row-specific error (row 4: missing name)", errRow?.status === "invalid" && errRow.errors.some((e) => /name/i.test(e.field + e.message)), errRow);
  const dateRow = r.data.rows?.find((x) => x.rowNumber === 6);
  check("impossible date rejected (31/02)", dateRow?.status === "invalid", dateRow);
  r = await owner.get("/api/deliveries");
  check("preview saved nothing", r.data.total === 0, r.data.total);
  r = await owner.post("/api/deliveries/import", { ...body, mode: "commit" });
  check("commit → imported 2, skipped 1, failed 2", r.status === 201 && r.data.imported === 2 && r.data.skipped === 1 && r.data.failed === 2, r);
  const batchId = r.data.batchId;
  r = await owner.post("/api/deliveries/import", { ...body, mode: "commit" });
  check("re-importing the same file → 409", r.status === 409, r);
  r = await owner.post("/api/deliveries/import", { fileName: "again.csv", csv: csv.split("\r\n").slice(0, 3).join("\n"), mode: "preview" });
  check("rows already imported are flagged as duplicates", r.data.totals?.duplicates === 2 && r.data.totals?.valid === 0, r.data.totals);
  r = await owner.get(`/api/deliveries?importBatchId=${batchId}`);
  check("filter by import batch", r.data.total === 2, r.data.total);
  const imported = r.data.items;
  check("pickup defaulted from company settings", imported.every((d) => d.pickupAddress === "E2E Warehouse, Tejgaon, Dhaka 1208"), imported.map((d) => d.pickupAddress));
  r = await owner.get(`/api/deliveries?search=INV-${stamp}-2`);
  check("search by order reference", r.data.total === 1, r.data.total);

  console.log("\n# Notifications (console mode → SIMULATED)");
  await new Promise((res) => setTimeout(res, 1500)); // customer emails are sent after the response
  r = await owner.get("/api/notifications?channel=EMAIL");
  check("outbox reports simulated mode", r.status === 200 && r.data.emailStatus?.provider === "console", r.data.emailStatus);
  const custEmail = r.data.items?.find((n) => n.recipientEmail === `karim-${stamp}@e2e.test`);
  check("customer tracking email recorded as SIMULATED", custEmail?.status === "SIMULATED", custEmail);
  const noDeadline = imported.find((d) => !d.expectedAt);
  r = await owner.post(`/api/deliveries/${noDeadline.id}/assign`, { driverId, vehicleId });
  check("assign imported delivery", r.status === 200, r);
  r = await owner.get("/api/notifications?channel=EMAIL");
  const assignEmails = r.data.items.filter((n) => n.type === "NEW_ASSIGNMENT" && n.deliveryId === noDeadline.id);
  check("driver assignment email: exactly one, SIMULATED", assignEmails.length === 1 && assignEmails[0].status === "SIMULATED", assignEmails);
  r = await owner.post("/api/notifications/retry", { allFailed: true });
  check("retry endpoint (nothing failed)", r.status === 200, r);

  console.log("\n# Delivery without a deadline → reports");
  await driver.post(`/api/deliveries/${noDeadline.id}/status`, { status: "PICKED_UP" });
  await driver.post(`/api/deliveries/${noDeadline.id}/status`, { status: "IN_TRANSIT" });
  const f = new FormData();
  f.set("file", new Blob([png()], { type: "image/png" }), "sig.png"); f.set("recipientName", "Karim Ahmed"); f.set("kind", "SIGNATURE"); f.set("complete", "true");
  r = await driver.req("POST", `/api/deliveries/${noDeadline.id}/pod`, f);
  check("driver completes with POD", r.status === 201, r);
  const tz = new Date().getTimezoneOffset();
  r = await owner.get(`/api/reports?tz=${tz}`);
  const s = r.data.summary;
  check("report: 1 delivered, no deadline → on-time rate null (not 100%)", s?.completed === 1 && s.onTimeRate === null && s.deliveredWithoutDeadline === 1, s);
  check("report: success rate 100% (1 delivered, 0 failed)", s?.successRate === 100, s?.successRate);
  r = await owner.get(`/api/dashboard?tz=${tz}`);
  check("dashboard on-time rate also null", r.data.stats?.onTimeRate === null, r.data.stats);
  await new Promise((res) => setTimeout(res, 1500));
  r = await owner.get("/api/notifications?channel=EMAIL");
  check("customer 'delivered' email recorded", r.data.items.some((n) => n.recipientEmail === `karim-${stamp}@e2e.test` && n.type === "DELIVERED"), r.data.items.slice(0, 3).map((n) => [n.type, n.recipientEmail]));
  r = await owner.get("/api/onboarding");
  check("onboarding complete after vehicle/driver/delivery/assignment", r.data.allDone === true, r.data.steps);

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
