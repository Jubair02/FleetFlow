import { describe, expect, it, vi } from "vitest";
import { createBulkSmsBdProvider, BULKSMSBD_ENDPOINT } from "@/lib/sms/bulksmsbd";
import { createConsoleSmsProvider } from "@/lib/sms/console";
import { createSmsProvider, resolveSmsConfig } from "@/lib/sms";
import { SmsSendError } from "@/lib/sms/provider";
import { customerDeliveredSms, customerFailedSms, customerTrackingSms } from "@/lib/sms/templates";

const msg = { to: "8801712345678", text: "Rahman Traders: your delivery FF-1 is scheduled.", idempotencyKey: "fleetflow-notification-n1" };
const KEY = "bsk_SECRET_KEY_123456";

describe("console SMS provider", () => {
  it("is simulated, logs only the masked number and length, returns a stable id", async () => {
    const log = vi.fn();
    const p = createConsoleSmsProvider(log);
    expect(p).toMatchObject({ name: "console", simulated: true });
    await expect(p.send(msg)).resolves.toEqual({ id: "simulated-fleetflow-notification-n1" });
    const line = log.mock.calls[0][0] as string;
    expect(line).toContain("8801••••••678");
    expect(line).not.toContain("8801712345678");
    expect(line).not.toContain("Rahman");
  });
});

describe("resolveSmsConfig", () => {
  it("defaults to console without a warning", () => {
    expect(resolveSmsConfig({}).status).toEqual({ provider: "console", configured: false, warning: null });
  });

  it("uses bulksmsbd only with key and sender id", () => {
    const ok = resolveSmsConfig({ SMS_PROVIDER: "BulkSMSBD", BULKSMSBD_API_KEY: KEY, BULKSMSBD_SENDER_ID: "8809617000000" });
    expect(ok.status).toEqual({ provider: "bulksmsbd", configured: true, warning: null });
    const missing = resolveSmsConfig({ SMS_PROVIDER: "bulksmsbd", BULKSMSBD_API_KEY: KEY });
    expect(missing.status.provider).toBe("console");
    expect(missing.status.warning).toContain("BULKSMSBD_SENDER_ID");
    expect(missing.status.warning).not.toContain(KEY);
    expect(createSmsProvider({ SMS_PROVIDER: "bulksmsbd" }).provider.name).toBe("console");
  });

  it("warns on an unknown provider", () => {
    expect(resolveSmsConfig({ SMS_PROVIDER: "twilio" }).status.warning).toContain("Unknown SMS_PROVIDER");
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("BulkSMSBD provider (request format unverified against a live account)", () => {
  it("POSTs form fields with a timeout and returns the message id on 202", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ response_code: 202, message_id: 98765, success_message: "SMS Submitted Successfully" }));
    const p = createBulkSmsBdProvider({ apiKey: KEY, senderId: "8809617000000", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(p.send(msg)).resolves.toEqual({ id: "98765" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(BULKSMSBD_ENDPOINT);
    expect(url).not.toContain(KEY);
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const form = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(form)).toEqual({
      api_key: KEY,
      type: "text",
      number: "8801712345678",
      senderid: "8809617000000",
      message: msg.text,
    });
  });

  it("turns a non-202 response code into a short, key-free SmsSendError", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ response_code: 1007, error_message: `Balance insufficient for ${KEY}` }));
    const p = createBulkSmsBdProvider({ apiKey: KEY, senderId: "S", fetchImpl: fetchImpl as unknown as typeof fetch });
    const err = await p.send(msg).catch((e) => e);
    expect(err).toBeInstanceOf(SmsSendError);
    expect(err.message).toBe("BulkSMSBD 1007: Balance insufficient for [redacted]");
  });

  it("falls back to the known code text when there is no error message", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ response_code: 1002 }));
    const p = createBulkSmsBdProvider({ apiKey: KEY, senderId: "S", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(p.send(msg)).rejects.toThrow("BulkSMSBD 1002: sender id not correct or disabled");
  });

  it("reports HTTP errors and network failures without leaking the key", async () => {
    const http = createBulkSmsBdProvider({
      apiKey: KEY,
      senderId: "S",
      fetchImpl: (async () => new Response("oops", { status: 500, statusText: "Server Error" })) as unknown as typeof fetch,
    });
    await expect(http.send(msg)).rejects.toThrow("BulkSMSBD 500: Server Error");

    const down = createBulkSmsBdProvider({
      apiKey: KEY,
      senderId: "S",
      fetchImpl: (async () => {
        throw new Error(`connect ECONNREFUSED api_key=${KEY}`);
      }) as unknown as typeof fetch,
    });
    const err = await down.send(msg).catch((e) => e);
    expect(err.message).toContain("BulkSMSBD unreachable");
    expect(err.message).not.toContain(KEY);
  });
});

describe("customer SMS templates", () => {
  const url = `https://app.example.com/track/${"a".repeat(48)}`;
  const input = { companyName: "Rahman Traders", trackingCode: "FF-261029-ABCD", trackingUrl: url };

  it("include company, code and link, and fit one 160-character segment", () => {
    for (const text of [customerTrackingSms(input), customerDeliveredSms(input), customerFailedSms(input)]) {
      expect(text).toContain("Rahman Traders");
      expect(text).toContain("FF-261029-ABCD");
      expect(text).toContain(url);
      expect(text.length).toBeLessThanOrEqual(160);
      expect(text).toMatch(/^[\x20-\x7e]+$/); // plain ASCII
    }
  });

  it("shortens long company names and flattens line breaks", () => {
    const text = customerTrackingSms({ ...input, companyName: "A Very Long Company Name\nThat Goes On Limited" });
    expect(text.startsWith("A Very Long Company Nam.:")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(160);
    expect(customerTrackingSms({ ...input, companyName: "  " }).startsWith("FleetFlow:")).toBe(true);
  });
});
