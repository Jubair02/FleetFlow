// Core end-to-end API checks: auth & security, filters, the delivery lifecycle,
// concurrency, tenant isolation. Uses the demo seed accounts.
//
// ⚠ MUTATES DATA. Run ONLY against a server backed by a disposable database
// that contains the demo seed, never production:
//
//   E2E_BASE_URL=http://localhost:3001 node tests/e2e/core.e2e.mjs
import { deflateSync } from "zlib";

const BASE = process.env.E2E_BASE_URL;
if (!BASE) {
  console.error("Set E2E_BASE_URL to a server backed by a disposable database. Aborting.");
  process.exit(2);
}
const ORIGIN = BASE;
let pass = 0, failN = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { failN++; failures.push(name); console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ""); }
}

class Client {
  constructor() { this.cookie = ""; }
  async req(method, path, body, headers = {}) {
    const h = { Origin: ORIGIN, ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    let payload = body;
    if (body !== undefined && !(body instanceof FormData) && typeof body !== "string") {
      h["Content-Type"] = "application/json"; payload = JSON.stringify(body);
    }
    const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: "manual" });
    const sc = res.headers.get("set-cookie");
    if (sc && sc.includes("ff_session=")) this.cookie = sc.split(";")[0];
    let data = null; const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  get(p) { return this.req("GET", p); }
  post(p, b) { return this.req("POST", p, b ?? {}); }
  patch(p, b) { return this.req("PATCH", p, b); }
  del(p) { return this.req("DELETE", p); }
  async login(email, password) { return this.post("/api/auth/login", { email, password }); }
}

function png() {
  const w = 4, h = 4;
  const raw = Buffer.alloc((w * 4 + 1) * h, 255);
  for (let y = 0; y < h; y++) raw[y * (w * 4 + 1)] = 0;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function podForm(recipientName, complete, kind = "SIGNATURE") {
  const f = new FormData();
  f.set("file", new Blob([png()], { type: "image/png" }), "sig.png");
  f.set("recipientName", recipientName); f.set("kind", kind); f.set("complete", String(complete));
  return f;
}
const newDelivery = (extra = {}) => ({
  recipientName: "E2E Tester", recipientPhone: "+880 1700 000000",
  pickupAddress: "Warehouse 1, Dhaka 1000", deliveryAddress: "House 1, Road 2, Dhaka 1212",
  priority: "URGENT", ...extra,
});

async function main() {
  const admin = new Client(), driver = new Client(), anon = new Client(), admin2 = new Client();

  console.log("\n# Auth & security");
  let r = await anon.post("/api/auth/login", "not json");
  check("login with non-JSON content-type → 415", r.status === 415, r);
  r = await anon.req("POST", "/api/auth/login", { email: "admin@fleetflow.test", password: "Admin123!" }, { Origin: "https://evil.example" });
  check("cross-site POST rejected by proxy → 403", r.status === 403, r);
  r = await admin.login("admin@fleetflow.test", "Admin123!");
  check("admin login → 200", r.status === 200, r);
  check("session cookie httpOnly + SameSite=Lax", /HttpOnly/i.test(r.headers.get("set-cookie") || "") && /SameSite=lax/i.test(r.headers.get("set-cookie") || ""));
  r = await anon.get("/");
  check("security headers present (X-Frame-Options, nosniff)", r.headers.get("x-frame-options") === "DENY" && r.headers.get("x-content-type-options") === "nosniff");
  const bad = new Client();
  for (let i = 0; i < 5; i++) await bad.login("ratelimit-probe@fleetflow.test", "wrong");
  r = await bad.login("ratelimit-probe@fleetflow.test", "wrong");
  check("6th failed login for one account → 429", r.status === 429, r);
  r = await driver.login("driver@fleetflow.test", "Driver123!");
  check("driver login still works (per-IP limit not tripped) → 200", r.status === 200, r);
  await admin2.login("admin2@fleetflow.test", "Admin123!");
  r = await driver.get("/api/dashboard");
  check("driver blocked from admin API → 403", r.status === 403, r.status);
  r = await anon.get("/api/deliveries");
  check("anonymous blocked → 401", r.status === 401);

  console.log("\n# Query validation & filters");
  r = await admin.get("/api/deliveries?from=garbage");
  check("invalid date filter → 400", r.status === 400, r);
  r = await admin.get("/api/reports?from=nope");
  check("invalid report date → 400", r.status === 400, r);
  const dispatch = (await admin.get("/api/dispatch")).data;
  const rank = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
  const prios = dispatch.unassigned.map((d) => rank[d.priority]);
  check("dispatch queue ordered URGENT>HIGH>NORMAL>LOW", prios.every((p, i) => i === 0 || prios[i - 1] <= p), dispatch.unassigned.map((d) => d.priority));
  check("dispatch vehicles expose currentDriverId", dispatch.vehicles.every((v) => "currentDriverId" in v), dispatch.vehicles[0]);
  const drivers = (await admin.get("/api/drivers")).data.items;
  const alex = drivers.find((d) => d.email === "driver@fleetflow.test");
  const otherDriver = drivers.find((d) => d.id !== alex.id && d.active && d.availability !== "OFF_DUTY" && d.activeJobs < d.maxActiveJobs);
  const vehicles = (await admin.get("/api/vehicles")).data.items;
  check("vehicles expose assignmentCount", vehicles.every((v) => typeof v.assignmentCount === "number"));
  const byDriver = (await admin.get(`/api/deliveries?driverId=${alex.id}&pageSize=50`)).data.total;
  const v0 = vehicles[0].id;
  const byVehicle = (await admin.get(`/api/deliveries?vehicleId=${v0}&pageSize=50`)).data.total;
  const both = (await admin.get(`/api/deliveries?driverId=${alex.id}&vehicleId=${v0}&pageSize=50`)).data.total;
  const ghost = (await admin.get(`/api/deliveries?driverId=nonexistent&vehicleId=${v0}&pageSize=50`)).data.total;
  check("driver+vehicle filters combine (AND)", both <= Math.min(byDriver, byVehicle) && ghost === 0, { byDriver, byVehicle, both, ghost });
  r = await admin.get("/api/deliveries?search=GULSHAN");
  check("search is case-insensitive", r.status === 200 && r.data.total > 0, r.data.total);
  const tz = new Date().getTimezoneOffset();
  const dash = (await admin.get(`/api/dashboard?tz=${tz}`)).data;
  const todayKey = new Date(Date.now() - tz * 60000).toISOString().slice(0, 10);
  check("dashboard last bucket is today's local date", dash.daily.at(-1)?.date === todayKey, { last: dash.daily.at(-1), todayKey });
  check("dashboard attention has true counts", typeof dash.attention.failedCount === "number" && typeof dash.attention.pendingUrgentCount === "number");
  const rep = (await admin.get(`/api/reports?tz=${tz}`)).data;
  check("reports return itemsTotal == summary.total", rep.itemsTotal === rep.summary.total, { itemsTotal: rep.itemsTotal, total: rep.summary.total });
  const exp = (await admin.get(`/api/reports?tz=${tz}&export=1`)).data;
  check("reports export=1 returns all items", exp.items.length === exp.itemsTotal, { len: exp.items.length, total: exp.itemsTotal });

  console.log("\n# Delivery lifecycle");
  r = await admin.post("/api/deliveries", newDelivery());
  check("create delivery → 201", r.status === 201, r);
  const d1 = r.data.delivery;
  r = await admin.patch(`/api/deliveries/${d1.id}`, { recipientPhone: "+880 1700 111111" });
  r = await admin.get(`/api/deliveries/${d1.id}`);
  check("PATCH without priority keeps URGENT", r.data.delivery.priority === "URGENT" && r.data.delivery.recipientPhone === "+880 1700 111111", r.data.delivery?.priority);
  r = await admin.post(`/api/deliveries/${d1.id}/status`, { status: "IN_TRANSIT", note: "test override" });
  check("override CREATED→IN_TRANSIT without driver rejected", r.status >= 400 && r.status < 500, r);

  const freshDispatch = (await admin.get("/api/dispatch")).data;
  const takenVehicle = freshDispatch.vehicles.find((v) => v.currentDriverId && v.currentDriverId !== otherDriver.id && v.status === "ACTIVE");
  if (takenVehicle) {
    r = await admin.post(`/api/deliveries/${d1.id}/assign`, { driverId: otherDriver.id, vehicleId: takenVehicle.id });
    check("assign vehicle held by another driver → 409", r.status === 409, r);
  }
  const alexVehicle = freshDispatch.vehicles.find((v) => v.currentDriverId === alex.id) ||
    freshDispatch.vehicles.find((v) => !v.currentDriverId && v.status === "ACTIVE");
  const alexBefore = (await admin.get("/api/dispatch")).data.drivers.find((d) => d.id === alex.id);
  if (alexBefore.activeJobs >= alexBefore.maxActiveJobs) {
    await admin.patch(`/api/drivers/${alex.id}`, { maxActiveJobs: alexBefore.activeJobs + 3 });
  }
  // concurrent double-assign of the same delivery
  const [a1, a2] = await Promise.all([
    admin.post(`/api/deliveries/${d1.id}/assign`, { driverId: alex.id, vehicleId: alexVehicle.id }),
    admin.post(`/api/deliveries/${d1.id}/assign`, { driverId: alex.id, vehicleId: alexVehicle.id }),
  ]);
  check("concurrent double-assign: exactly one succeeds", [a1.status, a2.status].filter((s) => s === 200).length === 1, [a1.status, a2.status, a1.data, a2.data]);
  r = await admin.get(`/api/deliveries/${d1.id}`);
  check("only one active assignment exists", r.data.assignments.filter((a) => a.active).length === 1, r.data.assignments);

  // driver flow with concurrent double pickup
  const [p1, p2] = await Promise.all([
    driver.post(`/api/deliveries/${d1.id}/status`, { status: "PICKED_UP" }),
    driver.post(`/api/deliveries/${d1.id}/status`, { status: "PICKED_UP" }),
  ]);
  check("concurrent double pickup: exactly one succeeds", [p1.status, p2.status].filter((s) => s === 200).length === 1, [p1.status, p2.status]);
  r = await admin.get(`/api/deliveries/${d1.id}`);
  check("only one PICKED_UP event recorded", r.data.events.filter((e) => e.eventType === "PICKED_UP").length === 1);
  r = await driver.post(`/api/deliveries/${d1.id}/status`, { status: "IN_TRANSIT" });
  check("driver → IN_TRANSIT", r.status === 200, r);
  r = await driver.req("POST", `/api/deliveries/${d1.id}/pod`, podForm("E2E Recipient", true));
  check("POD upload completes delivery → 201", r.status === 201 && r.data.completed === true, r);
  r = await admin.get(`/api/deliveries/${d1.id}`);
  const a = r.data.assignments.find((x) => x.driverId === alex.id);
  check("delivered: status DELIVERED, assignment outcome DELIVERED, inactive", r.data.delivery.status === "DELIVERED" && a.outcome === "DELIVERED" && !a.active, { s: r.data.delivery.status, a });
  r = await admin.patch(`/api/deliveries/${d1.id}`, { recipientName: "Changed" });
  check("editing a DELIVERED delivery refused → 409", r.status === 409, r);
  r = await admin.post(`/api/deliveries/${d1.id}/status`, { status: "IN_TRANSIT", note: "x" });
  check("override DELIVERED→IN_TRANSIT refused", r.status >= 400 && r.status < 500, r);

  // failure keeps the driver's note
  r = await admin.post("/api/deliveries", newDelivery({ priority: "LOW" }));
  const d2 = r.data.delivery;
  await admin.post(`/api/deliveries/${d2.id}/assign`, { driverId: alex.id, vehicleId: alexVehicle.id });
  r = await driver.post(`/api/deliveries/${d2.id}/status`, { status: "FAILED", failureReason: "OTHER", note: "gate locked, guard absent" });
  check("driver marks FAILED", r.status === 200, r);
  r = await admin.get(`/api/deliveries/${d2.id}`);
  const failEv = r.data.events.find((e) => e.eventType === "FAILED");
  check("FAILED event keeps driver note", failEv?.note?.includes("gate locked"), failEv);
  check("failed assignment outcome FAILED", r.data.assignments[0]?.outcome === "FAILED", r.data.assignments);
  r = await driver.get(`/api/deliveries/${d2.id}`);
  check("driver can still read own failed job (not reassigned)", r.status === 200, r.status);
  // reassign to someone else → original driver loses access
  const otherVehicle = (await admin.get("/api/dispatch")).data.vehicles.find((v) => v.status === "ACTIVE" && (!v.currentDriverId || v.currentDriverId === otherDriver.id));
  r = await admin.post(`/api/deliveries/${d2.id}/assign`, { driverId: otherDriver.id, vehicleId: otherVehicle.id });
  check("reassign failed delivery to another driver", r.status === 200, r);
  r = await driver.get(`/api/deliveries/${d2.id}`);
  check("previous driver loses access after reassignment → 403", r.status === 403, r.status);
  const hist = (await driver.get("/api/my/jobs?scope=history")).data.items;
  const h2 = hist.filter((j) => j.id === d2.id);
  check("driver history shows own FAILED outcome once", h2.length === 1 && h2[0].outcome === "FAILED", h2);
  const ids = hist.map((j) => j.id);
  check("driver history has no duplicate deliveries", new Set(ids).size === ids.length);

  // cancel with an active assignment closes it
  r = await admin.post(`/api/deliveries/${d2.id}/status`, { status: "CANCELLED", note: "customer cancelled" });
  check("admin cancels an assigned delivery", r.status === 200, r);
  r = await admin.get(`/api/deliveries/${d2.id}`);
  check("cancel closed the active assignment (outcome CANCELLED)", r.data.assignments.every((x) => !x.active) && r.data.assignments.some((x) => x.outcome === "CANCELLED"), r.data.assignments);
  r = await admin.get(`/api/deliveries/${d2.id}`);
  const dd = (await admin.get("/api/dispatch")).data.drivers.find((d) => d.id === otherDriver.id);
  check("other driver's availability consistent with jobs", (dd.activeJobs > 0) === (dd.availability === "ON_ROUTE") || dd.availability === "OFF_DUTY", dd);

  // POD upload checks
  r = await admin.post("/api/deliveries", newDelivery());
  const d3 = r.data.delivery;
  r = await driver.req("POST", `/api/deliveries/${d3.id}/pod`, podForm("X Y", false));
  check("POD on a delivery not assigned to driver → 403/404", r.status === 403 || r.status === 404 || r.status === 400, r);
  const big = new FormData();
  big.set("file", new Blob([Buffer.alloc(10 * 1024 * 1024, 1)]), "big.png"); big.set("recipientName", "X Y"); big.set("complete", "false");
  r = await driver.req("POST", `/api/deliveries/${d3.id}/pod`, big);
  check("oversized POD upload → 413", r.status === 413, r.status);

  // delete rules
  r = await admin.del(`/api/deliveries/${d3.id}`);
  check("delete never-assigned delivery → 200", r.status === 200, r);
  r = await admin.del(`/api/deliveries/${d2.id}`);
  check("delete assigned-history delivery refused", r.status >= 400 && r.status < 500, r);

  // tenant isolation
  r = await admin2.get(`/api/deliveries/${d1.id}`);
  check("other org cannot read delivery → 404", r.status === 404, r.status);

  // driver/vehicle safety
  const busy = (await admin.get("/api/dispatch")).data.drivers.find((d) => d.activeJobs > 0);
  if (busy) {
    r = await admin.patch(`/api/drivers/${busy.id}`, { active: false });
    check("deactivating a driver with active jobs refused", r.status === 409 || r.status === 400, r);
    r = await admin.patch(`/api/drivers/${busy.id}`, { availability: "AVAILABLE" });
    const after = (await admin.get("/api/dispatch")).data.drivers.find((d) => d.id === busy.id);
    check("setting AVAILABLE with active jobs resolves to ON_ROUTE", after.availability === "ON_ROUTE", after);
  }
  const busyVehicle = (await admin.get("/api/dispatch")).data.vehicles.find((v) => v.activeJobs > 0);
  if (busyVehicle) {
    r = await admin.patch(`/api/vehicles/${busyVehicle.id}`, { status: "MAINTENANCE" });
    check("vehicle with active jobs can't go to maintenance", r.status === 409 || r.status === 400, r);
  }
  r = await admin.post("/api/vehicles", { registrationNumber: vehicles[0].registrationNumber.toLowerCase(), type: "VAN" });
  check("duplicate registration (different case) → 409", r.status === 409, r);

  // notifications & audit
  r = await admin.get("/api/notifications?channel=EMAIL");
  check("email outbox includes driver emails", r.status === 200 && r.data.items.some((n) => n.title?.includes("New assignment") || n.type === "NEW_ASSIGNMENT"), r.data.items?.slice(0, 2));
  r = await admin.post(`/api/deliveries/${d1.id}/note`, { note: "e2e note", customerVisible: false });
  const audit = (await admin.get("/api/audit?action=NOTE")).data;
  check("adding a note writes an audit row", audit.items?.some((x) => x.action === "NOTE_ADDED"), audit.items?.slice(0, 1));
  r = await admin.post("/api/notifications/read", { ids: [123] });
  check("notifications/read with bad ids → 400", r.status === 400, r);

  // tracking privacy
  const tok = (await admin.get(`/api/deliveries/${d1.id}`)).data.delivery.trackingToken;
  r = await anon.get(`/api/track/${tok}`);
  check("public tracking hides internal note", r.status === 200 && !JSON.stringify(r.data).includes("e2e note"), r.data);

  // logout invalidates the session
  const oldCookie = driver.cookie;
  await driver.post("/api/auth/logout");
  driver.cookie = oldCookie; // replay the pre-logout cookie
  r = await driver.get("/api/my/jobs");
  check("after logout the old cookie is rejected → 401", r.status === 401, r.status);

  console.log(`\n${pass} passed, ${failN} failed`);
  if (failN) console.log("Failures:\n - " + failures.join("\n - "));
}

main().catch((e) => { console.error(e); process.exit(1); });
