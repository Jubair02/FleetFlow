// End-to-end checks for the shared sign-in & server-side workspace routing:
// one login endpoint for staff, company admins and drivers; redirects decided
// by the server-verified account; no escalation via sign-up or the client.
//
// ⚠ MUTATES DATA (creates a platform admin and a company). Run ONLY against a
// server backed by a disposable database containing the demo seed:
//
//   E2E_BASE_URL=http://localhost:3001 E2E_DATABASE_URL="<disposable db url>" \
//     node tests/e2e/auth.e2e.mjs
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
  get cookie() { return Object.entries(this.cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(method, path, body) {
    const h = { Origin: BASE };
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h["Content-Type"] = "application/json";
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      this.cookies[pair.slice(0, i)] = pair.slice(i + 1);
    }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, text, location: res.headers.get("location") };
  }
  get(p) { return this.req("GET", p); }
  post(p, b) { return this.req("POST", p, b ?? {}); }
  login(email, password) { return this.post("/api/auth/login", { email, password }); }
}

const isRedirect = (r) => r.status >= 300 && r.status < 400;
const pathOf = (loc) => (loc ? new URL(loc, BASE).pathname + new URL(loc, BASE).search : null);
const HASH_LIKE = /[0-9a-f]{32}:[0-9a-f]{128}/;
const stamp = Date.now().toString(36);
const staffEmail = `staff-${stamp}@platform.test`;
const staffPassword = `Staff-${stamp}-pass!`;

async function main() {
  execFileSync(process.execPath, ["scripts/create-super-admin.mjs", "--email", staffEmail, "--name", "Staff Member"], {
    env: { ...process.env, DATABASE_URL: DB_URL, SUPER_ADMIN_PASSWORD: staffPassword }, encoding: "utf8",
  });

  console.log("\n# One sign-in endpoint, server-decided workspace");
  const staff = new Client();
  let r = await staff.login(staffEmail, staffPassword);
  check("super admin via the shared login → platform", r.status === 200 && r.data.kind === "platform" && r.data.redirectTo === "/platform", r.data);
  check("staff login sets only the platform session", !!staff.cookies.ff_platform_session && !staff.cookies.ff_session, Object.keys(staff.cookies));
  check("login response has no secrets", !HASH_LIKE.test(r.text) && !/passwordHash/.test(r.text));
  const admin = new Client();
  r = await admin.login("admin@fleetflow.test", "Admin123!");
  check("company admin via the shared login → company workspace", r.status === 200 && r.data.kind === "tenant" && r.data.redirectTo === "/" && r.data.user?.role === "ADMIN", r.data);
  check("company login sets only the company session", !!admin.cookies.ff_session && !admin.cookies.ff_platform_session, Object.keys(admin.cookies));
  const driver = new Client();
  r = await driver.login("driver@fleetflow.test", "Driver123!");
  check("driver via the shared login → company workspace (driver role)", r.status === 200 && r.data.kind === "tenant" && r.data.user?.role === "DRIVER", r.data);
  const bad1 = await new Client().login(staffEmail, "wrong-password-1");
  const bad2 = await new Client().login(`nobody-${stamp}@x.test`, "wrong-password-1");
  check("bad password / unknown email → same generic 401", bad1.status === 401 && bad2.status === 401 && bad1.data.error === bad2.data.error, [bad1.data, bad2.data]);

  console.log("\n# Server-side page routing");
  const anon = new Client();
  r = await anon.get("/platform");
  check("anonymous /platform → redirected to sign-in", isRedirect(r) && pathOf(r.location) === "/?next=platform", [r.status, r.location]);
  r = await admin.get("/platform");
  check("company admin /platform → redirected to their workspace", isRedirect(r) && pathOf(r.location) === "/", [r.status, r.location]);
  r = await driver.get("/platform");
  check("driver /platform → redirected to their workspace", isRedirect(r) && pathOf(r.location) === "/", [r.status, r.location]);
  r = await staff.get("/platform");
  check("staff /platform → console renders", r.status === 200, r.status);
  r = await staff.get("/");
  check("staff on / → redirected to /platform", isRedirect(r) && pathOf(r.location) === "/platform", [r.status, r.location]);
  r = await staff.get("/?track=some-token");
  check("tracking links are never redirected", r.status === 200, r.status);
  r = await admin.get("/");
  check("company admin on / → company app", r.status === 200, r.status);
  r = await anon.get("/?next=https://evil.example");
  check("no open redirect via ?next", r.status === 200, [r.status, r.location]);

  console.log("\n# Authorization stays server-side");
  r = await admin.get("/api/platform/overview");
  check("company session can't use platform APIs", r.status === 401, r.status);
  r = await staff.get("/api/deliveries");
  check("staff session can't use company APIs", r.status === 401, r.status);
  r = await driver.get("/api/dashboard");
  check("driver still blocked from admin APIs", r.status === 403, r.status);

  console.log("\n# No escalation through sign-up");
  const squatter = new Client();
  r = await squatter.post("/api/auth/signup", { companyName: `Squat Co ${stamp}`, name: "Squatter", email: staffEmail, password: "Squatter-pass-123" });
  check("sign-up with a staff email only ever creates a company account", r.status === 201 && r.data.user?.role === "ADMIN", r.data);
  r = await squatter.get("/api/platform/overview");
  check("…which has no platform access", r.status === 401, r.status);
  r = await new Client().login(staffEmail, "Squatter-pass-123");
  check("company password for that email → company workspace, not platform", r.data.kind === "tenant", r.data);
  const staff2 = new Client();
  r = await staff2.login(staffEmail, staffPassword);
  check("staff password for that email → platform", r.data.kind === "platform", r.data);
  r = await new Client().post("/api/auth/signup", { companyName: `Role Probe ${stamp}`, name: "Yasmin", email: `z-${stamp}@x.test`, password: "Zzzzzzzz-1", role: "SUPER_ADMIN", isPlatformAdmin: true });
  check("extra role fields in sign-up are ignored (still a company admin)", r.status === 201 && r.data.user?.role === "ADMIN", r.data);

  console.log("\n# Legacy platform login & sign-out");
  r = await new Client().post("/api/platform/auth/login", { email: "admin@fleetflow.test", password: "Admin123!" });
  check("legacy platform endpoint refuses company credentials", r.status === 401, r.status);
  r = await new Client().post("/api/platform/auth/login", { email: staffEmail, password: staffPassword });
  check("legacy platform endpoint still signs staff in", r.status === 200 && r.data.admin?.email === staffEmail, r.data);
  await staff.post("/api/platform/auth/logout");
  r = await staff.get("/platform");
  check("after staff sign-out /platform redirects to sign-in", isRedirect(r) && pathOf(r.location) === "/?next=platform", [r.status, r.location]);

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
