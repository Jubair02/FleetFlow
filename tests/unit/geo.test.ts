import { describe, expect, it } from "vitest";
import { haversineKm, inServiceArea, isValidLatLng, roadKm, roundCoord, toLatLng, travelMinutes } from "@/lib/geo";

const DHANMONDI = { lat: 23.7465, lng: 90.376 };
const GULSHAN = { lat: 23.7925, lng: 90.4078 };

describe("geo", () => {
  it("measures great-circle distance", () => {
    expect(haversineKm(DHANMONDI, DHANMONDI)).toBe(0);
    // Dhanmondi ↔ Gulshan is roughly 6 km as the crow flies.
    expect(haversineKm(DHANMONDI, GULSHAN)).toBeGreaterThan(5.5);
    expect(haversineKm(DHANMONDI, GULSHAN)).toBeLessThan(6.5);
    expect(haversineKm(DHANMONDI, GULSHAN)).toBeCloseTo(haversineKm(GULSHAN, DHANMONDI), 10);
  });

  it("stretches road distance and converts it to minutes", () => {
    expect(roadKm(DHANMONDI, GULSHAN)).toBeGreaterThan(haversineKm(DHANMONDI, GULSHAN));
    const minutes = travelMinutes(DHANMONDI, GULSHAN);
    expect(minutes).toBeCloseTo((roadKm(DHANMONDI, GULSHAN) / 18) * 60, 6);
    expect(travelMinutes(DHANMONDI, GULSHAN, 36)).toBeCloseTo(minutes / 2, 6);
  });

  it("validates coordinates", () => {
    expect(isValidLatLng(23.7, 90.4)).toBe(true);
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(0, 181)).toBe(false);
    expect(isValidLatLng(Number.NaN, 90)).toBe(false);
    expect(isValidLatLng("23.7", 90)).toBe(false);
  });

  it("keeps points inside Bangladesh", () => {
    expect(inServiceArea(DHANMONDI)).toBe(true);
    expect(inServiceArea({ lat: 22.3569, lng: 91.7832 })).toBe(true); // Chattogram
    expect(inServiceArea({ lat: 90.376, lng: 23.7465 })).toBe(false); // swapped
    expect(inServiceArea({ lat: 51.5, lng: -0.12 })).toBe(false);
  });

  it("builds points from nullable columns and rounds", () => {
    expect(toLatLng(23.7, 90.4)).toEqual({ lat: 23.7, lng: 90.4 });
    expect(toLatLng(null, 90.4)).toBeNull();
    expect(toLatLng(23.7, undefined)).toBeNull();
    expect(roundCoord(23.746512345)).toBe(23.74651);
  });
});
