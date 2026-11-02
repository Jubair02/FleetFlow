import { describe, expect, it } from "vitest";
import { DICTIONARIES, langFromAcceptLanguage, LANGS, pickLang } from "@/components/fleetflow/tracking/i18n";
import { codDue, codPaid, createTrackingFormat, etaLine, eventTime, statusExplanation, updatedAgo } from "@/components/fleetflow/tracking/tracking-model";
import type { TrackingData } from "@/lib/tracking";

/** Every key path in a dictionary (nested maps included), with the value's kind. */
function shape(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? shape(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}:${typeof v}`],
  );
}

describe("tracking i18n dictionary", () => {
  it("has the same keys (and value kinds) in every language", () => {
    const en = shape(DICTIONARIES.en).sort();
    for (const lang of LANGS) expect(shape(DICTIONARIES[lang]).sort()).toEqual(en);
  });

  it("has no empty strings", () => {
    for (const lang of LANGS) {
      const walk = (o: Record<string, unknown>) => {
        for (const v of Object.values(o)) {
          if (typeof v === "string") expect(v.trim()).not.toBe("");
          else if (v && typeof v === "object") walk(v as Record<string, unknown>);
        }
      };
      walk(DICTIONARIES[lang]);
    }
  });

  it("actually translates Bangla copy", () => {
    expect(DICTIONARIES.bn.statusHeadline.IN_TRANSIT).not.toBe(DICTIONARIES.en.statusHeadline.IN_TRANSIT);
    expect(DICTIONARIES.bn.codDueTitle).toMatch(/[ঀ-৿]/);
  });
});

describe("language choice", () => {
  it("reads Accept-Language by weight", () => {
    expect(langFromAcceptLanguage("bn-BD,bn;q=0.9,en-US;q=0.8")).toBe("bn");
    expect(langFromAcceptLanguage("en-US,en;q=0.9,bn;q=0.8")).toBe("en");
    expect(langFromAcceptLanguage("en;q=0.5,bn;q=0.7")).toBe("bn");
    expect(langFromAcceptLanguage("fr-FR,de")).toBe("en");
    expect(langFromAcceptLanguage(null)).toBe("en");
  });

  it("prefers ?lang=, then the saved choice, then the browser", () => {
    expect(pickLang({ query: "bn", saved: "en", acceptLanguage: "en" })).toBe("bn");
    expect(pickLang({ query: "xx", saved: "bn", acceptLanguage: "en" })).toBe("bn");
    expect(pickLang({ acceptLanguage: "bn" })).toBe("bn");
    expect(pickLang({})).toBe("en");
  });
});

const base: TrackingData = {
  trackingCode: "FF-AB12",
  status: "IN_TRANSIT",
  recipientName: "Karim",
  deliveryAddress: "Dhaka",
  expectedAt: "2026-10-29T12:00:00.000Z", // 6:00 pm in Dhaka (UTC+6)
  createdAt: "2026-10-28T04:00:00.000Z",
  failureReason: null,
  failureReasonCode: null,
  completedAt: null,
  codAmount: 1250,
  timezone: "Asia/Dhaka",
  sender: { name: "Rahman Traders", phone: null },
  timeline: [],
  branding: null,
  feedback: {
    rating: { canRate: false, score: null, closesAt: null },
    reschedule: { canRequest: true, blockedBy: null, status: null, requestedFor: null, window: null, minDate: "2026-10-30", maxDate: "2026-11-12" },
  },
};
// 2026-10-29 10:00 in Dhaka
const NOW = Date.parse("2026-10-29T04:00:00.000Z");

describe("tracking formatting", () => {
  it("formats in the organization's timezone", () => {
    const en = createTrackingFormat("en", "Asia/Dhaka");
    expect(etaLine(base, NOW, en)).toBe("Expected today by 6:00 pm");
    // 20:00 UTC on the 28th is already the 29th in Dhaka → "today", not "yesterday".
    expect(eventTime("2026-10-28T20:00:00.000Z", NOW, en)).toBe("Today, 2:00 am");
  });

  it("uses Bengali digits and natural day periods in Bangla", () => {
    const bn = createTrackingFormat("bn", "Asia/Dhaka");
    expect(bn.money(1250)).toBe("৳১,২৫০");
    expect(etaLine(base, NOW, bn)).toBe("সম্ভাব্য ডেলিভারি আজ সন্ধ্যা ৬:০০-এর মধ্যে");
    expect(eventTime(new Date(NOW - 12 * 60_000).toISOString(), NOW, bn)).toBe("১২ মিনিট আগে");
    expect(updatedAgo(NOW - 3 * 60_000, NOW, bn)).toBe("৩ মিনিট আগে হালনাগাদ হয়েছে");
  });

  it("translates failure reasons and falls back to a generic sentence for Other", () => {
    const failed = { ...base, status: "FAILED", failureReason: "Recipient not available", failureReasonCode: "RECIPIENT_UNAVAILABLE" };
    expect(statusExplanation(failed, createTrackingFormat("bn"))).toContain("প্রাপককে পাওয়া যায়নি");
    expect(statusExplanation(failed, createTrackingFormat("en"))).toContain("Recipient not available.");
    const other = { ...failed, failureReason: "Other", failureReasonCode: "OTHER" };
    expect(statusExplanation(other, createTrackingFormat("en"))).toContain("We couldn’t complete the delivery.");
  });

  it("shows COD as due until delivered, then as paid", () => {
    expect(codDue(base)).toBe(true);
    expect(codDue({ ...base, status: "FAILED" })).toBe(true);
    expect(codDue({ ...base, status: "CANCELLED" })).toBe(false);
    expect(codDue({ ...base, codAmount: null })).toBe(false);
    expect(codPaid({ ...base, status: "DELIVERED" })).toBe(true);
    expect(codPaid(base)).toBe(false);
  });

  it("survives an invalid organization timezone", () => {
    expect(createTrackingFormat("en", "Not/AZone").timeZone).toBe("Asia/Dhaka");
  });
});
