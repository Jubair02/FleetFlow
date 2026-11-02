import { afterEach, describe, expect, it, vi } from "vitest";

// tracking.ts imports "@/lib/db" — mock it (no DB access).
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  BRAND_PRESETS,
  brandCssVars,
  brandLogoUrl,
  brandLogoVersion,
  brandPalette,
  contrastRatio,
  normalizeHexColor,
  readableTextColor,
  resolveTrackingBranding,
} from "@/lib/branding";
import {
  RESCHEDULE_MAX_REQUESTS,
  checkRescheduleDate,
  describeReschedule,
  ratingBlock,
  ratingSchema,
  rescheduleBlock,
  rescheduleDateRange,
  rescheduleDays,
  rescheduleRequestSchema,
  rescheduleResolveSchema,
  trackingSettingsSchema,
  windowDeadline,
  windowStart,
} from "@/lib/customer-feedback";
import { driverRatings, ratingStats } from "@/lib/report-metrics";
import { serializeTracking } from "@/lib/tracking";
import { saveImageFile } from "@/lib/storage";

const DAY = 86_400_000;

describe("brand colours", () => {
  it("normalizes hex colours and rejects anything else", () => {
    expect(normalizeHexColor("#0f766e")).toBe("#0F766E");
    expect(normalizeHexColor("0F766E")).toBe("#0F766E");
    expect(normalizeHexColor("#abc")).toBe("#AABBCC");
    for (const bad of ["red", "#12345", "#GGGGGG", "", null, 123, "#0F766E; background:url(x)"]) {
      expect(normalizeHexColor(bad)).toBeNull();
    }
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(readableTextColor("#FFEB3B")).not.toBe("#FFFFFF"); // yellow → dark text
    expect(readableTextColor("#1D4ED8")).toBe("#FFFFFF");
  });

  it("keeps a dark colour and darkens a light one until white text passes 4.5:1", () => {
    const dark = brandPalette("#1D4ED8");
    expect(dark.solid).toBe("#1D4ED8");
    expect(dark.adjusted).toBe(false);

    const light = brandPalette("#FACC15");
    expect(light.adjusted).toBe(true);
    expect(light.whiteContrast).toBeLessThan(4.5);
    expect(contrastRatio(light.solid, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    // …and as text on a dark card
    expect(contrastRatio(light.inkDark, "#171717")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(brandPalette("#1E1B4B").inkDark, "#171717")).toBeGreaterThanOrEqual(4.5);
  });

  it("offers only presets that pass with white text", () => {
    for (const p of BRAND_PRESETS) expect(contrastRatio(p.value, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });

  it("emits CSS variables only for a valid colour", () => {
    expect(brandCssVars(null)).toBeUndefined();
    expect(brandCssVars("not-a-colour")).toBeUndefined();
    expect(brandCssVars("#047857")).toMatchObject({ "--brand": "#047857", "--brand-solid": "#047857" });
  });
});

describe("tracking branding", () => {
  const org = { id: "org1", brandColor: "#1D4ED8", brandLogoKey: "cloudinary:fleetflow/brand/abc.png", trackingMessage: "  Thanks!  " };

  it("applies branding only when the plan has branded_tracking", () => {
    expect(resolveTrackingBranding(org, ["csv_import"])).toBeNull();
    expect(resolveTrackingBranding(org, null)).toBeNull();
    expect(resolveTrackingBranding(org, ["branded_tracking"])).toEqual({
      color: "#1D4ED8",
      logoUrl: brandLogoUrl("org1", org.brandLogoKey),
      message: "Thanks!",
    });
  });

  it("falls back to default styling when nothing is set", () => {
    expect(resolveTrackingBranding({ id: "org1" }, ["branded_tracking"])).toBeNull();
  });

  it("versions the logo address by its storage key", () => {
    expect(brandLogoVersion("a.png")).toMatch(/^[0-9a-f]{8}$/);
    expect(brandLogoVersion("a.png")).toBe(brandLogoVersion("a.png"));
    expect(brandLogoVersion("a.png")).not.toBe(brandLogoVersion("b.png"));
    expect(brandLogoUrl("org1", "a.png")).toBe(`/api/brand/org1/logo?v=${brandLogoVersion("a.png")}`);
  });
});

describe("rating window", () => {
  const completedAt = new Date("2026-10-01T10:00:00Z");
  const base = { status: "DELIVERED", completedAt, rating: null, allowCustomerRating: true };

  it("allows one rating within 14 days of delivery", () => {
    expect(ratingBlock(base, new Date(completedAt.getTime() + DAY))).toBeNull();
    expect(ratingBlock(base, new Date(completedAt.getTime() + 14 * DAY))).toBeNull();
    expect(ratingBlock(base, new Date(completedAt.getTime() + 14 * DAY + 1))).toBe("expired");
  });

  it("refuses when not delivered, already rated or switched off", () => {
    const now = new Date(completedAt.getTime() + DAY);
    expect(ratingBlock({ ...base, status: "IN_TRANSIT", completedAt: null }, now)).toBe("not_delivered");
    expect(ratingBlock({ ...base, rating: 4 }, now)).toBe("already_rated");
    expect(ratingBlock({ ...base, allowCustomerRating: false }, now)).toBe("disabled");
  });

  it("validates the rating body", () => {
    expect(ratingSchema.safeParse({ rating: 5 }).success).toBe(true);
    expect(ratingSchema.parse({ rating: 3, comment: "  " }).comment).toBeNull();
    for (const rating of [0, 6, 2.5, "x"]) expect(ratingSchema.safeParse({ rating }).success).toBe(false);
    expect(ratingSchema.safeParse({ rating: 4, comment: "x".repeat(501) }).success).toBe(false);
  });
});

describe("reschedule rules", () => {
  const base = { status: "ASSIGNED", rescheduleStatus: null, allowCustomerReschedule: true, requestCount: 0 };

  it("allows pending, assigned and failed deliveries only", () => {
    for (const status of ["CREATED", "ASSIGNED", "FAILED"]) expect(rescheduleBlock({ ...base, status })).toBeNull();
    for (const status of ["PICKED_UP", "IN_TRANSIT", "DELIVERED", "CANCELLED"]) expect(rescheduleBlock({ ...base, status })).toBe("not_eligible");
  });

  it("allows one pending request at a time and a limited number overall", () => {
    expect(rescheduleBlock({ ...base, rescheduleStatus: "PENDING" })).toBe("pending");
    expect(rescheduleBlock({ ...base, rescheduleStatus: "DECLINED", requestCount: 1 })).toBeNull();
    expect(rescheduleBlock({ ...base, requestCount: RESCHEDULE_MAX_REQUESTS })).toBe("limit");
    expect(rescheduleBlock({ ...base, allowCustomerReschedule: false })).toBe("disabled");
  });

  it("offers tomorrow … +14 days in the company's timezone", () => {
    // 20:30 UTC on 29 Oct is already 30 Oct 02:30 in Dhaka (UTC+6).
    const now = new Date("2026-10-29T20:30:00Z");
    expect(rescheduleDateRange(now, "Asia/Dhaka")).toEqual({ min: "2026-10-31", max: "2026-11-13" });
    expect(rescheduleDateRange(now, "UTC")).toEqual({ min: "2026-10-30", max: "2026-11-12" });
    expect(rescheduleDays(now, "Asia/Dhaka")).toHaveLength(14);
  });

  it("rejects days outside the range and resolves windows to company-time instants", () => {
    const now = new Date("2026-10-29T04:00:00Z"); // 29 Oct, 10:00 in Dhaka
    expect(checkRescheduleDate("2026-10-29", "ANY", "Asia/Dhaka", now)).toEqual({ ok: false, code: "invalid_date" });
    expect(checkRescheduleDate("2026-11-13", "ANY", "Asia/Dhaka", now)).toEqual({ ok: false, code: "invalid_date" });
    expect(checkRescheduleDate("2026-02-31", "ANY", "Asia/Dhaka", now).ok).toBe(false);
    const ok = checkRescheduleDate("2026-11-02", "MORNING", "Asia/Dhaka", now);
    expect(ok).toEqual({ ok: true, requestedFor: new Date("2026-11-02T03:00:00Z") }); // 09:00 Dhaka

    expect(windowStart("2026-11-02", "ANY", "Asia/Dhaka")).toEqual(new Date("2026-11-01T18:00:00Z")); // local midnight
    expect(windowDeadline("2026-11-02", "MORNING", "Asia/Dhaka")).toEqual(new Date("2026-11-02T06:00:00Z")); // 12:00
    expect(windowDeadline("2026-11-02", "EVENING", "Asia/Dhaka")).toEqual(new Date("2026-11-02T15:00:00Z")); // 21:00
    expect(windowDeadline("2026-11-02", "ANY", "Asia/Dhaka")).toEqual(new Date("2026-11-01T18:00:00Z")); // date-only
  });

  it("describes a request for staff in the company's timezone", () => {
    expect(describeReschedule(new Date("2026-11-02T03:00:00Z"), "MORNING", "Asia/Dhaka")).toMatch(/^Mon,? 2 Nov 2026, morning \(9 am – 12 pm\)$/);
    expect(describeReschedule(new Date("2026-11-01T18:00:00Z"), "ANY", "Asia/Dhaka")).toMatch(/^Mon,? 2 Nov 2026, any time$/);
  });

  it("validates request and answer bodies", () => {
    expect(rescheduleRequestSchema.parse({ date: "2026-11-02" }).window).toBe("ANY");
    expect(rescheduleRequestSchema.safeParse({ date: "2/11/2026" }).success).toBe(false);
    expect(rescheduleRequestSchema.safeParse({ date: "2026-11-02", window: "NIGHT" }).success).toBe(false);
    expect(rescheduleRequestSchema.safeParse({ date: "2026-11-02", note: "x".repeat(301) }).success).toBe(false);
    expect(rescheduleResolveSchema.safeParse({ action: "accept", expectedAt: "2026-11-02T06:00:00.000Z" }).success).toBe(true);
    expect(rescheduleResolveSchema.safeParse({ action: "maybe" }).success).toBe(false);
    expect(rescheduleResolveSchema.safeParse({ action: "accept", expectedAt: "tomorrow" }).success).toBe(false);
  });
});

describe("tracking settings body", () => {
  it("normalizes the colour and clears with empty values", () => {
    expect(trackingSettingsSchema.parse({ brandColor: "#0f766e" }).brandColor).toBe("#0F766E");
    expect(trackingSettingsSchema.parse({ brandColor: "" }).brandColor).toBeNull();
    expect(trackingSettingsSchema.parse({ trackingMessage: "  " }).trackingMessage).toBeNull();
    expect(trackingSettingsSchema.parse({ allowCustomerRating: false })).toEqual({ allowCustomerRating: false });
  });

  it("rejects bad colours, long messages and unknown fields", () => {
    expect(trackingSettingsSchema.safeParse({ brandColor: "url(javascript:x)" }).success).toBe(false);
    expect(trackingSettingsSchema.safeParse({ trackingMessage: "x".repeat(201) }).success).toBe(false);
    expect(trackingSettingsSchema.safeParse({ brandLogoKey: "../../.env" }).success).toBe(false);
  });
});

describe("rating metrics", () => {
  it("averages, counts and distributes ratings, ignoring junk", () => {
    expect(ratingStats([5, 4, 4, null, 7, 1])).toEqual({ count: 4, average: 3.5, distribution: [1, 0, 0, 2, 1] });
    expect(ratingStats([])).toEqual({ count: 0, average: null, distribution: [0, 0, 0, 0, 0] });
  });

  it("averages per delivering driver", () => {
    const m = driverRatings([
      { driverId: "d1", rating: 5 },
      { driverId: "d1", rating: 4 },
      { driverId: "d2", rating: 2 },
      { driverId: null, rating: 1 },
    ]);
    expect(m.get("d1")).toEqual({ average: 4.5, count: 2 });
    expect(m.get("d2")).toEqual({ average: 2, count: 1 });
    expect(m.size).toBe(2);
  });
});

describe("serializeTracking: branding and feedback", () => {
  function row(over: Record<string, unknown> = {}, org: Record<string, unknown> = {}) {
    return {
      trackingCode: "FF-1",
      status: "DELIVERED",
      recipientName: "Karim",
      deliveryAddress: "Dhaka",
      expectedAt: null,
      createdAt: new Date("2026-10-20T04:00:00Z"),
      completedAt: new Date("2026-10-28T04:00:00Z"),
      failureReason: null,
      codAmount: null,
      rating: null,
      ratingComment: "secret comment",
      rescheduleStatus: null,
      rescheduleRequestedFor: null,
      rescheduleWindow: null,
      rescheduleNote: "internal",
      _count: { events: 0 },
      organization: {
        id: "org1",
        name: "Rahman Traders",
        phone: null,
        timezone: "Asia/Dhaka",
        brandColor: "#1D4ED8",
        brandLogoKey: "brand/aaaaaaaaaaaaaaaaaaaaaaaa.png",
        trackingMessage: "Hello",
        allowCustomerRating: true,
        allowCustomerReschedule: true,
        planRecord: { features: [] as string[] },
        ...org,
      },
      events: [
        { eventType: "RESCHEDULE_REQUESTED", note: "Call first", createdAt: new Date("2026-10-21T04:00:00Z") },
        { eventType: "ASSIGNED", note: "Assigned to Rafiq", createdAt: new Date("2026-10-21T05:00:00Z") },
      ],
      ...over,
    };
  }
  const now = new Date("2026-10-29T04:00:00Z");

  it("drops branding when the plan lacks branded_tracking, keeps the company name", () => {
    const d = serializeTracking(row(), now);
    expect(d.branding).toBeNull();
    expect(d.sender.name).toBe("Rahman Traders");
    const branded = serializeTracking(row({}, { planRecord: { features: ["branded_tracking"] } }), now);
    expect(branded.branding).toMatchObject({ color: "#1D4ED8", message: "Hello" });
    expect(branded.branding?.logoUrl).toMatch(/^\/api\/brand\/org1\/logo\?v=/);
  });

  it("offers a rating after delivery and shows only the score afterwards", () => {
    const d = serializeTracking(row(), now);
    expect(d.feedback.rating).toEqual({ canRate: true, score: null, closesAt: "2026-11-11T04:00:00.000Z" });
    const rated = serializeTracking(row({ rating: 4 }), now);
    expect(rated.feedback.rating).toEqual({ canRate: false, score: 4, closesAt: null });
    expect(JSON.stringify(rated)).not.toContain("secret comment");
    expect(JSON.stringify(rated)).not.toContain("internal");
    expect(serializeTracking(row({}, { allowCustomerRating: false }), now).feedback.rating.canRate).toBe(false);
  });

  it("reports the reschedule state and the selectable days", () => {
    const open = serializeTracking(row({ status: "FAILED", completedAt: null }), now);
    expect(open.feedback.reschedule).toMatchObject({ canRequest: true, status: null, minDate: "2026-10-30", maxDate: "2026-11-12" });
    const pending = serializeTracking(
      row({ status: "ASSIGNED", rescheduleStatus: "PENDING", rescheduleRequestedFor: new Date("2026-11-02T03:00:00Z"), rescheduleWindow: "MORNING" }),
      now
    );
    expect(pending.feedback.reschedule).toMatchObject({ canRequest: false, status: "PENDING", requestedFor: "2026-11-02T03:00:00.000Z", window: "MORNING" });
    const limit = serializeTracking(row({ status: "CREATED", _count: { events: 3 } }), now);
    expect(limit.feedback.reschedule).toMatchObject({ canRequest: false, blockedBy: "limit" });
  });

  it("shows the customer's own reschedule note but never internal notes", () => {
    const d = serializeTracking(row(), now);
    expect(d.timeline.map((e) => e.note)).toEqual(["Call first", null]);
  });
});

describe("brand logo storage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

  it("refuses SVG and logos over 1 MB", async () => {
    await expect(saveImageFile(Buffer.from('<svg onload="alert(1)"></svg>'), "x.svg", "brand")).rejects.toThrow(/Only PNG, JPEG or WebP/);
    await expect(saveImageFile(Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]), "big.png", "brand")).rejects.toThrow(/max 1 MB/);
  });

  it("stores logos in their own Cloudinary folder as private assets", async () => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "demo");
    vi.stubEnv("CLOUDINARY_API_KEY", "123");
    vi.stubEnv("CLOUDINARY_API_SECRET", "abcd");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ public_id: "x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const stored = await saveImageFile(PNG, "logo.png", "brand");
    expect(stored.fileKey).toMatch(/^cloudinary:fleetflow\/brand\/[a-f0-9]{24}\.png$/);
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(form.get("type")).toBe("private");
  });
});
