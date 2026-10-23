import { beforeEach, describe, expect, it, vi } from "vitest";

// Permanent organization deletion with a mocked Prisma client (no database is ever touched):
//  - DELETE /api/platform/organizations/[id] { confirmName }
//  - GET    /api/platform/organizations/[id]/delete-preview
const order: string[] = [];
const deleteModels = ["session", "notification", "proofOfDelivery", "deliveryEvent", "assignment", "delivery", "importBatch", "driverProfile", "vehicle", "user", "auditLog"] as const;

const tx = vi.hoisted(() => {
  const model = () => ({ deleteMany: vi.fn(), count: vi.fn(), findMany: vi.fn() });
  return {
    $queryRaw: vi.fn(),
    organization: { findUniqueOrThrow: vi.fn(), delete: vi.fn() },
    session: model(),
    notification: model(),
    proofOfDelivery: model(),
    deliveryEvent: model(),
    assignment: model(),
    delivery: model(),
    importBatch: model(),
    driverProfile: model(),
    vehicle: model(),
    user: model(),
    auditLog: model(),
    platformAuditLog: { create: vi.fn() },
  };
});
const db = vi.hoisted(() => {
  const model = () => ({ count: vi.fn() });
  return {
    $transaction: vi.fn(),
    organization: { findUnique: vi.fn() },
    session: model(),
    notification: model(),
    proofOfDelivery: model(),
    deliveryEvent: model(),
    assignment: model(),
    delivery: model(),
    importBatch: model(),
    driverProfile: model(),
    vehicle: model(),
    user: model(),
    auditLog: model(),
  };
});
const storage = vi.hoisted(() => ({ deletePodFile: vi.fn() }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/storage", () => storage);
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
const guard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform-auth", async (orig) => ({ ...(await orig<typeof import("@/lib/platform-auth")>()), requirePlatformAdmin: guard }));

import { DELETE as deleteOrg } from "@/app/api/platform/organizations/[id]/route";
import { GET as getPreview } from "@/app/api/platform/organizations/[id]/delete-preview/route";
import { ApiError } from "@/lib/api-helpers";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const del = (body: unknown, id = "org1") =>
  deleteOrg(
    new Request(`http://localhost/api/platform/organizations/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify(body),
    }),
    params(id)
  );
const preview = (id = "org1") => getPreview(new Request(`http://localhost/api/platform/organizations/${id}/delete-preview`), params(id));

const NAME = "Meghna Foods";
const ORG = { id: "org1", name: NAME, status: "SUSPENDED", plan: "growth", subscriptionStatus: "CANCELLED" };
const DELETED: Record<(typeof deleteModels)[number], number> = {
  session: 2, notification: 9, proofOfDelivery: 3, deliveryEvent: 40, assignment: 12, delivery: 10, importBatch: 1, driverProfile: 4, vehicle: 5, user: 6, auditLog: 70,
};

/** Every where-clause must reference org1 — directly or through a relation filter — and nothing else. */
function scopedToOrg(where: unknown): boolean {
  const json = JSON.stringify(where);
  return json.includes('"organizationId":"org1"') && !/"organizationId":"(?!org1")/.test(json);
}

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  guard.mockResolvedValue({ id: "pa1", name: "Root", mustChangePassword: false });
  db.organization.findUnique.mockResolvedValue(ORG);
  db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => {
    order.push("tx:start");
    const result = await fn(tx);
    order.push("tx:commit");
    return result;
  });
  tx.$queryRaw.mockImplementation(async () => {
    order.push("lock");
    return [{ id: "org1" }];
  });
  tx.organization.findUniqueOrThrow.mockResolvedValue(ORG);
  tx.organization.delete.mockImplementation(async () => {
    order.push("organization.delete");
    return ORG;
  });
  tx.proofOfDelivery.findMany.mockResolvedValue([{ fileKey: "a1.png" }, { fileKey: "b2.jpg" }, { fileKey: "c3.webp" }]);
  tx.user.count.mockResolvedValue(4);
  for (const m of deleteModels) {
    tx[m].deleteMany.mockImplementation(async () => {
      order.push(`${m}.deleteMany`);
      return { count: DELETED[m] };
    });
  }
  tx.platformAuditLog.create.mockImplementation(async () => {
    order.push("audit");
    return {};
  });
  storage.deletePodFile.mockImplementation(async (key: string) => {
    order.push(`file:${key}`);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("DELETE /api/platform/organizations/[id]", () => {
  it("runs the platform guard first — no database access without a platform admin", async () => {
    guard.mockRejectedValueOnce(new ApiError(401, "Platform authentication required"));
    expect((await del({ confirmName: NAME })).status).toBe(401);
    guard.mockRejectedValueOnce(new ApiError(403, "Change your temporary password before using the platform console"));
    expect((await del({ confirmName: NAME })).status).toBe(403);
    expect(db.organization.findUnique).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(storage.deletePodFile).not.toHaveBeenCalled();
  });

  it("rejects a missing or non-string confirmName with 400 before touching the database", async () => {
    for (const body of [{}, { confirmName: 42 }, { confirmName: "" }]) {
      const res = await del(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Type the organization name exactly to confirm");
    }
    expect(db.organization.findUnique).not.toHaveBeenCalled();
  });

  it("unknown organization → 404, nothing deleted", async () => {
    db.organization.findUnique.mockResolvedValueOnce(null);
    expect((await del({ confirmName: NAME }, "nope")).status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("an ACTIVE organization → 409 asking to suspend first, nothing deleted", async () => {
    db.organization.findUnique.mockResolvedValueOnce({ ...ORG, status: "ACTIVE" });
    const res = await del({ confirmName: NAME });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Suspend the organization before deleting it");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("a name that isn't an exact match → 400 (case, trailing/leading space, partial)", async () => {
    for (const confirmName of ["meghna foods", "MEGHNA FOODS", `${NAME} `, ` ${NAME}`, "Meghna"]) {
      const res = await del({ confirmName });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Type the organization name exactly to confirm");
    }
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("re-checks status and name under the row lock (reactivated or renamed concurrently → nothing deleted)", async () => {
    tx.organization.findUniqueOrThrow.mockResolvedValueOnce({ ...ORG, status: "ACTIVE" });
    expect((await del({ confirmName: NAME })).status).toBe(409);
    tx.organization.findUniqueOrThrow.mockResolvedValueOnce({ ...ORG, name: "Renamed Ltd" });
    expect((await del({ confirmName: NAME })).status).toBe(400);
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect((await del({ confirmName: NAME })).status).toBe(404);
    for (const m of deleteModels) expect(tx[m].deleteMany).not.toHaveBeenCalled();
    expect(tx.organization.delete).not.toHaveBeenCalled();
    expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
    expect(storage.deletePodFile).not.toHaveBeenCalled();
  });

  it("deletes only rows of that organization, in FK-safe order, audits before commit and removes files after commit", async () => {
    const res = await del({ confirmName: NAME });
    expect(res.status).toBe(200);
    const counts = {
      users: 6, drivers: 4, driverProfiles: 4, sessions: 2, vehicles: 5, deliveries: 10, proofOfDelivery: 3, deliveryEvents: 40, assignments: 12,
      importBatches: 1, notifications: 9, auditLogs: 70,
    };
    expect(await res.json()).toEqual({ deleted: true, counts });

    // Generous, explicit transaction options.
    expect(db.$transaction.mock.calls[0][1]).toEqual({ maxWait: 15000, timeout: 120000 });
    // The lock is taken on the Organization row with FOR UPDATE, schema-qualified.
    const lockSql = (tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(lockSql).toMatch(/SELECT id FROM \? WHERE id = \? FOR UPDATE/);
    expect(tx.$queryRaw.mock.calls[0].slice(1).map(String)).toContain("org1");

    // Every delete/collect where-clause is scoped to org1.
    for (const m of deleteModels) {
      expect(tx[m].deleteMany).toHaveBeenCalledTimes(1);
      const where = tx[m].deleteMany.mock.calls[0][0].where;
      expect(where, m).toBeDefined();
      expect(scopedToOrg(where), `${m}: ${JSON.stringify(where)}`).toBe(true);
    }
    expect(tx.proofOfDelivery.findMany.mock.calls[0][0].where).toEqual({ delivery: { organizationId: "org1" } });
    expect(tx.user.count.mock.calls[0][0].where).toEqual({ organizationId: "org1", role: "DRIVER" });
    expect(tx.session.deleteMany.mock.calls[0][0].where).toEqual({ user: { organizationId: "org1" } });
    expect(tx.notification.deleteMany.mock.calls[0][0].where).toEqual({ OR: [{ organizationId: "org1" }, { user: { organizationId: "org1" } }] });
    expect(tx.assignment.deleteMany.mock.calls[0][0].where).toEqual({ delivery: { organizationId: "org1" } });
    expect(tx.user.deleteMany.mock.calls[0][0].where).toEqual({ organizationId: "org1" });
    expect(tx.organization.delete).toHaveBeenCalledWith({ where: { id: "org1" } });

    // FK-safe order, then audit, then commit, then file cleanup.
    expect(order).toEqual([
      "tx:start",
      "lock",
      "session.deleteMany",
      "notification.deleteMany",
      "proofOfDelivery.deleteMany",
      "deliveryEvent.deleteMany",
      "assignment.deleteMany",
      "delivery.deleteMany",
      "importBatch.deleteMany",
      "driverProfile.deleteMany",
      "vehicle.deleteMany",
      "user.deleteMany",
      "auditLog.deleteMany",
      "organization.delete",
      "audit",
      "tx:commit",
      "file:a1.png",
      "file:b2.jpg",
      "file:c3.webp",
    ]);

    // Platform audit row with safe metadata only.
    const audit = tx.platformAuditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: "ORG_DELETED", actorId: "pa1", actorName: "Root", targetType: "Organization", targetId: "org1", organizationId: "org1", ip: "203.0.113.7" });
    expect(JSON.parse(audit.detail)).toEqual({ name: NAME, id: "org1", plan: "growth", status: "SUSPENDED", subscriptionStatus: "CANCELLED", counts });
    expect(audit.detail).not.toContain("a1.png");
  });

  it("file cleanup is best effort: a failing file is logged and the response is still a success", async () => {
    storage.deletePodFile.mockRejectedValueOnce(new Error("disk gone"));
    const res = await del({ confirmName: NAME });
    expect(res.status).toBe(200);
    expect(storage.deletePodFile).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenCalled();
  });

  it("a failing delete rolls everything back and no file is removed", async () => {
    tx.user.deleteMany.mockRejectedValueOnce(new Error("FK violation"));
    expect((await del({ confirmName: NAME })).status).toBe(500);
    expect(order).not.toContain("tx:commit");
    expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
    expect(storage.deletePodFile).not.toHaveBeenCalled();
  });
});

describe("GET /api/platform/organizations/[id]/delete-preview", () => {
  beforeEach(() => {
    for (const m of deleteModels) db[m].count.mockResolvedValue(DELETED[m]);
    db.user.count.mockImplementation(async ({ where }: { where: { role?: string } }) => (where.role === "DRIVER" ? 4 : 6));
  });

  it("is guarded first", async () => {
    guard.mockRejectedValueOnce(new ApiError(401, "Platform authentication required"));
    expect((await preview()).status).toBe(401);
    expect(db.organization.findUnique).not.toHaveBeenCalled();
    for (const m of deleteModels) expect(db[m].count).not.toHaveBeenCalled();
  });

  it("unknown organization → 404", async () => {
    db.organization.findUnique.mockResolvedValueOnce(null);
    expect((await preview("nope")).status).toBe(404);
  });

  it("returns name, status and org-scoped counts without deleting anything", async () => {
    db.organization.findUnique.mockResolvedValueOnce({ ...ORG, status: "ACTIVE" });
    const res = await preview();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: NAME,
      status: "ACTIVE",
      counts: {
        users: 6, drivers: 4, driverProfiles: 4, sessions: 2, vehicles: 5, deliveries: 10, proofOfDelivery: 3, deliveryEvents: 40, assignments: 12,
        importBatches: 1, notifications: 9, auditLogs: 70,
      },
    });
    for (const m of deleteModels) {
      for (const call of db[m].count.mock.calls) expect(scopedToOrg(call[0].where), `${m}: ${JSON.stringify(call[0].where)}`).toBe(true);
    }
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
