// End-to-end checks for editable plan management (platform console API):
// plan CRUD & validation, feature gating, price grandfathering, limit-change
// impact confirmation, deactivation/default rules and audit.
//
// ⚠ MUTATES DATA. Run ONLY against a server backed by a disposable database
// containing the demo seed and the seeded plans:
//
//   E2E_BASE_URL=http://localhost:3001 E2E_DATABASE_URL="<disposable db url>" \
//     node tests/e2e/plans.e2e.mjs
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
  constructor() { this.cookies = {}; }
  get cookie() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(method, path, body) {
    const h = { Origin: BASE };
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h["Content-Type"] = "application/json";
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      this.cookies[pair.slice(0, i)] = pair.slice(i + 1);
    }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  get(p) { return this.req("GET", p); }
  post(p, b) { return this.req("POST", p, b ?? {}); }
  patch(p, b) { return this.req("PATCH", p, b); }
}

const stamp = Date.now().toString(36);
const code = `pilot-${stamp}`.slice(0, 32);
const planBody = (over = {}) => ({
  code,
  name: "Pilot Plus",
  description: "E2E pilot plan",
  monthlyPriceBdt: 2500,
  annualPriceBdt: 25000,
  limits: { drivers: 2, vehicles: 2, admins: 1, monthlyDeliveries: 100 },
  features: ["report_export"],
  highlights: ["Pilot pricing"],
  isPublic: false,
  sortOrder: 9,
  ...over,
});
const { code: _omit, ...updateBase } = planBody();
void _omit;

async function main() {
  const superEmail = `plans-${stamp}@platform.test`;
  const superPassword = `Plans-${stamp}-pass!`;
  execFileSync(process.execPath, ["scripts/create-super-admin.mjs", "--email", superEmail, "--name", "Plans Admin"], {
    env: { ...process.env, DATABASE_URL: DB_URL, SUPER_ADMIN_PASSWORD: superPassword }, encoding: "utf8",
  });
  const ops = new Client();
  await ops.post("/api/platform/auth/login", { email: superEmail, password: superPassword });
  const swift = new Client();
  await swift.post("/api/auth/login", { email: "admin@fleetflow.test", password: "Admin123!" });
  const anon = new Client();

  console.log("\n# Access & seeded plans");
  let r = await swift.get("/api/platform/plans");
  check("company admin can't read platform plans → 401", r.status === 401, r.status);
  r = await swift.patch("/api/platform/plans/growth", { action: "deactivate" });
  check("company admin can't change plans → 401", r.status === 401, r.status);
  r = await ops.get("/api/platform/plans");
  const seeded = r.data.plans ?? [];
  check("4 seeded plans, trial is the default", seeded.length >= 4 && seeded.find((p) => p.code === "trial")?.isDefault === true, seeded.map((p) => [p.code, p.isDefault]));
  r = await anon.get("/api/plans");
  // Compare against the configured flags (admins may make any plan public, e.g. Trial).
  const expectedPublic = seeded.filter((p) => p.active && p.isPublic).map((p) => p.code).sort().join();
  check("public pricing lists exactly the active public plans", r.status === 200 && r.data.plans.map((p) => p.code).sort().join() === expectedPublic, [r.data.plans?.map((p) => p.code), expectedPublic]);

  console.log("\n# Create & validate");
  r = await ops.post("/api/platform/plans", planBody({ code: "Bad Code!" }));
  check("invalid plan code → 400", r.status === 400, r.status);
  r = await ops.post("/api/platform/plans", planBody({ features: ["teleportation"] }));
  check("unknown feature → 400", r.status === 400, r.status);
  r = await ops.post("/api/platform/plans", planBody());
  check("create plan → 201", r.status === 201 || r.status === 200, r);
  r = await ops.post("/api/platform/plans", planBody());
  check("duplicate plan code → 409", r.status === 409, r.status);
  r = await anon.get("/api/plans");
  check("hidden plan not on public pricing", !r.data.plans.some((p) => p.code === code));

  console.log("\n# Organization on the new plan");
  r = await ops.post("/api/platform/organizations", { companyName: `Pilot Co ${stamp}`, adminName: "Pilot Admin", adminEmail: `pilot-${stamp}@pilot.test`, plan: code });
  check("create organization on the new plan", r.status === 201, r);
  const orgId = r.data.organizationId;
  const pilot = new Client();
  await pilot.post("/api/auth/login", { email: `pilot-${stamp}@pilot.test`, password: r.data.temporaryPassword });
  r = await ops.get(`/api/platform/organizations/${orgId}`);
  check("price snapshot = list price (2500 monthly)", r.data.organization?.subscriptionPriceBdt === 2500 && r.data.organization.billingCycle === "MONTHLY" && r.data.planDetail?.code === code, r.data.organization);
  r = await pilot.get("/api/org");
  check("company sees plan features", r.data.planInfo?.code === code && r.data.planInfo.features.includes("report_export") && !r.data.planInfo.features.includes("csv_import"), r.data.planInfo);

  console.log("\n# Feature gating (server-side)");
  r = await pilot.post("/api/deliveries/import", { fileName: "x.csv", csv: "recipient_name,recipient_phone,delivery_address\nA B,01711000000,Dhaka 1212", mode: "preview" });
  check("CSV import blocked without csv_import → 403", r.status === 403 && /plan/i.test(r.data.error), r);
  r = await pilot.get("/api/deliveries/import/template");
  check("import template blocked too → 403", r.status === 403, r.status);
  r = await pilot.get(`/api/reports?export=1&tz=${new Date().getTimezoneOffset()}`);
  check("report export allowed with report_export", r.status === 200, r.status);
  r = await pilot.post("/api/deliveries", { recipientName: "Cust One", recipientPhone: "01711000001", pickupAddress: "Depot, Dhaka 1200", deliveryAddress: "Shop 1, Dhaka 1212", recipientEmail: `cust-${stamp}@x.test` });
  check("delivery creation still works", r.status === 201, r);
  await new Promise((res) => setTimeout(res, 1500));
  r = await pilot.get("/api/notifications?channel=EMAIL");
  check("customer email skipped without customer_emails", r.status === 200 && !r.data.items.some((n) => n.recipientEmail === `cust-${stamp}@x.test`), r.data.items?.map((n) => n.recipientEmail));
  r = await swift.get(`/api/reports?export=1&tz=0`);
  check("other company (growth) still exports", r.status === 200, r.status);

  console.log("\n# Limits");
  const addDriver = (i) => pilot.post("/api/drivers", { name: `Pilot Driver ${i}`, email: `pd${i}-${stamp}@pilot.test`, password: "Temp-pass-123", phone: `0171100${i}000`, licenseNumber: `PD-${i}` });
  const d1 = await addDriver(1), d2 = await addDriver(2), d3 = await addDriver(3);
  check("drivers 1–2 allowed, 3rd blocked by plan limit", d1.status === 201 && d2.status === 201 && d3.status === 403, [d1.status, d2.status, d3.status]);

  console.log("\n# Price change → grandfathering");
  r = await ops.patch(`/api/platform/plans/${code}`, { action: "update", plan: { ...updateBase, monthlyPriceBdt: 3000 } });
  check("raise list price", r.status === 200, r);
  r = await ops.get(`/api/platform/organizations/${orgId}`);
  check("existing subscriber keeps agreed 2500", r.data.organization?.subscriptionPriceBdt === 2500 && r.data.currentListPriceBdt === 3000, [r.data.organization?.subscriptionPriceBdt, r.data.currentListPriceBdt]);
  r = await ops.get("/api/platform/plans");
  check("plan shows 1 grandfathered subscriber", r.data.plans.find((p) => p.code === code)?.grandfatheredCount === 1, r.data.plans.find((p) => p.code === code));
  r = await ops.patch(`/api/platform/plans/${code}`, { action: "apply-price-to-subscribers", billingCycle: "MONTHLY" });
  check("apply new price to subscribers (opt-in) → 1 updated", r.status === 200 && r.data.updated === 1, r);
  r = await ops.get(`/api/platform/organizations/${orgId}`);
  check("subscriber now at 3000", r.data.organization?.subscriptionPriceBdt === 3000, r.data.organization?.subscriptionPriceBdt);

  console.log("\n# Limit decrease → impact confirmation");
  const lower = { ...updateBase, monthlyPriceBdt: 3000, limits: { ...updateBase.limits, drivers: 1 } };
  r = await ops.post(`/api/platform/plans/${code}/preview`, { limits: lower.limits });
  check("preview lists the over-limit organization", r.status === 200 && r.data.impact?.some((i) => i.organizationId === orgId && i.over.some((o) => o.resource === "drivers" && o.usage === 2 && o.limit === 1)), r.data);
  r = await ops.patch(`/api/platform/plans/${code}`, { action: "update", plan: lower });
  check("update without confirmation → 409 with impact", r.status === 409 && Array.isArray(r.data.impact) && r.data.impact.length === 1, r);
  r = await ops.patch(`/api/platform/plans/${code}`, { action: "update", plan: lower, confirmImpact: true });
  check("update with confirmation → 200", r.status === 200, r);
  r = await pilot.get("/api/drivers");
  check("existing drivers untouched (2 still active)", r.data.items?.filter((d) => d.active).length === 2, r.data.items?.length);
  r = await pilot.patch(`/api/drivers/${d2.data.driverId}`, { active: false });
  r = await pilot.patch(`/api/drivers/${d2.data.driverId}`, { active: true });
  check("re-activating over the new limit is blocked → 403", r.status === 403, r.status);

  console.log("\n# Deactivate & default rules");
  r = await ops.patch("/api/platform/plans/trial", { action: "deactivate" });
  check("default plan can't be deactivated", r.status >= 400 && r.status < 500, r.status);
  r = await ops.patch(`/api/platform/plans/${code}`, { action: "deactivate" });
  check("deactivate plan", r.status === 200, r);
  r = await ops.patch(`/api/platform/plans/${code}`, { action: "make-default" });
  check("inactive plan can't become default", r.status >= 400 && r.status < 500, r.status);
  const swiftId = (await ops.get(`/api/platform/organizations?search=SwiftDrop`)).data.items?.[0]?.id;
  r = await ops.patch(`/api/platform/organizations/${swiftId}`, { action: "set-plan", plan: code, billingCycle: "MONTHLY" });
  check("inactive plan can't be newly assigned", r.status >= 400 && r.status < 500, r.status);
  r = await pilot.get("/api/drivers");
  check("subscriber on the inactive plan keeps working", r.status === 200, r.status);
  r = await ops.patch(`/api/platform/plans/${code}`, { action: "activate" });
  r = await ops.patch(`/api/platform/plans/${code}`, { action: "make-default" });
  check("make an active plan the sign-up default", r.status === 200, r);
  r = await new Client().post("/api/auth/signup", { companyName: `Default Co ${stamp}`, name: "Default Owner", email: `def-${stamp}@x.test`, password: "Default-pass-123" });
  const defOrg = (await ops.get(`/api/platform/organizations?search=${encodeURIComponent("Default Co " + stamp)}`)).data.items?.[0];
  check("new sign-up gets the new default plan", r.status === 201 && defOrg?.plan === code, defOrg);
  r = await ops.get("/api/platform/plans");
  check("exactly one default plan", r.data.plans.filter((p) => p.isDefault).length === 1, r.data.plans.map((p) => [p.code, p.isDefault]));
  await ops.patch("/api/platform/plans/trial", { action: "make-default" });

  console.log("\n# Negotiated price & cycle");
  r = await ops.patch(`/api/platform/organizations/${orgId}`, { action: "set-plan", plan: "growth", billingCycle: "ANNUAL", priceBdt: 35000 });
  check("assign growth annually at a negotiated price", r.status === 200, r);
  r = await ops.get(`/api/platform/organizations/${orgId}`);
  check("snapshot: growth / ANNUAL / 35000 (list 40000)", r.data.organization?.plan === "growth" && r.data.organization.billingCycle === "ANNUAL" && r.data.organization.subscriptionPriceBdt === 35000 && r.data.currentListPriceBdt === 40000, r.data.organization);
  r = await ops.patch(`/api/platform/organizations/${orgId}`, { action: "set-plan", plan: "growth", billingCycle: "ANNUAL", priceBdt: 35000 });
  check("no-op plan change → 409", r.status === 409, r.status);
  r = await pilot.post("/api/deliveries/import", { fileName: "y.csv", csv: "recipient_name,recipient_phone,delivery_address,pickup_address\nA B,01711000000,Dhaka 1212,Depot Dhaka", mode: "preview" });
  check("after upgrade to growth, CSV import is available", r.status === 200, r.status);

  console.log("\n# Existing customers & audit");
  r = await ops.get(`/api/platform/organizations/${swiftId}`);
  check("SwiftDrop unchanged (growth, monthly, 4000)", r.data.organization?.plan === "growth" && r.data.organization.subscriptionPriceBdt === 4000 && r.data.organization.billingCycle === "MONTHLY", r.data.organization);
  r = await ops.get("/api/platform/audit?action=PLAN");
  const acts = new Set(r.data.items?.map((a) => a.action));
  for (const a of ["PLAN_CREATED", "PLAN_UPDATED", "PLAN_PRICE_APPLIED", "PLAN_DEACTIVATED", "PLAN_ACTIVATED", "PLAN_DEFAULT_CHANGED", "PLAN_CHANGED"]) {
    check(`audit records ${a}`, acts.has(a), [...acts]);
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
