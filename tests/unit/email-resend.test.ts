import { describe, expect, it, vi } from "vitest";
import { EmailSendError } from "@/lib/email/provider";
import { buildFromHeader, createResendProvider, parseFromAddress, RESEND_ENDPOINT } from "@/lib/email/resend";

const KEY = "re_live_SECRET_abcdef123456";
const FROM = "FleetFlow <notify@mail.example.com>";

function jsonResponse(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const message = {
  to: "customer@example.com",
  subject: "Your delivery FF-1 was delivered",
  text: "Hello",
  html: "<p>Hello</p>",
  idempotencyKey: "fleetflow-notification-abc",
  fromName: "Rahman Traders via FleetFlow",
};

describe("Resend provider", () => {
  it("POSTs to the Resend API with auth, idempotency key and the message body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "msg_123" }));
    const p = createResendProvider({ apiKey: KEY, from: FROM, fetchImpl: fetchMock });

    await expect(p.send(message)).resolves.toEqual({ id: "msg_123" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Idempotency-Key"]).toBe("fleetflow-notification-abc");
    expect(JSON.parse(init.body as string)).toEqual({
      from: "Rahman Traders via FleetFlow <notify@mail.example.com>",
      to: ["customer@example.com"],
      subject: message.subject,
      text: "Hello",
      html: "<p>Hello</p>",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("omits html when not provided and keeps EMAIL_FROM without a display name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "m" }));
    const p = createResendProvider({ apiKey: KEY, from: FROM, fetchImpl: fetchMock });
    await p.send({ to: "a@b.com", subject: "s", text: "t", idempotencyKey: "k" });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty("html");
    expect(body.from).toBe(FROM);
  });

  it("throws a short EmailSendError with the provider message on HTTP errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, { statusCode: 403, name: "validation_error", message: "The mail.example.com domain is not verified." }));
    const p = createResendProvider({ apiKey: KEY, from: FROM, fetchImpl: fetchMock });
    const err = await p.send(message).catch((e) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err.status).toBe(403);
    expect(err.message).toBe("Resend 403: The mail.example.com domain is not verified.");
  });

  it("never leaks the API key in error messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { message: `API key ${KEY} is invalid` }));
    const p = createResendProvider({ apiKey: KEY, from: FROM, fetchImpl: fetchMock });
    const err = await p.send(message).catch((e) => e);
    expect(err.message).not.toContain(KEY);
    expect(err.message).toContain("[redacted]");
  });

  it("handles non-JSON error bodies and long messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("x".repeat(1000), { status: 500, statusText: "Server Error" }));
    const p = createResendProvider({ apiKey: KEY, from: FROM, fetchImpl: fetchMock });
    const err = await p.send(message).catch((e) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err.message).toBe("Resend 500: Server Error");
  });

  it("maps network failures and timeouts to EmailSendError", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const p1 = createResendProvider({ apiKey: KEY, from: FROM, fetchImpl: vi.fn().mockRejectedValue(timeout) });
    await expect(p1.send(message)).rejects.toThrow("Resend unreachable: request timed out");
    const p2 = createResendProvider({ apiKey: KEY, from: FROM, fetchImpl: vi.fn().mockRejectedValue(new TypeError("fetch failed")) });
    const err = await p2.send(message).catch((e) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err.status).toBeNull();
  });

  it("treats a 2xx without an id as a failure", async () => {
    const p = createResendProvider({ apiKey: KEY, from: FROM, fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, {})) });
    await expect(p.send(message)).rejects.toBeInstanceOf(EmailSendError);
  });

  it("uses global fetch when no fetchImpl is given", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, { id: "g1" }));
    try {
      const p = createResendProvider({ apiKey: KEY, from: FROM });
      await expect(p.send(message)).resolves.toEqual({ id: "g1" });
      expect(spy).toHaveBeenCalledWith(RESEND_ENDPOINT, expect.objectContaining({ method: "POST" }));
    } finally {
      spy.mockRestore();
    }
  });
});

describe("From header helpers", () => {
  it("parses the address out of EMAIL_FROM", () => {
    expect(parseFromAddress("A <x@y.com>")).toBe("x@y.com");
    expect(parseFromAddress(" x@y.com ")).toBe("x@y.com");
  });
  it("sanitizes display names to prevent header injection", () => {
    expect(buildFromHeader("x@y.com", 'Evil"\r\nBcc: <a@b.com>, Co')).toBe("Evil Bcc: a@b.com Co <x@y.com>");
    expect(buildFromHeader(FROM, "  ")).toBe(FROM);
  });
});
