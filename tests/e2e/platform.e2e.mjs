// End-to-end checks for the platform (super admin) console API:
// authorization boundaries, organization lifecycle, suspension isolation,
// user administration and auditing.
//
// ⚠ MUTATES DATA (creates a platform admin + organizations). Run ONLY against
// a server backed by a disposable database containing the demo seed:
//
//   E2E_BASE_URL=http://localhost:3001 E2E_DATABASE_URL="<disposable db url>" \
//     node tests/e2e/platform.e2e.mjs
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
    return { status: res.status, data, text };
  }
  get(p) { return this.req("GET", p); }
  post(p, b) { return this.req("POST", p, b ?? {}); }
  patch(p, b) { return this.req("PATCH", p, b); }
}

const HASH_LIKE = /[0-9a-f]{32}:[0-9a-f]{128}/;
const stamp = Date.now().toString(36);
const superEmail = `ops-${stamp}@platform.test`;
const superPassword = `Platform-${stamp}-pass!`;

function bootstrap(args, password) {
  const env = { ...process.env, DATABASE_URL: DB_URL };
  if (password) env.SUPER_ADMIN_PASSWORD = password; else delete env.SUPER_ADMIN_PASSWORD;
  try {
    return { ok: true, out: execFileSync(process.execPath, ["scripts/create-super-admin.mjs", ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.stdout || e.message) };
  }
}

const PLATFORM_GETS = ["/api/platform/overview", "/api/platform/organizations", "/api/platform/users", "/api/platform/plans", "/api/platform/audit", "/api/platform/settings"];

async function main() {
  console.log("\n# Bootstrap");
  let b = bootstrap(["--email", superEmail, "--name", "Ops Admin"], superPassword);
  check("create-super-admin script creates the first admin", b.ok && /Created platform admin/.test(b.out), b.out);
  check("script never prints a chosen password", !b.out.includes(superPassword));
  b = bootstrap(["--email", superEmail, "--name", "Ops Admin"], superPassword);
  check("script refuses a duplicate email", !b.ok && /already exists/.test(b.out), b.out);

  console.log("\n# Authorization boundaries");
  const anon = new Client();
  const companyAdmin = new Client();
  const driver = new Client();
  await companyAdmin.post("/api/auth/login", { email: "admin@fleetflow.test", password: "Admin123!" });
  await driver.post("/api/auth/login", { email: "driver@fleetflow.test", password: "Driver123!" });
  for (const p of PLATFORM_GETS) {
    const [a, c, d] = await Promise.all([anon.get(p), companyAdmin.get(p), driver.get(p)]);
    check(`${p}: anonymous / company admin / driver all → 401`, a.status === 401 && c.status === 401 && d.status === 401, [a.status, c.status, d.status]);
  }
  let r = await companyAdmin.post("/api/platform/organizations", { companyName: "Hijack Co", adminName: "Evil Admin", adminEmail: `evil-${stamp}@x.test`, plan: "business" });
  check("company admin cannot create organizations", r.status === 401, r.status);
  r = await companyAdmin.patch("/api/platform/organizations/does-not-matter", { action: "suspend", reason: "nope" });
  check("company admin cannot suspend organizations", r.status === 401, r.status);
  r = await companyAdmin.post("/api/platform/auth/login", { email: "admin@fleetflow.test", password: "Admin123!" });
  check("company credentials don't work on platform login", r.status === 401, r.status);
  r = await companyAdmin.get("/api/platform/auth/me");
  check("platform 'me' is null for a company session", r.status === 200 && r.data.admin === null, r.data);

  const ops = new Client();
  r = await ops.post("/api/platform/auth/login", { email: superEmail, password: "wrong-password-123" });
  check("wrong platform password → 401", r.status === 401, r.status);
  r = await ops.post("/api/platform/auth/login", { email: superEmail, password: superPassword });
  check("super admin signs in", r.status === 200 && r.data.admin?.email === superEmail, r);
  check("platform login response has no secrets", !HASH_LIKE.test(r.text) && !/passwordHash/.test(r.text));
  r = await ops.get("/api/deliveries");
  check("platform session does not grant company API access", r.status === 401, r.status);

  console.log("\n# Forced password change for generated credentials");
  const tempEmail = `ops2-${stamp}@platform.test`;
  b = bootstrap(["--email", tempEmail, "--name", "Second Ops"]);
  const temp = b.out.match(/\n\s{2}(\S{16})\n/)?.[1];
  check("script prints a generated temporary password once", b.ok && !!temp, b.out);
  const ops2 = new Client();
  await ops2.post("/api/platform/auth/login", { email: tempEmail, password: temp });
  r = await ops2.get("/api/platform/overview");
  check("temporary-password admin is blocked until they change it → 403", r.status === 403, r.status);
  r = await ops2.post("/api/platform/auth/password", { currentPassword: temp, newPassword: `Changed-${stamp}-pw` });
  check("platform password change", r.status === 200, r);
  r = await ops2.get("/api/platform/overview");
  check("after change: access granted", r.status === 200, r.status);

  console.log("\n# Overview & lists (real data)");
  r = await ops.get("/api/platform/overview");
  const ov = r.data;
  check("overview counts the seeded organizations and deliveries", r.status === 200 && ov.organizations.total >= 2 && ov.deliveries.total >= 36 && ov.users.drivers >= 1, ov.organizations);
  check("overview has 12 monthly + 30 daily points", ov.monthly?.length === 12 && ov.daily?.length === 30, [ov.monthly?.length, ov.daily?.length]);
  r = await ops.get("/api/platform/users?search=fleetflow.test");
  check("users list across organizations, no password data", r.status === 200 && r.data.total >= 3 && !HASH_LIKE.test(r.text) && !/passwordHash/.test(r.text), r.data.total);
  r = await ops.get("/api/platform/plans");
  check("plans list with organization counts", r.status === 200 && r.data.plans.length >= 4 && r.data.plans.reduce((s, p) => s + p.organizationCount, 0) >= 2, r.data);

  console.log("\n# Create organization");
  r = await ops.post("/api/platform/organizations", { companyName: `Meghna Foods ${stamp}`, adminName: "Farhan Kabir", adminEmail: `farhan-${stamp}@meghna.test`, plan: "starter" });
  check("create organization with first admin", r.status === 201 && r.data.organizationId && r.data.temporaryPassword, r);
  const orgId = r.data.organizationId;
  const farhanTemp = r.data.temporaryPassword;
  const orgAdmin = new Client();
  r = await orgAdmin.post("/api/auth/login", { email: `farhan-${stamp}@meghna.test`, password: farhanTemp });
  check("new company admin signs in, must change password", r.status === 200 && r.data.user?.mustChangePassword === true, r.data);
  r = await orgAdmin.post("/api/deliveries", { recipientName: "Shop Owner", recipientPhone: "01711000111", pickupAddress: "Meghna depot, Narayanganj", deliveryAddress: "Bazar Road, Narayanganj", priority: "NORMAL" });
  check("new company works (create delivery)", r.status === 201, r);
  const trackingToken = r.data.delivery?.trackingToken;
  r = await ops.get(`/api/platform/organizations?search=${encodeURIComponent("Meghna Foods " + stamp)}`);
  check("organization appears in search with counts", r.data.items?.[0]?.id === orgId && r.data.items[0].counts.deliveries === 1 && r.data.items[0].plan === "starter", r.data.items?.[0]);

  console.log("\n# Suspension isolation");
  r = await ops.patch(`/api/platform/organizations/${orgId}`, { action: "suspend", reason: "" });
  check("suspend requires a reason", r.status === 400, r.status);
  r = await ops.patch(`/api/platform/organizations/${orgId}`, { action: "suspend", reason: "Invoice overdue (e2e)" });
  check("suspend organization", r.status === 200, r);
  r = await orgAdmin.get("/api/deliveries");
  check("suspended company's existing session is cut off → 401", r.status === 401, r.status);
  r = await new Client().post("/api/auth/login", { email: `farhan-${stamp}@meghna.test`, password: farhanTemp });
  check("suspended company cannot sign in with the correct password → 403", r.status === 403 && /suspended/i.test(r.data.error), r);
  r = await companyAdmin.get("/api/deliveries");
  check("other organization unaffected (SwiftDrop admin still works)", r.status === 200 && r.data.total >= 30, r.status);
  r = await driver.get("/api/my/jobs");
  check("other organization's driver unaffected", r.status === 200, r.status);
  r = await anon.get(`/api/track/${trackingToken}`);
  check("customer tracking link still works during suspension", r.status === 200, r.status);
  r = await ops.get(`/api/platform/organizations/${orgId}`);
  check("detail shows suspension with reason; data intact", r.data.organization?.status === "SUSPENDED" && r.data.organization.suspendedReason === "Invoice overdue (e2e)" && r.data.usage?.monthlyDeliveries === 1, r.data.organization);
  r = await ops.patch(`/api/platform/organizations/${orgId}`, { action: "suspend", reason: "again" });
  check("suspending twice is refused", r.status >= 400 && r.status < 500, r.status);
  r = await ops.patch(`/api/platform/organizations/${orgId}`, { action: "reactivate" });
  check("reactivate organization", r.status === 200, r);

  console.log("\n# Plan & subscription");
  r = await ops.patch(`/api/platform/organizations/${orgId}`, { action: "set-plan", plan: "nonexistent", billingCycle: "MONTHLY" });
  check("unknown plan rejected", r.status === 400, r.status);
  r = await ops.patch(`/api/platform/organizations/${orgId}`, { action: "set-plan", plan: "growth", billingCycle: "MONTHLY" });
  check("change plan", r.status === 200, r);
  r = await ops.patch(`/api/platform/organizations/${orgId}`, { action: "update-subscription", subscriptionStatus: "ACTIVE", paidUntil: "2026-11-30", billingNotes: "Paid by bKash, ref TX123" });
  check("record subscription manually", r.status === 200, r);
  r = await ops.get(`/api/platform/organizations/${orgId}`);
  check("detail reflects plan + subscription", r.data.organization?.plan === "growth" && r.data.organization.subscriptionStatus === "ACTIVE" && !!r.data.organization.paidUntil, r.data.organization);

  console.log("\n# User administration");
  const farhan = r.data.users.find((u) => u.email === `farhan-${stamp}@meghna.test`);
  r = await ops.patch(`/api/platform/users/${farhan.id}`, { action: "deactivate" });
  check("cannot deactivate the last active admin of an active company → 409", r.status === 409, r);
  r = await ops.patch(`/api/platform/users/${farhan.id}`, { action: "reset-password" });
  check("reset company admin password → temporary password", r.status === 200 && typeof r.data.temporaryPassword === "string", r);
  const fresh = new Client();
  r = await fresh.post("/api/auth/login", { email: `farhan-${stamp}@meghna.test`, password: r.data.temporaryPassword });
  check("company admin signs in with reset password (must change)", r.status === 200 && r.data.user?.mustChangePassword === true, r.data);
  r = await ops.patch(`/api/platform/users/${farhan.id}`, { action: "revoke-sessions" });
  r = await fresh.get("/api/auth/me");
  check("sign out everywhere revokes company sessions", r.data.user == null, r.data);
  r = await ops.patch(`/api/platform/users/${farhan.id}`, { action: "make-super-admin" });
  check("no role-elevation action exists → 400", r.status === 400, r.status);

  console.log("\n# Audit trail");
  r = await ops.get("/api/platform/audit");
  const actions = new Set(r.data.items?.map((a) => a.action));
  for (const a of ["ORG_CREATED", "ORG_SUSPENDED", "ORG_REACTIVATED", "PLAN_CHANGED", "SUBSCRIPTION_UPDATED", "USER_PASSWORD_RESET", "PLATFORM_LOGIN"]) {
    check(`platform audit records ${a}`, actions.has(a), [...actions]);
  }
  check("audit trail contains no secrets", !HASH_LIKE.test(r.text) && !/temporaryPassword|passwordHash/i.test(r.text));

  console.log("\n# Permanent delete (guarded)");
  const del = (body) => ops.req("DELETE", `/api/platform/organizations/${orgId}`, body);
  const orgName = `Meghna Foods ${stamp}`;
  const swiftBefore = (await companyAdmin.get("/api/deliveries")).data.total;
  r = await companyAdmin.req("DELETE", `/api/platform/organizations/${orgId}`, { confirmName: orgName });
  check("company admin cannot delete organizations", r.status === 401, r.status);
  r = await del({ confirmName: orgName });
  check("active organization can't be deleted → 409", r.status === 409, r);
  r = await ops.patch(`/api/platform/organizations/${orgId}`, { action: "suspend", reason: "Closing account (e2e)" });
  r = await ops.get(`/api/platform/organizations/${orgId}/delete-preview`);
  check("delete preview shows counts", r.status === 200 && r.data.counts && Object.values(r.data.counts).some((n) => n > 0), r.data);
  r = await del({ confirmName: orgName.toUpperCase() });
  check("name must match exactly (case) → 400", r.status === 400, r.status);
  r = await del({ confirmName: `${orgName} ` });
  check("name must match exactly (trailing space) → 400", r.status === 400, r.status);
  r = await del({ confirmName: orgName });
  check("suspended + exact name → permanently deleted", r.status === 200 && r.data.deleted === true, r);
  r = await ops.get(`/api/platform/organizations/${orgId}`);
  check("organization is gone → 404", r.status === 404, r.status);
  r = await new Client().post("/api/auth/login", { email: `farhan-${stamp}@meghna.test`, password: farhanTemp });
  check("its users are gone (login fails)", r.status === 401, r.status);
  r = await anon.get(`/api/track/${trackingToken}`);
  check("its tracking links are gone → 404", r.status === 404, r.status);
  r = await companyAdmin.get("/api/deliveries");
  check("other organizations untouched (SwiftDrop deliveries unchanged)", r.status === 200 && r.data.total === swiftBefore, [swiftBefore, r.data.total]);
  r = await ops.get("/api/platform/audit?action=ORG_DELETED");
  check("ORG_DELETED audit record survives with counts", r.data.items?.some((a) => a.targetId === orgId && /counts|deliveries/i.test(a.detail ?? "")), r.data.items?.slice(0, 1));
  r = await del({ confirmName: orgName });
  check("deleting again → 404", r.status === 404, r.status);

  console.log("\n# Sign out");
  await ops.post("/api/platform/auth/logout");
  r = await ops.get("/api/platform/overview");
  check("after platform logout → 401", r.status === 401, r.status);

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
