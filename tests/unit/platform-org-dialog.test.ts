import { describe, expect, it } from "vitest";
import {
  changedProfile, formatRate, mergeActivity, profileFormFrom, renewalLabel, timezoneOptions, validateProfile, type ProfileForm,
} from "@/components/platform/organizations/dialog/org-dialog-utils";
import { rowNumber } from "@/components/platform/organizations/org-list-utils";
import { isValidTimezone } from "@/lib/timezone";
import type { PlatformOrgDetail } from "@/lib/platform-types";

const fmt = (iso: string) => iso.slice(0, 10);
const NOW = new Date("2026-10-22T12:00:00Z");

describe("rowNumber", () => {
  it("numbers rows across pages", () => {
    expect(rowNumber(1, 20, 0)).toBe(1);
    expect(rowNumber(2, 20, 0)).toBe(21);
    expect(rowNumber(3, 10, 4)).toBe(25);
    expect(rowNumber(0, 10, 0)).toBe(1); // defensive
  });
});

describe("renewalLabel", () => {
  it("renews / ends / ended", () => {
    expect(renewalLabel(null, "ACTIVE", NOW, fmt)).toBeNull();
    expect(renewalLabel("2026-11-30T00:00:00.000Z", "ACTIVE", NOW, fmt)).toBe("Renews 2026-11-30");
    expect(renewalLabel("2026-11-30T00:00:00.000Z", "CANCELLED", NOW, fmt)).toBe("Ends 2026-11-30");
    expect(renewalLabel("2026-10-01T00:00:00.000Z", "PAST_DUE", NOW, fmt)).toBe("Ended 2026-10-01");
    expect(renewalLabel("not a date", "ACTIVE", NOW, fmt)).toBeNull();
  });
});

describe("formatRate", () => {
  it("is null-safe and trims .0", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatRate(undefined)).toBe("—");
    expect(formatRate(100)).toBe("100%");
    expect(formatRate(96.4)).toBe("96.4%");
  });
});

const ORG = {
  name: "Meghna Foods",
  contactEmail: "ops@meghna.test",
  phone: null,
  address: "Dhaka",
  defaultPickupAddress: null,
  timezone: "Asia/Dhaka",
} as unknown as PlatformOrgDetail["organization"];

describe("edit organization form", () => {
  const initial = profileFormFrom(ORG);
  const edit = (patch: Partial<ProfileForm>): ProfileForm => ({ ...initial, ...patch });

  it("seeds empty strings for missing optional fields", () => {
    expect(initial).toEqual({ name: "Meghna Foods", contactEmail: "ops@meghna.test", phone: "", address: "Dhaka", defaultPickupAddress: "", timezone: "Asia/Dhaka" });
  });

  it("sends only changed fields; cleared optionals become null", () => {
    expect(changedProfile(initial, initial)).toEqual({});
    expect(changedProfile(initial, edit({ name: "  Meghna Foods  " }))).toEqual({});
    expect(changedProfile(initial, edit({ address: "", phone: "01711000000", contactEmail: "OPS@meghna.test" }))).toEqual({ address: null, phone: "01711000000" });
    expect(changedProfile(initial, edit({ name: "Meghna Foods Ltd", timezone: "UTC" }))).toEqual({ name: "Meghna Foods Ltd", timezone: "UTC" });
  });

  it("validates like the server", () => {
    expect(validateProfile(initial, isValidTimezone)).toEqual({});
    const e = validateProfile(edit({ name: "M", contactEmail: "nope", phone: "123", address: "x".repeat(301), timezone: "Mars/Base" }), isValidTimezone);
    expect(Object.keys(e).sort()).toEqual(["address", "contactEmail", "name", "phone", "timezone"]);
    expect(validateProfile(edit({ name: "x".repeat(121) }), isValidTimezone).name).toMatch(/120/);
  });

  it("keeps an unlisted saved timezone selectable", () => {
    expect(timezoneOptions("Asia/Dhaka")[0].value).toBe("Asia/Dhaka");
    expect(timezoneOptions("America/New_York")[0]).toEqual({ value: "America/New_York", label: "America/New_York" });
  });
});

describe("mergeActivity", () => {
  it("merges company and platform rows newest first", () => {
    const items = mergeActivity(
      [
        { id: "a1", action: "DELIVERY_CREATED", actorName: "Rafi", entityType: "Delivery", createdAt: "2026-10-20T10:00:00.000Z" },
        { id: "a2", action: "DRIVER_ADDED", actorName: "Rafi", entityType: "User", createdAt: "2026-10-22T09:00:00.000Z" },
      ],
      [
        {
          id: "p1",
          actorName: "Root",
          action: "ORG_SUSPENDED",
          targetType: "Organization",
          targetId: "org1",
          organizationId: "org1",
          organizationName: "Meghna",
          detail: JSON.stringify({ reason: "x" }),
          createdAt: "2026-10-21T00:00:00.000Z",
        },
      ]
    );
    expect(items.map((i) => i.id)).toEqual(["c-a2", "p-p1", "c-a1"]);
    expect(items[1]).toMatchObject({ source: "platform", entityType: null });
  });
});
