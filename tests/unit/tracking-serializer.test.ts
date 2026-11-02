import { beforeEach, describe, expect, it, vi } from "vitest";

// tracking.ts talks to Prisma through "@/lib/db" — replace it with a mock (no DB access).
const db = vi.hoisted(() => ({ delivery: { findUnique: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db }));

import { isValidTrackingToken, loadTracking, serializeTracking } from "@/lib/tracking";

const TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

/** A delivery row as Prisma would return it — including internal fields that must never leak. */
function deliveryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "del_internal_1",
    organizationId: "org_1",
    trackingCode: "FF-AB12",
    trackingToken: TOKEN,
    trackingEnabled: true,
    status: "IN_TRANSIT",
    recipientName: "Karim Uddin",
    recipientPhone: "+8801700000000",
    recipientEmail: "karim@example.com",
    deliveryAddress: "House 12, Road 5, Dhanmondi, Dhaka",
    expectedAt: new Date("2026-10-29T12:00:00Z"),
    createdAt: new Date("2026-10-28T04:00:00Z"),
    completedAt: null,
    failureReason: null,
    internalNotes: "VIP — gate code 4421",
    codAmount: 1250,
    driverId: "drv_1",
    vehicleId: "veh_1",
    driver: { name: "Rafiq Driver", phone: "+8801811111111" },
    vehicle: { registration: "DHA-METRO-11-2233" },
    organization: { name: "Rahman Traders", phone: "+8801912345678", timezone: "Asia/Dhaka" },
    events: [
      { eventType: "CREATED", note: "Created by admin Jamal", createdAt: new Date("2026-10-28T04:00:00Z"), actorName: "Jamal" },
      { eventType: "ASSIGNED", note: "Assigned to Rafiq Driver (DHA-METRO-11-2233)", createdAt: new Date("2026-10-28T05:00:00Z"), actorName: "Jamal" },
      { eventType: "NOTE", note: "Your parcel will arrive after lunch.", createdAt: new Date("2026-10-28T06:00:00Z"), actorName: "Jamal" },
    ],
    ...overrides,
  };
}

describe("serializeTracking", () => {
  it("returns exactly the customer-safe fields", () => {
    const data = serializeTracking(deliveryRow());
    expect(Object.keys(data).sort()).toEqual(
      [
        "codAmount",
        "completedAt",
        "createdAt",
        "deliveryAddress",
        "expectedAt",
        "failureReason",
        "failureReasonCode",
        "recipientName",
        "sender",
        "status",
        "timeline",
        "timezone",
        "trackingCode",
        "branding",
        "feedback",
      ].sort(),
    );
    expect(Object.keys(data.sender).sort()).toEqual(["name", "phone"]);
    for (const ev of data.timeline) expect(Object.keys(ev).sort()).toEqual(["eventType", "note", "timestamp"]);
  });

  it("never leaks driver, vehicle, internal notes or IDs", () => {
    const json = JSON.stringify(serializeTracking(deliveryRow()));
    for (const secret of ["Rafiq", "DHA-METRO", "gate code", "Jamal", "del_internal_1", "drv_1", "veh_1", "org_1", "+8801700000000", "karim@example.com", TOKEN]) {
      expect(json).not.toContain(secret);
    }
  });

  it("only passes through notes on customer NOTE events", () => {
    const data = serializeTracking(deliveryRow());
    expect(data.timeline.map((e) => e.note)).toEqual([null, null, "Your parcel will arrive after lunch."]);
  });

  it("includes codAmount, timezone and the sender's public details", () => {
    const data = serializeTracking(deliveryRow());
    expect(data.codAmount).toBe(1250);
    expect(data.timezone).toBe("Asia/Dhaka");
    expect(data.sender).toEqual({ name: "Rahman Traders", phone: "+8801912345678" });
    expect(data.expectedAt).toBe("2026-10-29T12:00:00.000Z");
  });

  it("treats null / zero COD as prepaid and defaults the timezone", () => {
    expect(serializeTracking(deliveryRow({ codAmount: null })).codAmount).toBeNull();
    expect(serializeTracking(deliveryRow({ codAmount: 0 })).codAmount).toBeNull();
    const org = { name: "X", phone: null, timezone: "" };
    expect(serializeTracking(deliveryRow({ organization: org })).timezone).toBe("Asia/Dhaka");
  });

  it("exposes the failure reason only when FAILED, and completedAt only when DELIVERED", () => {
    const failed = serializeTracking(deliveryRow({ status: "FAILED", failureReason: "RECIPIENT_UNAVAILABLE" }));
    expect(failed.failureReason).toBe("Recipient not available");
    expect(failed.failureReasonCode).toBe("RECIPIENT_UNAVAILABLE");
    const active = serializeTracking(deliveryRow({ failureReason: "RECIPIENT_UNAVAILABLE", completedAt: new Date() }));
    expect(active.failureReason).toBeNull();
    expect(active.failureReasonCode).toBeNull();
    expect(active.completedAt).toBeNull();
    const done = serializeTracking(deliveryRow({ status: "DELIVERED", completedAt: new Date("2026-10-29T09:12:00Z") }));
    expect(done.completedAt).toBe("2026-10-29T09:12:00.000Z");
  });
});

describe("loadTracking", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects malformed tokens without touching the database", async () => {
    expect(isValidTrackingToken("not-a-token")).toBe(false);
    expect(isValidTrackingToken(TOKEN)).toBe(true);
    expect(await loadTracking("../../etc")).toEqual({ kind: "not_found" });
    expect(db.delivery.findUnique).not.toHaveBeenCalled();
  });

  it("asks Prisma only for customer-visible events and public org fields", async () => {
    db.delivery.findUnique.mockResolvedValue(deliveryRow());
    const r = await loadTracking(TOKEN);
    expect(r.kind).toBe("ok");
    const args = db.delivery.findUnique.mock.calls[0][0];
    expect(args.where).toEqual({ trackingToken: TOKEN });
    expect(args.include.events.where).toEqual({ customerVisible: true });
    // Public business details + branding / feedback switches; the plan only as its feature list.
    expect(Object.keys(args.include.organization.select).sort()).toEqual(
      ["allowCustomerRating", "allowCustomerReschedule", "brandColor", "brandLogoKey", "id", "name", "phone", "planRecord", "timezone", "trackingMessage"].sort(),
    );
    expect(args.include.organization.select.planRecord).toEqual({ select: { features: true } });
    expect(Object.keys(args.include).sort()).toEqual(["_count", "events", "organization"]);
  });

  it("reports unknown and revoked links", async () => {
    db.delivery.findUnique.mockResolvedValue(null);
    expect(await loadTracking(TOKEN)).toEqual({ kind: "not_found" });
    db.delivery.findUnique.mockResolvedValue(deliveryRow({ trackingEnabled: false }));
    expect(await loadTracking(TOKEN)).toEqual({ kind: "revoked" });
  });
});
