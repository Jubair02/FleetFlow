import { describe, expect, it } from "vitest";
import { computeOnboarding, isCompanyProfileComplete, onboardingProgress, type OnboardingInput } from "@/lib/onboarding";
import { generateTempPassword, TEMP_PASSWORD_ALPHABET, TEMP_PASSWORD_LENGTH } from "@/lib/temp-password";
import {
  changePasswordSchema,
  createStaffSchema,
  onboardingSchema,
  resetPasswordSchema,
  signupSchema,
  updateOrgSchema,
  updateStaffSchema,
} from "@/lib/validation";

const blankOrg: OnboardingInput["org"] = { phone: null, address: null, defaultPickupAddress: null, onboardingDismissedAt: null };
const fresh: OnboardingInput = { org: blankOrg, vehicles: 0, drivers: 0, deliveries: 0, assignments: 0, admins: 1 };

describe("onboarding checklist", () => {
  it("a brand-new company has every step open, in the guided order", () => {
    const r = computeOnboarding(fresh);
    expect(r.steps.map((s) => s.key)).toEqual(["company", "vehicle", "driver", "delivery", "assign", "team"]);
    expect(r.steps.every((s) => !s.done)).toBe(true);
    expect(r.allDone).toBe(false);
    expect(r.dismissed).toBe(false);
    expect(r.steps.every((s) => s.description.length > 0)).toBe(true);
  });

  it("company profile needs phone, address and default pickup (blank strings don't count)", () => {
    expect(isCompanyProfileComplete({ ...blankOrg, phone: "017", address: "Dhaka" })).toBe(false);
    expect(isCompanyProfileComplete({ ...blankOrg, phone: "017", address: "Dhaka", defaultPickupAddress: "   " })).toBe(false);
    expect(isCompanyProfileComplete({ ...blankOrg, phone: "017", address: "Dhaka", defaultPickupAddress: "Depot" })).toBe(true);
  });

  it("allDone ignores the optional second-dispatcher step", () => {
    const r = computeOnboarding({
      org: { phone: "01700000000", address: "Dhaka", defaultPickupAddress: "Depot", onboardingDismissedAt: null },
      vehicles: 1,
      drivers: 2,
      deliveries: 5,
      assignments: 1,
      admins: 1,
    });
    expect(r.steps.find((s) => s.key === "team")).toMatchObject({ done: false, optional: true });
    expect(r.allDone).toBe(true);
  });

  it("second dispatcher step completes with more than one admin", () => {
    expect(computeOnboarding({ ...fresh, admins: 2 }).steps.find((s) => s.key === "team")?.done).toBe(true);
  });

  it("reports dismissal", () => {
    expect(computeOnboarding({ ...fresh, org: { ...blankOrg, onboardingDismissedAt: new Date() } }).dismissed).toBe(true);
  });

  it("progress counts required steps only", () => {
    const r = computeOnboarding({ ...fresh, vehicles: 1, drivers: 1, admins: 3 });
    expect(onboardingProgress(r)).toEqual({ done: 2, total: 5, percent: 40 });
  });
});

describe("temporary passwords", () => {
  it("are 10 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const p = generateTempPassword();
      expect(p).toHaveLength(TEMP_PASSWORD_LENGTH);
      for (const ch of p) expect(TEMP_PASSWORD_ALPHABET).toContain(ch);
    }
    expect(TEMP_PASSWORD_ALPHABET).not.toMatch(/[0O1lI]/);
  });
  it("pass the password policy and differ each time", () => {
    const a = generateTempPassword();
    expect(resetPasswordSchema.safeParse({ password: a }).success).toBe(true);
    expect(generateTempPassword()).not.toBe(a);
  });
});

describe("account & settings validation", () => {
  const signup = { companyName: "Rahman Traders", name: "Karim Rahman", email: "Karim@Example.com ", password: "longenough", phone: "" };

  it("signup normalises email and accepts an empty phone", () => {
    const r = signupSchema.safeParse(signup);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("karim@example.com");
  });
  it("signup rejects short passwords, short phones and missing company", () => {
    expect(signupSchema.safeParse({ ...signup, password: "short" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...signup, phone: "123" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...signup, companyName: " " }).success).toBe(false);
  });

  it("password change requires ≥8 chars and a different password", () => {
    expect(changePasswordSchema.safeParse({ currentPassword: "oldpassword", newPassword: "newpassword" }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ currentPassword: "oldpassword", newPassword: "short" }).success).toBe(false);
    const same = changePasswordSchema.safeParse({ currentPassword: "samepassword", newPassword: "samepassword" });
    expect(same.success).toBe(false);
    if (!same.success) expect(same.error.issues[0].path).toEqual(["newPassword"]);
  });

  it("reset accepts no password (server generates) or one ≥8", () => {
    expect(resetPasswordSchema.safeParse({}).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ password: "1234567" }).success).toBe(false);
  });

  it("staff schemas", () => {
    expect(createStaffSchema.safeParse({ name: "Nusrat Jahan", email: "n@x.com" }).success).toBe(true);
    expect(createStaffSchema.safeParse({ name: "N", email: "n@x.com" }).success).toBe(false);
    expect(updateStaffSchema.safeParse({ action: "deactivate" }).success).toBe(true);
    expect(updateStaffSchema.safeParse({ action: "delete" }).success).toBe(false);
  });

  it("org settings: timezone must be valid, optional fields may be cleared, limits enforced", () => {
    expect(updateOrgSchema.safeParse({ timezone: "Asia/Dhaka" }).success).toBe(true);
    expect(updateOrgSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
    expect(updateOrgSchema.safeParse({ phone: "", address: "", contactEmail: "" }).success).toBe(true);
    expect(updateOrgSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(updateOrgSchema.safeParse({ phone: "12345" }).success).toBe(false);
    expect(updateOrgSchema.safeParse({ contactEmail: "not-an-email" }).success).toBe(false);
    expect(updateOrgSchema.safeParse({ defaultPickupAddress: "x".repeat(301) }).success).toBe(false);
  });

  it("onboarding toggle", () => {
    expect(onboardingSchema.safeParse({ dismissed: true }).success).toBe(true);
    expect(onboardingSchema.safeParse({ dismissed: "yes" }).success).toBe(false);
  });
});
