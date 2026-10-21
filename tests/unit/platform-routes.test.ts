import { beforeEach, describe, expect, it, vi } from "vitest";

// Route-level checks with a mocked Prisma client: which rows each action may touch.
const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  organization: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  session: { deleteMany: vi.fn() },
  user: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
  assignment: { count: vi.fn() },
  auditLog: { create: vi.fn() },
  platformAuditLog: { create: vi.fn() },
}));
const db = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
const guard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform-auth", async (orig) => ({ ...(await orig<typeof import("@/lib/platform-auth")>()), requirePlatformAdmin: guard }));

import { PATCH as patchOrg } from "@/app/api/platform/organizations/[id]/route";
import { PATCH as patchUser } from "@/app/api/platform/users/[id]/route";
import { ApiError } from "@/lib/api-helpers";

const json = (body: unknown) =>
  new Request("http://localhost/api/platform/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({ id: "pa1", name: "Root", mustChangePassword: false });
  db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  tx.$queryRaw.mockResolvedValue([{ id: "org1" }]);
  tx.session.deleteMany.mockResolvedValue({ count: 4 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PATCH /api/platform/organizations/[id]", () => {
  it("is guarded: a 401 from requirePlatformAdmin stops everything", async () => {
    guard.mockRejectedValueOnce(new ApiError(401, "Platform authentication required"));
    const res = await patchOrg(json({ action: "reactivate" }), params("org1"));
    expect(res.status).toBe(401);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("suspend: updates only that org, drops only its users' sessions, writes both audit rows", async () => {
    tx.organization.findUniqueOrThrow.mockResolvedValue({ id: "org1", status: "ACTIVE", plan: "trial" });
    const res = await patchOrg(json({ action: "suspend", reason: "Unpaid invoice" }), params("org1"));
    expect(res.status).toBe(200);
    expect(tx.organization.update).toHaveBeenCalledTimes(1);
    expect(tx.organization.update.mock.calls[0][0].where).toEqual({ id: "org1" });
    expect(tx.organization.update.mock.calls[0][0].data).toMatchObject({ status: "SUSPENDED", suspendedReason: "Unpaid invoice" });
    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { user: { organizationId: "org1" } } });
    expect(tx.platformAuditLog.create.mock.calls[0][0].data).toMatchObject({ action: "ORG_SUSPENDED", organizationId: "org1", actorId: "pa1" });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "ORGANIZATION_SUSPENDED", organizationId: "org1", actorName: "FleetFlow support" });
  });

  it("suspend of an already suspended org → 409 with no writes", async () => {
    tx.organization.findUniqueOrThrow.mockResolvedValue({ id: "org1", status: "SUSPENDED", plan: "trial" });
    const res = await patchOrg(json({ action: "suspend", reason: "Again" }), params("org1"));
    expect(res.status).toBe(409);
    expect(tx.organization.update).not.toHaveBeenCalled();
    expect(tx.session.deleteMany).not.toHaveBeenCalled();
  });

  it("unknown organization → 404; invalid action → 400", async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect((await patchOrg(json({ action: "reactivate" }), params("nope"))).status).toBe(404);
    expect((await patchOrg(json({ action: "set-plan", plan: "gold" }), params("org1"))).status).toBe(400);
  });
});

describe("PATCH /api/platform/users/[id]", () => {
  const target = (over: Record<string, unknown> = {}) => ({
    id: "u1", name: "Rina", email: "rina@acme.test", role: "ADMIN", active: true, organizationId: "org1",
    organization: { status: "ACTIVE" }, ...over,
  });

  it("refuses to deactivate the last active admin of an active org (409, no writes)", async () => {
    tx.user.findUnique.mockResolvedValueOnce({ organizationId: "org1" }).mockResolvedValueOnce(target());
    tx.assignment.count.mockResolvedValue(0);
    tx.user.count.mockResolvedValue(0);
    const res = await patchUser(json({ action: "deactivate" }), params("u1"));
    expect(res.status).toBe(409);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.session.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses to deactivate a driver with active jobs (409)", async () => {
    tx.user.findUnique.mockResolvedValueOnce({ organizationId: "org1" }).mockResolvedValueOnce(target({ role: "DRIVER" }));
    tx.assignment.count.mockResolvedValue(1);
    tx.user.count.mockResolvedValue(3);
    expect((await patchUser(json({ action: "deactivate" }), params("u1"))).status).toBe(409);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("reset-password returns the temp password once and never logs it", async () => {
    tx.user.findUnique.mockResolvedValueOnce({ organizationId: "org1" }).mockResolvedValueOnce(target());
    const res = await patchUser(json({ action: "reset-password" }), params("u1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.temporaryPassword).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(tx.user.update.mock.calls[0][0].data).toMatchObject({ mustChangePassword: true });
    expect(tx.user.update.mock.calls[0][0].data.passwordHash).not.toContain(body.temporaryPassword);
    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    const logged = JSON.stringify([tx.platformAuditLog.create.mock.calls, tx.auditLog.create.mock.calls]);
    expect(logged).not.toContain(body.temporaryPassword);
    expect(tx.platformAuditLog.create.mock.calls[0][0].data.action).toBe("USER_PASSWORD_RESET");
  });

  it("unknown user → 404", async () => {
    tx.user.findUnique.mockResolvedValueOnce(null);
    expect((await patchUser(json({ action: "revoke-sessions" }), params("x"))).status).toBe(404);
  });
});
