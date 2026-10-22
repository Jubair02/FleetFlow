import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type Plan } from "@prisma/client";

// POST /api/deliveries/import with mapped rows — Prisma is mocked (no DB).
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  organization: { findUnique: vi.fn() },
  user: { count: vi.fn() },
  vehicle: { count: vi.fn() },
  delivery: { count: vi.fn(), findMany: vi.fn(), createManyAndReturn: vi.fn() },
  deliveryEvent: { createMany: vi.fn() },
  importBatch: { findUnique: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn(), findFirst: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
const requireAdmin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-helpers", async (orig) => ({ ...(await orig<typeof import("@/lib/api-helpers")>()), requireAdmin }));

import { POST } from "@/app/api/deliveries/import/route";
import { canonicalRowsJson } from "@/lib/delivery-import";
import { MAX_COMMIT_ROWS, type MappedRow } from "@/lib/import-contract";

const plan = (over: Partial<Plan> = {}): Plan => ({
  code: "growth", name: "Growth", description: "", monthlyPriceBdt: 4000, annualPriceBdt: 40000,
  maxDrivers: 20, maxVehicles: 20, maxAdmins: 3, maxMonthlyDeliveries: 3000,
  features: ["csv_import"], highlights: [], active: true, isPublic: true, isDefault: false, sortOrder: 2,
  createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-01"), ...over,
});

const row = (rowNumber: number, ref = `INV-${rowNumber}`): MappedRow => ({
  rowNumber,
  values: { order_ref: ref, recipient_name: "Rahim Uddin", recipient_phone: `0171100${String(rowNumber).padStart(4, "0")}`, delivery_address: `House ${rowNumber}, Road 5, Dhaka` },
});
const hashOf = (rows: MappedRow[]) => createHash("sha256").update(canonicalRowsJson(rows), "utf8").digest("hex");

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/deliveries/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const commit = (rows: MappedRow[], extra: Record<string, unknown> = {}) =>
  post({ mode: "commit", source: "PASTE", fileName: "Pasted rows", rows, idempotencyKey: "sess-abc123:0", ...extra });

type BatchStore = { byKey: Record<string, unknown> | null; byHash: Record<string, unknown> | null };
let batches: BatchStore;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireAdmin.mockResolvedValue({ id: "u1", name: "Owner", role: "ADMIN", organizationId: "org1" });
  db.organization.findUnique.mockResolvedValue({ planRecord: plan(), defaultPickupAddress: "Warehouse 3, Tejgaon, Dhaka", timezone: "Asia/Dhaka" });
  db.$transaction.mockImplementation(async (fn: (t: typeof db) => unknown) => fn(db));
  db.$queryRaw.mockResolvedValue([{ timezone: "Asia/Dhaka" }]);
  db.user.count.mockResolvedValue(1);
  db.vehicle.count.mockResolvedValue(1);
  db.delivery.count.mockResolvedValue(100);
  db.delivery.findMany.mockResolvedValue([]);
  db.delivery.createManyAndReturn.mockImplementation(async ({ data }: { data: { trackingCode: string; trackingToken: string; recipientName: string; recipientEmail: string | null }[] }) =>
    data.map((d, i) => ({ id: `d${i}`, trackingCode: d.trackingCode, trackingToken: d.trackingToken, recipientName: d.recipientName, recipientEmail: d.recipientEmail }))
  );
  db.importBatch.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "batch1", ...data }));
  batches = { byKey: null, byHash: null };
  db.importBatch.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
    "organizationId_idempotencyKey" in where ? batches.byKey : batches.byHash
  );
  db.auditLog.findFirst.mockResolvedValue(null);
});

describe("mapped-rows preview", () => {
  it("returns the contract shape with contentHash and the monthly allowance left", async () => {
    const rows = [row(2), row(3)];
    const res = await post({ mode: "preview", source: "PASTE", fileName: "Pasted rows", rows });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ contentHash: hashOf(rows), alreadyImported: null, timezone: "Asia/Dhaka", monthlyDeliveriesRemaining: 2900 });
    expect(body.totals).toEqual({ rows: 2, valid: 2, invalid: 0, duplicates: 0 });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.importBatch.create).not.toHaveBeenCalled();
  });

  it("unlimited plan → monthlyDeliveriesRemaining null", async () => {
    db.organization.findUnique.mockResolvedValue({ planRecord: plan({ maxMonthlyDeliveries: null }), defaultPickupAddress: null, timezone: "Asia/Dhaka" });
    const body = await (await post({ mode: "preview", source: "CSV", fileName: "orders.csv", rows: [row(2)] })).json();
    expect(body.monthlyDeliveriesRemaining).toBeNull();
  });

  it("the feature gate comes first for mapped bodies too", async () => {
    db.organization.findUnique.mockResolvedValue({ planRecord: plan({ features: [] }), defaultPickupAddress: null, timezone: "Asia/Dhaka" });
    const res = await post({ mode: "preview", source: "PASTE", fileName: "Pasted rows", rows: "nonsense" });
    expect(res.status).toBe(403);
  });

  it("validates the body: source, fileName, row numbers", async () => {
    expect((await post({ mode: "preview", source: "XLS", fileName: "x", rows: [row(2)] })).status).toBe(400);
    expect((await post({ mode: "preview", source: "PASTE", fileName: "", rows: [row(2)] })).status).toBe(400);
    expect((await post({ mode: "preview", source: "PASTE", fileName: "x".repeat(201), rows: [row(2)] })).status).toBe(400);
    const dup = await post({ mode: "preview", source: "PASTE", fileName: "Pasted rows", rows: [row(2), row(2, "OTHER")] });
    expect(dup.status).toBe(400);
    expect((await dup.json()).error).toMatch(/sent twice/);
  });
});

describe("mapped-rows commit", () => {
  it("imports a chunk: 201, ImportBatch with source + idempotencyKey + contentHash, row lists in the audit row", async () => {
    const rows = [row(2), row(3), { rowNumber: 4, values: { recipient_name: "X" } }];
    const res = await commit(rows);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ batchId: "batch1", imported: 2, skipped: 0, failed: 1, importedRows: [2, 3], skippedRows: [], failedRows: [4], emailsQueued: 0, replayed: false });
    expect(db.importBatch.create.mock.calls[0][0].data).toMatchObject({ source: "PASTE", idempotencyKey: "sess-abc123:0", fileHash: hashOf(rows), importedCount: 2, failedCount: 1 });
    expect(db.$queryRaw).toHaveBeenCalled(); // plan-limit lock
    const detail = JSON.parse(db.auditLog.create.mock.calls[0][0].data.detail);
    expect(detail).toMatchObject({ source: "PASTE", imported: 2, importedRows: "2-3", skippedRows: "", failedRows: "4" });
  });

  it("replays an already-committed idempotency key: 200, replayed=true, original lists, nothing written", async () => {
    const rows = [row(2), row(3), row(4)];
    batches.byKey = { id: "batch0", fileHash: hashOf(rows), createdAt: new Date("2026-10-21T05:00:00Z"), importedCount: 2, skippedCount: 1, failedCount: 0 };
    db.auditLog.findFirst.mockResolvedValue({ detail: JSON.stringify({ importedRows: "2-3", skippedRows: "4", failedRows: "", emailsQueued: 1 }) });
    const res = await commit(rows);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ batchId: "batch0", imported: 2, skipped: 1, failed: 0, importedRows: [2, 3], skippedRows: [4], failedRows: [], emailsQueued: 1, replayed: true });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.importBatch.create).not.toHaveBeenCalled();
  });

  it("a key reused for different rows is a 409", async () => {
    batches.byKey = { id: "batch0", fileHash: "something-else", createdAt: new Date(), importedCount: 1, skippedCount: 0, failedCount: 0 };
    const res = await commit([row(2)]);
    expect(res.status).toBe(409);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("a concurrent commit with the same key (P2002 on idempotencyKey) is answered as a replay", async () => {
    const rows = [row(2)];
    let committed = false;
    db.importBatch.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      "organizationId_idempotencyKey" in where && committed
        ? { id: "batchX", fileHash: hashOf(rows), createdAt: new Date(), importedCount: 1, skippedCount: 0, failedCount: 0 }
        : null
    );
    db.$transaction.mockImplementation(async () => {
      committed = true;
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6", meta: { modelName: "ImportBatch", target: ["organizationId", "idempotencyKey"] } });
    });
    db.auditLog.findFirst.mockResolvedValue({ detail: JSON.stringify({ importedRows: "2" }) });
    const res = await commit(rows);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ batchId: "batchX", imported: 1, importedRows: [2], replayed: true });
  });

  it("the same content already imported under another key → 409 with who/when", async () => {
    batches.byHash = { createdAt: new Date("2026-10-20T08:05:00Z"), createdByName: "Karim" };
    const res = await commit([row(2)]);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/These rows were already imported on 20 Oct 2026, 14:05 by Karim/);
  });

  it(`rejects more than ${MAX_COMMIT_ROWS} rows per commit chunk (400, nothing written)`, async () => {
    const rows = Array.from({ length: MAX_COMMIT_ROWS + 1 }, (_, i) => row(i + 2));
    const res = await commit(rows);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/At most 500 rows/);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect((await commit(rows.slice(0, MAX_COMMIT_ROWS))).status).toBe(201);
  });

  it("requires a well-formed idempotencyKey", async () => {
    expect((await commit([row(2)], { idempotencyKey: undefined })).status).toBe(400);
    expect((await commit([row(2)], { idempotencyKey: "short" })).status).toBe(400);
    expect((await commit([row(2)], { idempotencyKey: "has spaces in it" })).status).toBe(400);
  });

  it("likely duplicates are imported only when allowed; exact order_ref duplicates never", async () => {
    const same = { recipient_name: "Rahim Uddin", recipient_phone: "01711234567", delivery_address: "House 12, Road 5, Dhaka" };
    const rows: MappedRow[] = [
      { rowNumber: 2, values: { ...same } },
      { rowNumber: 3, values: { ...same } }, // likely_in_file
      { rowNumber: 4, values: { ...same, order_ref: "INV-9", delivery_address: "Elsewhere 1, Dhaka" } },
      { rowNumber: 5, values: { ...same, order_ref: "INV-9", delivery_address: "Elsewhere 2, Dhaka" } }, // exact in file
    ];
    const body = await (await commit(rows, { allowLikelyDuplicates: [3, 5] })).json();
    expect(body).toMatchObject({ imported: 3, importedRows: [2, 3, 4], skippedRows: [5] });
    expect(db.delivery.createManyAndReturn.mock.calls[0][0].data).toHaveLength(3);
  });

  it("a chunk with nothing importable writes nothing and reports the rows", async () => {
    const res = await commit([{ rowNumber: 2, values: { recipient_name: "X" } }]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 0, failed: 1, failedRows: [2], replayed: false });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("legacy { csv } body", () => {
  it("is still accepted (preview)", async () => {
    const csv = "recipient_name,recipient_phone,delivery_address\nRahim Uddin,01711234567,House 12 Road 5 Dhaka\n";
    const res = await post({ mode: "preview", fileName: "orders.csv", csv });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.totals.valid).toBe(1);
  });
});
