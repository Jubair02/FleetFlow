/**
 * FleetFlow seed — realistic demo data for two organizations.
 * Run (DESTRUCTIVE — wipes the database): ALLOW_DESTRUCTIVE_SEED=1 npx tsx prisma/seed.ts
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";
import { deflateSync } from "zlib";
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { failureReasonLabel } from "../src/lib/constants";

const db = new PrismaClient();

// ── helpers ──────────────────────────────────────────────────

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
/** Date N days ago at a given hour (local time). */
function daysAgo(n: number, hour = 9, minute = 0): Date {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(hour, minute, 0, 0);
  return d;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randCode(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}
function trackingCode(d: Date): string {
  const date = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `FF-${date}-${randCode(4)}`;
}
const trackingToken = () => randomBytes(24).toString("hex");

// ── pure-Node signature PNG generator (no image deps) ────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
/** Deterministic squiggle "signature" as a PNG buffer. */
function generateSignaturePng(seed: number, width = 640, height = 240): Buffer {
  let s = (seed * 2654435761) % 4294967296;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const px = Buffer.alloc(width * height * 4, 255); // white bg
  const ink = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (Math.floor(y) * width + Math.floor(x)) * 4;
    px[i] = 30; px[i + 1] = 41; px[i + 2] = 59;
  };
  const dot = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) ink(x + dx, y + dy);
  };
  const strokes = 2 + Math.floor(rand() * 2);
  for (let st = 0; st < strokes; st++) {
    const yBase = height * (0.32 + 0.24 * rand());
    const amp = 16 + rand() * 26;
    const freq = (Math.PI * 2) / (width * (0.5 + rand() * 0.5));
    const phase = rand() * Math.PI * 2;
    const x0 = width * (0.1 + rand() * 0.16);
    const x1 = width * (0.62 + rand() * 0.28);
    for (let x = x0; x <= x1; x += 0.5) {
      const t = (x - x0) / (x1 - x0);
      const y = yBase + amp * Math.sin(freq * (x - x0) + phase) * (1 - 0.3 * t) + 3 * Math.sin(x * 0.15 + st);
      dot(x, y, Math.max(1, 2.4 - 1.2 * t));
    }
  }
  const uy = height * 0.78;
  for (let x = width * 0.2; x <= width * 0.72; x += 0.5) {
    const t = (x - width * 0.2) / (width * 0.52);
    dot(x, uy + 5 * Math.sin(Math.PI * t), 1.2);
  }
  const raw = Buffer.alloc(height * (width * 4 + 1));
  const stride = width * 4 + 1;
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    px.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── data specs ───────────────────────────────────────────────

const HUBS = [
  "SwiftDrop Hub, Tejgaon Industrial Area, Dhaka 1208",
  "SwiftDrop Warehouse, Kamalapur, Dhaka 1217",
];

const RECIPIENTS: [string, string, string][] = [
  ["Ayesha Rahman", "+880 171-245-8890", "House 42, Road 11, Gulshan-2, Dhaka 1212"],
  ["Rafiq Islam", "+880 181-376-2210", "Dhanmondi 27, Flat 5B, Dhaka 1209"],
  ["Nusrat Jahan", "+880 191-542-7734", "House 8, Banani DOHS, Dhaka 1206"],
  ["Imran Hossain", "+880 161-908-1123", "Mirpur DOHS, Avenue 4, Dhaka 1216"],
  ["Farhana Akter", "+880 175-234-9967", "Sector 7, Road 9, Uttara, Dhaka 1230"],
  ["Kamal Uddin", "+880 188-651-3324", "Block C, Mohammadpur, Dhaka 1207"],
  ["Tanjina Islam", "+880 199-720-4415", "Bashundhara R/A, Block J, Dhaka 1229"],
  ["Shahriar Kabir", "+880 174-090-7788", "28 Motijheel C/A, Dhaka 1000"],
  ["Rumana Haque", "+880 167-335-2091", "24/1 Old Dhaka, Farashganj, Dhaka 1100"],
  ["Arif Chowdhury", "+880 186-402-6675", "Khilgaon, Chowdhury Para, Dhaka 1219"],
  ["Samira Nasreen", "+880 192-511-0842", "Lalmatia, Block E, Dhaka 1207"],
  ["Hasibul Karim", "+880 173-684-9012", "Badda, Progati Sarani, Dhaka 1212"],
  ["Meherun Nesa", "+880 185-127-6650", "Shyamoli, Ring Road, Dhaka 1207"],
  ["Tanvir Alam", "+880 178-953-3341", "Uttar Khan, Sector 4, Dhaka 1230"],
  ["Sharmin Sultana", "+880 163-780-2214", "Jigatola, Dhanmondi, Dhaka 1209"],
  ["Fahim Reza", "+880 197-416-5583", "Mohakhali DOHS, Road 7, Dhaka 1206"],
  ["Nabila Chowdhury", "+880 176-298-7740", "Rampura, Banasree, Dhaka 1219"],
  ["Zahid Hasan", "+880 189-633-1198", "Mirpur-10, Block D, Dhaka 1216"],
  ["Ishrat Jahan", "+880 164-857-3326", "Shantinagar, Dhaka 1217"],
  ["Rakib Mahmud", "+880 179-504-8871", "Khilkhet, Nikunja-2, Dhaka 1229"],
  ["Sadia Afrin", "+880 182-749-1105", "Wari, Alexander Rd, Dhaka 1204"],
  ["Mizanur Rahman", "+880 166-390-4472", "Demra, Shonir Akhra, Dhaka 1205"],
  ["Anika Tabassum", "+880 193-628-9917", "Mohammadpur, Adabor, Dhaka 1207"],
  ["Rownak Jilani", "+880 171-835-2260", "Motijheel, Bijoy Nagar, Dhaka 1000"],
];

const INSTRUCTIONS = [
  "Call on arrival. Leave with security if not home.",
  "Fragile — handle with care. Do not tilt.",
  "Deliver to reception, 3rd floor.",
  "Recipient available after 2 PM.",
  "Ring doorbell twice. Cash payment already collected.",
  "Keep refrigerated until handover.",
  "",
  "Gate code 4471. Park outside the compound.",
];

type DeliveredSpec = { day: number; late?: boolean; driverIdx: number; vehicleIdx: number; failed?: string };
const DELIVERED_SPECS: DeliveredSpec[] = [
  { day: 13, driverIdx: 0, vehicleIdx: 0 },
  { day: 12, driverIdx: 1, vehicleIdx: 1 },
  { day: 12, driverIdx: 2, vehicleIdx: 2 },
  { day: 11, driverIdx: 0, vehicleIdx: 5, late: true },
  { day: 10, driverIdx: 1, vehicleIdx: 1 },
  { day: 9, driverIdx: 3, vehicleIdx: 0 },
  { day: 9, driverIdx: 0, vehicleIdx: 2, late: true },
  { day: 8, driverIdx: 2, vehicleIdx: 4 },
  { day: 7, driverIdx: 1, vehicleIdx: 1 },
  { day: 6, driverIdx: 0, vehicleIdx: 0, late: true },
  { day: 5, driverIdx: 2, vehicleIdx: 2 },
  { day: 4, driverIdx: 3, vehicleIdx: 5 },
  { day: 3, driverIdx: 1, vehicleIdx: 1, late: true },
  { day: 2, driverIdx: 0, vehicleIdx: 0 },
  { day: 1, driverIdx: 2, vehicleIdx: 2 },
  { day: 1, driverIdx: 1, vehicleIdx: 4 },
];

const FAILED_SPECS: { day: number; hour: number; reason: string; driverIdx: number; vehicleIdx: number; stage: "pickup" | "dropoff" }[] = [
  { day: 0, hour: 11, reason: "RECIPIENT_UNAVAILABLE", driverIdx: 0, vehicleIdx: 0, stage: "dropoff" },
  { day: 1, hour: 14, reason: "WRONG_ADDRESS", driverIdx: 1, vehicleIdx: 1, stage: "dropoff" },
  { day: 2, hour: 10, reason: "VEHICLE_ISSUE", driverIdx: 3, vehicleIdx: 3, stage: "pickup" },
];

const STORAGE = path.join(process.cwd(), "storage", "pod");

async function main() {
  // The seed WIPES every table and all POD files. Never let it run by accident
  // against a shared/production database.
  if (process.env.ALLOW_DESTRUCTIVE_SEED !== "1") {
    throw new Error(
      "Refusing to seed: this deletes ALL data in DATABASE_URL and storage/pod. " +
        "Re-run with ALLOW_DESTRUCTIVE_SEED=1 only against a disposable database."
    );
  }
  console.log("Seeding FleetFlow…");

  // wipe (respect FK order)
  await db.session.deleteMany();
  await db.notification.deleteMany();
  await db.proofOfDelivery.deleteMany();
  await db.deliveryEvent.deleteMany();
  await db.assignment.deleteMany();
  await db.delivery.deleteMany();
  await db.vehicle.deleteMany();
  await db.driverProfile.deleteMany();
  await db.user.deleteMany();
  await db.auditLog.deleteMany();
  await db.organization.deleteMany();
  await rm(STORAGE, { recursive: true, force: true });
  await mkdir(STORAGE, { recursive: true });

  // ── organizations ─────────────────────────────────────────
  const swift = await db.organization.create({ data: { name: "SwiftDrop Logistics", plan: "growth" } });
  const north = await db.organization.create({ data: { name: "NorthPort Cargo", plan: "trial" } });

  // ── users ─────────────────────────────────────────────────
  const mkUser = (orgId: string, name: string, email: string, password: string, role: string) =>
    db.user.create({ data: { organizationId: orgId, name, email, passwordHash: hashPassword(password), role } });

  const morgan = await mkUser(swift.id, "Morgan Reed", "admin@fleetflow.test", "Admin123!", "ADMIN");
  const jordan = await mkUser(swift.id, "Jordan Blake", "dispatch@fleetflow.test", "Admin123!", "ADMIN");
  const alex = await mkUser(swift.id, "Alex Carter", "driver@fleetflow.test", "Driver123!", "DRIVER");
  const priya = await mkUser(swift.id, "Priya Sharma", "priya@fleetflow.test", "Driver123!", "DRIVER");
  const diego = await mkUser(swift.id, "Diego Morales", "diego@fleetflow.test", "Driver123!", "DRIVER");
  const sara = await mkUser(swift.id, "Sara Kim", "sara@fleetflow.test", "Driver123!", "DRIVER");
  const nina = await mkUser(north.id, "Nina Patel", "admin2@fleetflow.test", "Admin123!", "ADMIN");
  const tom = await mkUser(north.id, "Tom Herrera", "tom@northport.test", "Driver123!", "DRIVER");

  const drivers = [alex, priya, diego, sara];
  // base availability — ON_ROUTE is derived from active jobs at the end of the seed
  const availability = ["AVAILABLE", "AVAILABLE", "AVAILABLE", "OFF_DUTY"];
  const maxJobs = [4, 3, 3, 3];
  for (let i = 0; i < drivers.length; i++) {
    await db.driverProfile.create({
      data: {
        userId: drivers[i].id,
        phone: ["+880 170-111-2233", "+880 170-222-3344", "+880 170-333-4455", "+880 170-444-5566"][i],
        licenseNumber: ["DHK-2019-45871", "CTG-2018-31204", "DHK-2021-77410", "SYL-2020-22198"][i],
        availability: availability[i],
        maxActiveJobs: maxJobs[i],
      },
    });
  }
  await db.driverProfile.create({
    data: { userId: tom.id, phone: "+880 171-555-8899", licenseNumber: "RAJ-2017-10322", availability: "AVAILABLE", maxActiveJobs: 3 },
  });

  // ── vehicles ──────────────────────────────────────────────
  const V = (orgId: string, reg: string, type: string, capacity: string, status: string, notes?: string) =>
    db.vehicle.create({ data: { organizationId: orgId, registrationNumber: reg, type, capacity, status, notes } });
  const swVehicles = [
    await V(swift.id, "DHK-1145", "VAN", "1.2 t / 8 m³", "ACTIVE"),
    await V(swift.id, "DHK-2087", "BOX_TRUCK", "3.5 t / 22 m³", "ACTIVE"),
    await V(swift.id, "DHK-3390", "REFRIGERATED", "2.0 t / 14 m³", "ACTIVE"),
    await V(swift.id, "DHK-4521", "VAN", "1.2 t / 8 m³", "MAINTENANCE", "Brake service at Tejgaon garage — expected back next week."),
    await V(swift.id, "MTR-7702", "MOTORCYCLE", "15 kg", "ACTIVE"),
    await V(swift.id, "DHK-6038", "CAR", "0.4 t / 3 m³", "ACTIVE"),
  ];
  await V(north.id, "CTG-9911", "BOX_TRUCK", "3.5 t / 22 m³", "ACTIVE");
  await V(north.id, "CTG-9912", "VAN", "1.2 t / 8 m³", "MAINTENANCE", "AC repair");

  // ── audit helper ──────────────────────────────────────────
  let auditSeq = 0;
  const audit = (actorId: string, actorName: string, action: string, entityType: string, entityId: string, detail: object, at: Date) =>
    db.auditLog.create({
      data: { organizationId: swift.id, actorId, actorName, action, entityType, entityId, detail: JSON.stringify(detail), createdAt: at },
    });

  // ── deliveries (SwiftDrop) ────────────────────────────────
  let recIdx = 0;
  let sigSeed = 1000;
  const nextRecipient = () => RECIPIENTS[recIdx++ % RECIPIENTS.length];
  const nextInstruction = () => INSTRUCTIONS[recIdx % INSTRUCTIONS.length];
  const hub = () => HUBS[recIdx % HUBS.length];

  const ev = (deliveryId: string, eventType: string, at: Date, actorName: string, actorId: string | null, note: string | null, customerVisible: boolean) =>
    db.deliveryEvent.create({ data: { deliveryId, eventType, createdAt: at, actorName, actorId, note, customerVisible } });

  // 1) DELIVERED
  for (const spec of DELIVERED_SPECS) {
    const [rName, rPhone, dAddr] = nextRecipient();
    const created = daysAgo(spec.day, 8 + (recIdx % 3), 15);
    const expected = daysAgo(spec.day, 17, 30);
    // on-time deliveries finish ~2.8h before the deadline, late ones ~2.2h after
    const completed = new Date(expected.getTime() + (spec.late ? 2.2 : -2.8) * HOUR);
    const code = trackingCode(created);
    const d = await db.delivery.create({
      data: {
        organizationId: swift.id,
        trackingCode: code,
        trackingToken: trackingToken(),
        recipientName: rName,
        recipientPhone: rPhone,
        pickupAddress: hub(),
        deliveryAddress: dAddr,
        instructions: nextInstruction(),
        priority: (["NORMAL", "HIGH", "NORMAL", "LOW", "NORMAL", "URGENT"] as const)[recIdx % 6],
        status: "DELIVERED",
        expectedAt: expected,
        completedAt: completed,
        createdAt: created,
      },
    });
    const driver = drivers[spec.driverIdx];
    const vehicle = swVehicles[spec.vehicleIdx];
    const assignedAt = new Date(created.getTime() + 0.6 * HOUR);
    const pickupAt = new Date(assignedAt.getTime() + 1.1 * HOUR);
    const transitAt = new Date(pickupAt.getTime() + 0.7 * HOUR);
    await db.assignment.create({
      data: { deliveryId: d.id, driverId: driver.id, vehicleId: vehicle.id, assignedAt, completedAt: completed, active: false, outcome: "DELIVERED" },
    });
    await Promise.all([
      ev(d.id, "CREATED", created, "Morgan Reed", morgan.id, "Delivery created", true),
      ev(d.id, "ASSIGNED", assignedAt, "Morgan Reed", morgan.id, `Assigned to ${driver.name} · ${vehicle.registrationNumber}`, true),
      ev(d.id, "PICKED_UP", pickupAt, driver.name, driver.id, "Package collected from pickup point", true),
      ev(d.id, "IN_TRANSIT", transitAt, driver.name, driver.id, "Heading to delivery address", true),
      ev(d.id, "DELIVERED", completed, driver.name, driver.id, `Delivered to ${rName} — proof recorded`, true),
    ]);
    // proof of delivery (signature)
    const png = generateSignaturePng(sigSeed++);
    const fileKey = `seed-${d.id}.png`;
    await writeFile(path.join(STORAGE, fileKey), png);
    await db.proofOfDelivery.create({
      data: { deliveryId: d.id, fileKey, fileName: `${code}-signature.png`, mimeType: "image/png", kind: "SIGNATURE", recipientName: rName, capturedAt: completed, uploadedById: driver.id },
    });
    await audit(morgan.id, "Morgan Reed", "DELIVERY_CREATED", "Delivery", d.id, { trackingCode: code }, created);
    await audit(morgan.id, "Morgan Reed", "DRIVER_ASSIGNED", "Delivery", d.id, { driver: driver.name, vehicle: vehicle.registrationNumber }, assignedAt);
  }

  // 2) FAILED (the failure closed the assignment → ready for reassignment)
  for (const spec of FAILED_SPECS) {
    const [rName, rPhone, dAddr] = nextRecipient();
    const created = daysAgo(spec.day, 8, 30);
    const failedAt = daysAgo(spec.day, spec.hour, 20);
    const code = trackingCode(created);
    const d = await db.delivery.create({
      data: {
        organizationId: swift.id,
        trackingCode: code,
        trackingToken: trackingToken(),
        recipientName: rName,
        recipientPhone: rPhone,
        pickupAddress: hub(),
        deliveryAddress: dAddr,
        instructions: nextInstruction(),
        priority: "HIGH",
        status: "FAILED",
        expectedAt: daysAgo(spec.day, 18, 0),
        failureReason: spec.reason,
        createdAt: created,
      },
    });
    const driver = drivers[spec.driverIdx];
    const vehicle = swVehicles[spec.vehicleIdx];
    const assignedAt = new Date(created.getTime() + 0.5 * HOUR);
    const pickupAt = spec.stage === "dropoff" ? new Date(assignedAt.getTime() + 1.2 * HOUR) : null;
    const transitAt = spec.stage === "dropoff" ? new Date(pickupAt!.getTime() + 0.6 * HOUR) : null;
    await db.assignment.create({
      data: { deliveryId: d.id, driverId: driver.id, vehicleId: vehicle.id, assignedAt, unassignedAt: failedAt, active: false, outcome: "FAILED" },
    });
    const evs = [
      ev(d.id, "CREATED", created, "Morgan Reed", morgan.id, "Delivery created", true),
      ev(d.id, "ASSIGNED", assignedAt, "Morgan Reed", morgan.id, `Assigned to ${driver.name} · ${vehicle.registrationNumber}`, true),
    ];
    if (pickupAt) evs.push(ev(d.id, "PICKED_UP", pickupAt, driver.name, driver.id, "Package collected from pickup point", true));
    if (transitAt) evs.push(ev(d.id, "IN_TRANSIT", transitAt, driver.name, driver.id, "Heading to delivery address", true));
    evs.push(ev(d.id, "FAILED", failedAt, driver.name, driver.id, failureReasonLabel(spec.reason), true));
    await Promise.all(evs);
    await audit(morgan.id, "Morgan Reed", "DELIVERY_CREATED", "Delivery", d.id, { trackingCode: code }, created);
    await audit(driver.id, driver.name, "DELIVERY_FAILED", "Delivery", d.id, { reason: spec.reason }, failedAt);
    // notify admins
    const admins = [morgan, jordan];
    for (const a of admins) {
      await db.notification.create({
        data: {
          userId: a.id, type: "FAILED", channel: "IN_APP", title: "Delivery attempt failed",
          body: `${code} — ${rName}. ${failureReasonLabel(spec.reason)}. Action needed: reassign or reschedule.`,
          deliveryId: d.id, createdAt: failedAt, readAt: spec.day >= 1 ? failedAt : null,
        },
      });
      await db.notification.create({
        data: {
          userId: a.id, type: "FAILED", channel: "EMAIL", title: `[FleetFlow] Failed delivery ${code}`,
          body: `Delivery ${code} to ${rName} failed (${failureReasonLabel(spec.reason)}). Please review and reassign.`,
          recipientEmail: a.email, deliveryId: d.id, createdAt: failedAt, readAt: spec.day >= 1 ? failedAt : null,
        },
      });
    }
  }

  // 3) ACTIVE jobs (assigned / picked up / in transit)
  // A vehicle is never with two drivers at once: Alex → DHK-1145, Priya → DHK-2087, Diego → MTR-7702.
  const ACTIVE_SPECS: { status: string; day: number; hour: number; driverIdx: number; vehicleIdx: number; stage: "assigned" | "picked" | "transit"; priority: string }[] = [
    { status: "ASSIGNED", day: 0, hour: 8, driverIdx: 0, vehicleIdx: 0, stage: "assigned", priority: "HIGH" },
    { status: "ASSIGNED", day: 0, hour: 8, driverIdx: 1, vehicleIdx: 1, stage: "assigned", priority: "NORMAL" },
    { status: "PICKED_UP", day: 0, hour: 7, driverIdx: 0, vehicleIdx: 0, stage: "picked", priority: "URGENT" },
    { status: "IN_TRANSIT", day: 0, hour: 7, driverIdx: 1, vehicleIdx: 1, stage: "transit", priority: "HIGH" },
    { status: "IN_TRANSIT", day: 0, hour: 6, driverIdx: 2, vehicleIdx: 4, stage: "transit", priority: "NORMAL" },
    { status: "ASSIGNED", day: 1, hour: 16, driverIdx: 2, vehicleIdx: 4, stage: "assigned", priority: "NORMAL" },
  ];
  for (const spec of ACTIVE_SPECS) {
    const [rName, rPhone, dAddr] = nextRecipient();
    const created = daysAgo(spec.day, spec.hour, 20);
    const code = trackingCode(created);
    const d = await db.delivery.create({
      data: {
        organizationId: swift.id,
        trackingCode: code,
        trackingToken: trackingToken(),
        recipientName: rName,
        recipientPhone: rPhone,
        pickupAddress: hub(),
        deliveryAddress: dAddr,
        instructions: nextInstruction(),
        priority: spec.priority,
        status: spec.status,
        expectedAt: daysAgo(spec.day - 1, 18, 0) > new Date() ? daysAgo(spec.day - 1, 18, 0) : new Date(Date.now() + 5 * HOUR),
        createdAt: created,
      },
    });
    const driver = drivers[spec.driverIdx];
    const vehicle = swVehicles[spec.vehicleIdx];
    const assignedAt = new Date(created.getTime() + 0.4 * HOUR);
    const pickupAt = spec.stage !== "assigned" ? new Date(assignedAt.getTime() + 0.9 * HOUR) : null;
    const transitAt = spec.stage === "transit" ? new Date(pickupAt!.getTime() + 0.5 * HOUR) : null;
    await db.assignment.create({ data: { deliveryId: d.id, driverId: driver.id, vehicleId: vehicle.id, assignedAt } });
    const evs = [
      ev(d.id, "CREATED", created, "Jordan Blake", jordan.id, "Delivery created", true),
      ev(d.id, "ASSIGNED", assignedAt, "Jordan Blake", jordan.id, `Assigned to ${driver.name} · ${vehicle.registrationNumber}`, true),
    ];
    if (pickupAt) evs.push(ev(d.id, "PICKED_UP", pickupAt, driver.name, driver.id, "Package collected from pickup point", true));
    if (transitAt) evs.push(ev(d.id, "IN_TRANSIT", transitAt, driver.name, driver.id, "Heading to delivery address", true));
    await Promise.all(evs);
    // notify driver
    await db.notification.create({
      data: {
        userId: driver.id, type: "NEW_ASSIGNMENT", channel: "IN_APP", title: "New assignment",
        body: `${code} — pickup at ${d.pickupAddress.split(",")[0]}, deliver to ${dAddr.split(",")[0]}.`,
        deliveryId: d.id, createdAt: assignedAt,
        readAt: spec.day >= 1 ? assignedAt : null,
      },
    });
    await audit(jordan.id, "Jordan Blake", "DELIVERY_CREATED", "Delivery", d.id, { trackingCode: code }, created);
    await audit(jordan.id, "Jordan Blake", "DRIVER_ASSIGNED", "Delivery", d.id, { driver: driver.name, vehicle: vehicle.registrationNumber }, assignedAt);
  }

  // 4) CREATED — pending assignment
  const PENDING: { day: number; hour: number; priority: string; expectedOffsetH: number }[] = [
    { day: 0, hour: 8, priority: "URGENT", expectedOffsetH: 6 },
    { day: 0, hour: 8, priority: "HIGH", expectedOffsetH: 8 },
    { day: 0, hour: 7, priority: "NORMAL", expectedOffsetH: 10 },
    { day: 1, hour: 15, priority: "HIGH", expectedOffsetH: 20 },
    { day: 1, hour: 11, priority: "NORMAL", expectedOffsetH: 26 },
    { day: 2, hour: 10, priority: "LOW", expectedOffsetH: 40 },
  ];
  for (const spec of PENDING) {
    const [rName, rPhone, dAddr] = nextRecipient();
    const created = daysAgo(spec.day, spec.hour, 5);
    const code = trackingCode(created);
    const d = await db.delivery.create({
      data: {
        organizationId: swift.id,
        trackingCode: code,
        trackingToken: trackingToken(),
        recipientName: rName,
        recipientPhone: rPhone,
        pickupAddress: hub(),
        deliveryAddress: dAddr,
        instructions: nextInstruction(),
        priority: spec.priority,
        status: "CREATED",
        expectedAt: new Date(Date.now() + spec.expectedOffsetH * HOUR),
        createdAt: created,
      },
    });
    await ev(d.id, "CREATED", created, "Morgan Reed", morgan.id, "Delivery created", true);
    await audit(morgan.id, "Morgan Reed", "DELIVERY_CREATED", "Delivery", d.id, { trackingCode: code }, created);
  }

  // 5) CANCELLED
  {
    const [rName, rPhone, dAddr] = nextRecipient();
    const created = daysAgo(4, 9, 0);
    const code = trackingCode(created);
    const d = await db.delivery.create({
      data: {
        organizationId: swift.id, trackingCode: code, trackingToken: trackingToken(),
        recipientName: rName, recipientPhone: rPhone, pickupAddress: hub(), deliveryAddress: dAddr,
        instructions: "", priority: "LOW", status: "CANCELLED", expectedAt: daysAgo(4, 18, 0), createdAt: created,
      },
    });
    const cancelledAt = daysAgo(4, 11, 30);
    await Promise.all([
      ev(d.id, "CREATED", created, "Morgan Reed", morgan.id, "Delivery created", true),
      ev(d.id, "CANCELLED", cancelledAt, "Morgan Reed", morgan.id, "Cancelled by customer request", true),
    ]);
    await audit(morgan.id, "Morgan Reed", "DELIVERY_CANCELLED", "Delivery", d.id, { reason: "Customer request" }, cancelledAt);
  }

  // extra audit entries for flavor
  await audit(morgan.id, "Morgan Reed", "DRIVER_CREATED", "User", alex.id, { name: "Alex Carter" }, daysAgo(20, 10, 0));
  await audit(morgan.id, "Morgan Reed", "VEHICLE_REGISTERED", "Vehicle", swVehicles[3].id, { registrationNumber: "DHK-4521" }, daysAgo(20, 10, 15));
  await audit(morgan.id, "Morgan Reed", "VEHICLE_STATUS_CHANGED", "Vehicle", swVehicles[3].id, { from: "ACTIVE", to: "MAINTENANCE" }, daysAgo(2, 9, 0));
  await audit(morgan.id, "Morgan Reed", "STATUS_OVERRIDE", "Delivery", "seed-demo", { note: "Example override entry" }, daysAgo(3, 16, 0));
  await audit(morgan.id, "Morgan Reed", "TRACKING_REGENERATED", "Delivery", "seed-demo", {}, daysAgo(5, 12, 0));

  // recent admin notifications (today)
  await db.notification.create({
    data: {
      userId: morgan.id, type: "DELIVERED", channel: "IN_APP", title: "Delivery completed",
      body: "Proof of delivery (signature) recorded.", createdAt: daysAgo(1, 15, 40), readAt: daysAgo(1, 16, 0),
    },
  });
  await db.notification.create({
    data: {
      userId: morgan.id, type: "IN_TRANSIT", channel: "IN_APP", title: "Delivery in transit",
      body: "Your delivery is on the way.", createdAt: new Date(Date.now() - 2 * HOUR),
    },
  });

  // ── NorthPort Cargo (org isolation demo) ──────────────────
  const npSpecs: [string, string, string, string][] = [
    ["Rahim Uddin", "+880 181-222-3344", "AK Khan Road, Nasirabad, Chattogram 4000", "DELIVERED"],
    ["Sneha Roy", "+880 182-333-4455", "GEC Circle, Chattogram 4225", "ASSIGNED"],
    ["Mahfuz Anam", "+880 183-444-5566", "Agrabad C/A, Chattogram 4100", "CREATED"],
  ];
  for (const [rName, rPhone, dAddr, status] of npSpecs) {
    const created = daysAgo(status === "CREATED" ? 0 : 1, 9, 0);
    const code = trackingCode(created);
    const d = await db.delivery.create({
      data: {
        organizationId: north.id, trackingCode: code, trackingToken: trackingToken(),
        recipientName: rName, recipientPhone: rPhone,
        pickupAddress: "NorthPort Depot, Airport Road, Chattogram",
        deliveryAddress: dAddr, instructions: "", priority: "NORMAL", status,
        expectedAt: daysAgo(0, 18, 0), createdAt: created,
        ...(status === "DELIVERED" ? { completedAt: daysAgo(1, 16, 0) } : {}),
      },
    });
    await ev(d.id, "CREATED", created, "Nina Patel", nina.id, "Delivery created", true);
  }
  const npVehicle = await db.vehicle.findFirst({ where: { organizationId: north.id, status: "ACTIVE" } });
  const npAssigned = await db.delivery.findFirst({ where: { organizationId: north.id, status: "ASSIGNED" } });
  if (npVehicle && npAssigned) {
    await db.assignment.create({ data: { deliveryId: npAssigned.id, driverId: tom.id, vehicleId: npVehicle.id } });
    await ev(npAssigned.id, "ASSIGNED", new Date(), "Nina Patel", nina.id, `Assigned to Tom Herrera · ${npVehicle.registrationNumber}`, true);
  }

  // driver availability follows active jobs (same rule as syncDriverAvailability)
  for (const u of [...drivers, tom]) {
    const active = await db.assignment.count({ where: { driverId: u.id, active: true } });
    if (active > 0) {
      await db.driverProfile.update({ where: { userId: u.id }, data: { availability: "ON_ROUTE" } });
    }
  }

  const counts = {
    users: await db.user.count(),
    deliveries: await db.delivery.count(),
    vehicles: await db.vehicle.count(),
    assignments: await db.assignment.count(),
    events: await db.deliveryEvent.count(),
    pods: await db.proofOfDelivery.count(),
    notifications: await db.notification.count(),
    audits: await db.auditLog.count(),
  };
  console.log("Seed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
