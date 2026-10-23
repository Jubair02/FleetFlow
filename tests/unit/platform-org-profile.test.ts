import { describe, expect, it } from "vitest";
import { ORG_DELIVERY_SELECT, orgActionSchema, orgDeliveriesQuery, profileChanges, successRate, toOrgDeliveryRow } from "@/lib/platform-service";

const CURRENT = { name: "Meghna Foods", contactEmail: "ops@meghna.test", phone: null, address: "Dhaka", defaultPickupAddress: null, timezone: "Asia/Dhaka" };

describe("successRate", () => {
  it("delivered ÷ (delivered + failed), one decimal, null-safe", () => {
    expect(successRate(0, 0)).toBeNull();
    expect(successRate(9, 1)).toBe(90);
    expect(successRate(2, 1)).toBe(66.7);
    expect(successRate(0, 4)).toBe(0);
    expect(successRate(Number.NaN, 1)).toBeNull();
  });
});

describe("update-profile validation", () => {
  const parse = (body: Record<string, unknown>) => orgActionSchema.safeParse({ action: "update-profile", ...body });

  it("accepts partial updates and normalizes blanks to null", () => {
    const r = parse({ name: "  Meghna Foods Ltd ", contactEmail: " OPS@Meghna.Test ", phone: "  ", timezone: "UTC" });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ name: "Meghna Foods Ltd", contactEmail: "ops@meghna.test", phone: null, timezone: "UTC" });
    expect(parse({}).success).toBe(true);
  });

  it("rejects bad input", () => {
    expect(parse({ name: "M" }).success).toBe(false);
    expect(parse({ name: "x".repeat(121) }).success).toBe(false);
    expect(parse({ contactEmail: "nope" }).success).toBe(false);
    expect(parse({ phone: "123" }).success).toBe(false);
    expect(parse({ address: "x".repeat(301) }).success).toBe(false);
    expect(parse({ timezone: "Mars/Base" }).success).toBe(false);
    expect(parse({ name: null }).success).toBe(false);
  });
});

describe("profileChanges", () => {
  it("returns only fields that differ", () => {
    expect(profileChanges(CURRENT, {})).toEqual({});
    expect(profileChanges(CURRENT, { name: "Meghna Foods", address: "Dhaka", phone: null })).toEqual({});
    expect(profileChanges(CURRENT, { address: null, phone: "01711000000", timezone: "UTC" })).toEqual({ address: null, phone: "01711000000", timezone: "UTC" });
    expect(profileChanges(CURRENT, { address: "" })).toEqual({ address: null });
  });

  it("never clears name or timezone", () => {
    expect(profileChanges(CURRENT, { name: "", timezone: "" })).toEqual({});
  });
});

describe("organization deliveries", () => {
  it("query defaults to page 1 × 10 and bounds pageSize", () => {
    expect(orgDeliveriesQuery.parse({ page: null, pageSize: null })).toEqual({ page: 1, pageSize: 10 });
    expect(orgDeliveriesQuery.parse({ page: "3", pageSize: "20" })).toEqual({ page: 3, pageSize: 20 });
    expect(orgDeliveriesQuery.safeParse({ page: "1", pageSize: "500" }).success).toBe(false);
    expect(orgDeliveriesQuery.safeParse({ page: "0", pageSize: "10" }).success).toBe(false);
  });

  it("select never includes tokens, recipient contact details or addresses", () => {
    for (const k of ["trackingToken", "recipientPhone", "recipientEmail", "deliveryAddress", "pickupAddress"]) {
      expect(ORG_DELIVERY_SELECT).not.toHaveProperty(k);
    }
  });

  it("maps a row (driver or unassigned)", () => {
    const base = { id: "d1", trackingCode: "FF-1", recipientName: "Nusrat", status: "IN_TRANSIT", createdAt: new Date("2026-10-01T00:00:00Z"), expectedAt: null };
    expect(toOrgDeliveryRow({ ...base, assignments: [{ driver: { name: "Karim" } }] })).toEqual({
      id: "d1",
      trackingCode: "FF-1",
      recipientName: "Nusrat",
      status: "IN_TRANSIT",
      driverName: "Karim",
      createdAt: "2026-10-01T00:00:00.000Z",
      expectedAt: null,
    });
    expect(toOrgDeliveryRow({ ...base, assignments: [] }).driverName).toBeNull();
  });
});
