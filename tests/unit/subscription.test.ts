import { describe, expect, it } from "vitest";
import { GRACE_DAYS, TRIAL_DAYS, readOnlyMessage, subscriptionAccess, trialEndFrom } from "@/lib/subscription";
import { allowedViews } from "@/store/app-store";
import { isStaffRole } from "@/lib/roles";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-29T10:00:00.000Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

describe("subscriptionAccess", () => {
  it("a fresh trial is OK until three days before it ends", () => {
    expect(subscriptionAccess({ subscriptionStatus: "TRIAL", trialEndsAt: at(10), paidUntil: null }, NOW)).toMatchObject({ state: "OK", kind: "TRIAL" });
  });

  it("warns in the last three days with the days left", () => {
    expect(subscriptionAccess({ subscriptionStatus: "TRIAL", trialEndsAt: at(2.5), paidUntil: null }, NOW)).toMatchObject({ state: "ENDING_SOON", daysLeft: 3 });
  });

  it(`gives ${GRACE_DAYS} days of grace after the end, then read-only`, () => {
    const grace = subscriptionAccess({ subscriptionStatus: "TRIAL", trialEndsAt: at(-1), paidUntil: null }, NOW);
    expect(grace).toMatchObject({ state: "GRACE", daysLeft: GRACE_DAYS - 1 });
    expect(grace.readOnlyAt).toBe(at(GRACE_DAYS - 1).toISOString());
    expect(subscriptionAccess({ subscriptionStatus: "TRIAL", trialEndsAt: at(-GRACE_DAYS), paidUntil: null }, NOW).state).toBe("READ_ONLY");
  });

  it("paid subscriptions follow paidUntil; no date means no end", () => {
    expect(subscriptionAccess({ subscriptionStatus: "ACTIVE", trialEndsAt: at(-30), paidUntil: at(20) }, NOW).state).toBe("OK");
    expect(subscriptionAccess({ subscriptionStatus: "ACTIVE", trialEndsAt: null, paidUntil: null }, NOW)).toMatchObject({ state: "OK", endsAt: null });
    expect(subscriptionAccess({ subscriptionStatus: "ACTIVE", trialEndsAt: null, paidUntil: at(-10) }, NOW)).toMatchObject({ state: "READ_ONLY", kind: "PAID" });
  });

  it("past due or cancelled without a paid-until date is treated as ended now (grace)", () => {
    expect(subscriptionAccess({ subscriptionStatus: "PAST_DUE", trialEndsAt: null, paidUntil: null }, NOW).state).toBe("GRACE");
    expect(subscriptionAccess({ subscriptionStatus: "CANCELLED", trialEndsAt: null, paidUntil: null }, NOW).state).toBe("GRACE");
  });

  it("a trial with no end date never locks (legacy rows)", () => {
    expect(subscriptionAccess({ subscriptionStatus: "TRIAL", trialEndsAt: null, paidUntil: null }, NOW).state).toBe("OK");
  });

  it("accepts ISO strings as well as dates", () => {
    expect(subscriptionAccess({ subscriptionStatus: "TRIAL", trialEndsAt: at(-30).toISOString(), paidUntil: null }, NOW).state).toBe("READ_ONLY");
  });

  it(`trials last ${TRIAL_DAYS} days`, () => {
    expect(trialEndFrom(NOW).getTime() - NOW.getTime()).toBe(TRIAL_DAYS * DAY);
  });

  it("explains read-only differently for trials and paid plans", () => {
    expect(readOnlyMessage(subscriptionAccess({ subscriptionStatus: "TRIAL", trialEndsAt: at(-30), paidUntil: null }, NOW))).toMatch(/trial has ended/);
    expect(readOnlyMessage(subscriptionAccess({ subscriptionStatus: "ACTIVE", trialEndsAt: null, paidUntil: at(-30) }, NOW))).toMatch(/subscription has lapsed/);
  });
});

describe("roles", () => {
  it("dispatchers get operations views, not settings or audit", () => {
    const views = allowedViews("DISPATCHER");
    expect(views).toEqual(expect.arrayContaining(["dashboard", "deliveries", "dispatch", "drivers", "vehicles", "reports", "cod"]));
    expect(views).not.toContain("settings");
    expect(views).not.toContain("audit");
    expect(allowedViews("ADMIN")).toEqual(expect.arrayContaining(["settings", "audit", "cod"]));
    expect(allowedViews("DRIVER")).not.toContain("cod");
  });

  it("staff = admins and dispatchers", () => {
    expect(isStaffRole("ADMIN")).toBe(true);
    expect(isStaffRole("DISPATCHER")).toBe(true);
    expect(isStaffRole("DRIVER")).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });
});
