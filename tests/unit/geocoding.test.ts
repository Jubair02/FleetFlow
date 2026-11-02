import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Delivery geocoding: point validation, edit rules, concurrency and the
// conditional write — Prisma and Barikoi are mocked.
const db = vi.hoisted(() => ({
  delivery: { findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
const geocodeAddress = vi.hoisted(() => vi.fn());
vi.mock("@/lib/barikoi", async (orig) => ({ ...(await orig<typeof import("@/lib/barikoi")>()), geocodeAddress }));

import {
  geocodeDeliveries,
  geocodeDelivery,
  geocodePendingDeliveries,
  mapWithConcurrency,
  parseDeliveryPoint,
  planCoordinateUpdate,
} from "@/lib/geocoding";
import { ApiError } from "@/lib/api-helpers";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BARIKOI_API_KEY", "bk_test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseDeliveryPoint", () => {
  it("accepts a pair inside Bangladesh, rounded", () => {
    expect(parseDeliveryPoint(23.7465123, 90.3760987)).toEqual({ lat: 23.74651, lng: 90.3761 });
    expect(parseDeliveryPoint(undefined, undefined)).toBeNull();
    expect(parseDeliveryPoint(null, null)).toBeNull();
  });

  it("refuses half a pair, swapped or foreign points", () => {
    expect(() => parseDeliveryPoint(23.7, null)).toThrow(ApiError);
    expect(() => parseDeliveryPoint(23.7, 85.1)).toThrow(/inside Bangladesh/);
    expect(() => parseDeliveryPoint(90.4, 23.7)).toThrow(/valid coordinate/); // swapped
    expect(() => parseDeliveryPoint(51.5, -0.12, "pickup point")).toThrow(/pickup point must be inside/);
    expect(() => parseDeliveryPoint(Number.NaN, 90)).toThrow(/valid coordinate/);
  });
});

describe("planCoordinateUpdate", () => {
  const none = { deliveryLat: null, deliveryLng: null, geoSource: null };
  const geocoded = { deliveryLat: 23.7, deliveryLng: 90.4, geoSource: "GEOCODED" };
  const pinned = { deliveryLat: 23.7, deliveryLng: 90.4, geoSource: "PIN" };

  it("a new pin always wins and is stored as PIN", () => {
    expect(planCoordinateUpdate(geocoded, { lat: 23.8, lng: 90.41 }, true)).toEqual({
      data: { deliveryLat: 23.8, deliveryLng: 90.41, geoSource: "PIN" },
      geocode: false,
    });
    // same pin again: nothing to write
    expect(planCoordinateUpdate(pinned, { lat: 23.7, lng: 90.4 }, false)).toEqual({ data: {}, geocode: false });
  });

  it("removing the pin clears it and looks the address up again", () => {
    expect(planCoordinateUpdate(pinned, null, false)).toEqual({
      data: { deliveryLat: null, deliveryLng: null, geoSource: null, geocodeAttemptedAt: null },
      geocode: true,
    });
  });

  it("an address change re-geocodes GEOCODED or missing points but keeps PIN/API/DRIVER ones", () => {
    expect(planCoordinateUpdate(geocoded, undefined, true)).toMatchObject({ data: { deliveryLat: null, geoSource: null }, geocode: true });
    expect(planCoordinateUpdate(none, undefined, true)).toEqual({ data: { geocodeAttemptedAt: null }, geocode: true });
    for (const geoSource of ["PIN", "API", "DRIVER"]) {
      expect(planCoordinateUpdate({ ...pinned, geoSource }, undefined, true)).toEqual({ data: {}, geocode: false });
    }
    expect(planCoordinateUpdate(geocoded, undefined, false)).toEqual({ data: {}, geocode: false });
  });
});

describe("mapWithConcurrency", () => {
  it("keeps order and never exceeds the limit", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5 - (n % 3)));
      running--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
    expect(peak).toBeLessThanOrEqual(4);
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("geocodeDelivery", () => {
  it("fills an empty point only, conditionally on the same address", async () => {
    db.delivery.findUnique.mockResolvedValue({ deliveryAddress: "House 12, Road 5", deliveryLat: null, deliveryLng: null });
    geocodeAddress.mockResolvedValue({ lat: 23.75, lng: 90.38, confidence: 80, formatted: null });
    db.delivery.updateMany.mockResolvedValue({ count: 1 });
    expect(await geocodeDelivery("d1")).toBe("located");
    const call = db.delivery.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "d1", deliveryLat: null, deliveryLng: null, deliveryAddress: "House 12, Road 5" });
    expect(call.data).toMatchObject({ deliveryLat: 23.75, deliveryLng: 90.38, geoSource: "GEOCODED" });
    expect(call.data.geocodeAttemptedAt).toBeInstanceOf(Date);
  });

  it("stamps the attempt when nothing is found", async () => {
    db.delivery.findUnique.mockResolvedValue({ deliveryAddress: "Somewhere", deliveryLat: null, deliveryLng: null });
    geocodeAddress.mockResolvedValue(null);
    db.delivery.updateMany.mockResolvedValue({ count: 1 });
    expect(await geocodeDelivery("d1")).toBe("not_found");
    expect(Object.keys(db.delivery.updateMany.mock.calls[0][0].data)).toEqual(["geocodeAttemptedAt"]);
  });

  it("never touches a delivery that already has a point, or loses the race to a pin", async () => {
    db.delivery.findUnique.mockResolvedValue({ deliveryAddress: "x", deliveryLat: 23.7, deliveryLng: 90.4 });
    expect(await geocodeDelivery("d1")).toBe("skipped");
    expect(geocodeAddress).not.toHaveBeenCalled();

    db.delivery.findUnique.mockResolvedValue({ deliveryAddress: "x", deliveryLat: null, deliveryLng: null });
    geocodeAddress.mockResolvedValue({ lat: 23.75, lng: 90.38, confidence: 80, formatted: null });
    db.delivery.updateMany.mockResolvedValue({ count: 0 });
    expect(await geocodeDelivery("d1")).toBe("skipped");
  });

  it("does nothing (and stamps nothing) without a key", async () => {
    vi.stubEnv("BARIKOI_API_KEY", "");
    expect(await geocodeDelivery("d1")).toBe("skipped");
    expect(await geocodePendingDeliveries()).toBeNull();
    expect(db.delivery.findUnique).not.toHaveBeenCalled();
    expect(db.delivery.findMany).not.toHaveBeenCalled();
  });
});

describe("batches", () => {
  it("counts outcomes and survives a failing row", async () => {
    db.delivery.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === "boom") throw new Error("db down");
      return { deliveryAddress: `addr ${where.id}`, deliveryLat: null, deliveryLng: null };
    });
    geocodeAddress.mockImplementation(async (a: string) => (a.endsWith("ok") ? { lat: 23.7, lng: 90.4, confidence: 90, formatted: null } : null));
    db.delivery.updateMany.mockResolvedValue({ count: 1 });
    expect(await geocodeDeliveries(["ok", "nope", "boom"])).toEqual({ located: 1, not_found: 1, skipped: 0, failed: 1 });
  });

  it("the cron picks open, never-attempted deliveries of active companies", async () => {
    db.delivery.findMany.mockResolvedValue([]);
    await geocodePendingDeliveries(50);
    const args = db.delivery.findMany.mock.calls[0][0];
    expect(args.take).toBe(50);
    expect(args.where).toMatchObject({ deliveryLat: null, geocodeAttemptedAt: null, organization: { status: "ACTIVE" } });
    expect(args.where.status.notIn).toEqual(expect.arrayContaining(["DELIVERED", "CANCELLED"]));
  });
});
