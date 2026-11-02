import { describe, expect, it } from "vitest";
import { instantToWallInput, toZoned, tzQueryOffset, wallTimeToInstant } from "@/lib/zoned";

// Instants are absolute; these must hold whatever timezone the test machine runs in.
describe("company-timezone helpers", () => {
  it("shows an instant's wall-clock time in the company timezone", () => {
    const z = toZoned(new Date("2026-10-29T20:30:00.000Z"), "Asia/Dhaka"); // 02:30 next day in Dhaka
    expect([z.getDate(), z.getHours(), z.getMinutes()]).toEqual([30, 2, 30]);
  });

  it("reads datetime-local and date values as company time", () => {
    expect(wallTimeToInstant("2026-10-30T17:00", "Asia/Dhaka")?.toISOString()).toBe("2026-10-30T11:00:00.000Z");
    expect(wallTimeToInstant("2026-10-30", "Asia/Dhaka")?.toISOString()).toBe("2026-10-29T18:00:00.000Z");
    expect(wallTimeToInstant("2026-07-01T09:00", "Europe/London")?.toISOString()).toBe("2026-07-01T08:00:00.000Z");
  });

  it("rejects malformed or impossible dates", () => {
    expect(wallTimeToInstant("", "Asia/Dhaka")).toBeNull();
    expect(wallTimeToInstant("30/10/2026", "Asia/Dhaka")).toBeNull();
    expect(wallTimeToInstant("2026-02-31", "Asia/Dhaka")).toBeNull();
    expect(wallTimeToInstant("2026-10-30T25:00", "Asia/Dhaka")).toBeNull();
  });

  it("round-trips through the datetime-local input value", () => {
    const instant = new Date("2026-12-31T19:45:00.000Z");
    const value = instantToWallInput(instant, "Asia/Dhaka");
    expect(value).toBe("2027-01-01T01:45");
    expect(wallTimeToInstant(value, "Asia/Dhaka")?.getTime()).toBe(instant.getTime());
  });

  it("gives the API tz parameter with getTimezoneOffset's sign", () => {
    expect(tzQueryOffset("Asia/Dhaka")).toBe(-360);
    expect(tzQueryOffset("UTC") === 0).toBe(true);
  });
});
