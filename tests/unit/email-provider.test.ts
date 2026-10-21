import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmailProvider,
  getEmailProvider,
  getEmailStatus,
  resetEmailProviderForTests,
  resolveEmailConfig,
} from "@/lib/email";
import { createConsoleProvider } from "@/lib/email/console";

const KEY = "re_test_SECRET_1234567890";

describe("email provider selection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetEmailProviderForTests();
  });

  it("defaults to console when EMAIL_PROVIDER is unset", () => {
    const { status } = resolveEmailConfig({});
    expect(status).toEqual({ provider: "console", configured: false, from: null, warning: null });
    expect(createEmailProvider({}).provider.name).toBe("console");
  });

  it("selects resend when key and sender are present, exposing only the sender domain", () => {
    const env = { EMAIL_PROVIDER: "Resend", RESEND_API_KEY: KEY, EMAIL_FROM: "Acme <notify@Mail.Acme.com>" };
    const { provider, status } = createEmailProvider(env);
    expect(provider.name).toBe("resend");
    expect(provider.simulated).toBe(false);
    expect(status).toEqual({ provider: "resend", configured: true, from: "mail.acme.com", warning: null });
    expect(JSON.stringify(status)).not.toContain(KEY);
    expect(JSON.stringify(status)).not.toContain("notify@");
  });

  it("falls back to console with a warning when RESEND_API_KEY is missing", () => {
    const { provider, status } = createEmailProvider({ EMAIL_PROVIDER: "resend", EMAIL_FROM: "a@b.com" });
    expect(provider.name).toBe("console");
    expect(status.configured).toBe(false);
    expect(status.warning).toMatch(/RESEND_API_KEY/);
    expect(status.warning).not.toMatch(/EMAIL_FROM/);
  });

  it("falls back when EMAIL_FROM is missing or not an address", () => {
    for (const from of [undefined, "", "FleetFlow"]) {
      const { provider, status } = createEmailProvider({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: KEY, EMAIL_FROM: from });
      expect(provider.name).toBe("console");
      expect(status.warning).toMatch(/EMAIL_FROM/);
      expect(status.warning).not.toContain(KEY);
    }
  });

  it("warns on an unknown provider name", () => {
    expect(resolveEmailConfig({ EMAIL_PROVIDER: "smtp" }).status.warning).toMatch(/Unknown EMAIL_PROVIDER/);
  });

  it("getEmailProvider caches and warns only once", () => {
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "x@y.com");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = getEmailProvider();
    const b = getEmailProvider();
    expect(a).toBe(b);
    expect(a.name).toBe("console");
    expect(getEmailStatus().warning).toMatch(/RESEND_API_KEY/);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("console provider logs recipient and subject only", async () => {
    const lines: string[] = [];
    const p = createConsoleProvider((l) => lines.push(l));
    const r = await p.send({ to: "c@x.com", subject: "Hi", text: "secret body /?track=tok", idempotencyKey: "k1" });
    expect(r.id).toBe("simulated-k1");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("c@x.com");
    expect(lines[0]).toContain("Hi");
    expect(lines[0]).not.toContain("secret body");
    expect(lines[0]).not.toContain("tok");
  });
});
