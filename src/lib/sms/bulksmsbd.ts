import { SmsSendError, type SmsMessage, type SmsProvider } from "@/lib/sms/provider";

// ─────────────────────────────────────────────────────────────
// BulkSMSBD HTTP API (bulksmsbd.net) — the only file that knows its format.
//
// UNVERIFIED: written from the provider's public docs as remembered, not
// tested against a live account. Expected contract:
//   POST https://bulksmsbd.net/api/smsapi  (form fields; GET with the same
//   query params also works) api_key, type=text, number, senderid, message
//   → JSON { response_code: 202, message_id, success_message, error_message }
// 202 = accepted; any other code is an error (e.g. 1001 invalid number,
// 1002 bad sender id, 1007 insufficient balance, 1032 IP not whitelisted).
// Verify with a test send before relying on it (docs/NOTIFICATIONS.md).
// ─────────────────────────────────────────────────────────────

export const BULKSMSBD_ENDPOINT = "https://bulksmsbd.net/api/smsapi";
const TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 200;
const ACCEPTED = 202;

// Known codes → readable text (the API's own error_message is preferred when present).
const ERROR_CODES: Record<number, string> = {
  1001: "invalid number",
  1002: "sender id not correct or disabled",
  1003: "required fields missing",
  1005: "provider internal error",
  1006: "balance validity not available",
  1007: "insufficient balance",
  1011: "user id not found",
  1032: "IP not whitelisted",
};

interface BulkSmsBdResponse {
  response_code?: unknown;
  message_id?: unknown;
  error_message?: unknown;
}

async function readJson(res: Response): Promise<BulkSmsBdResponse | null> {
  try {
    const data: unknown = await res.json();
    return data && typeof data === "object" ? (data as BulkSmsBdResponse) : null;
  } catch {
    return null; // empty or non-JSON body
  }
}

interface BulkSmsBdOptions {
  apiKey: string;
  senderId: string;
  fetchImpl?: typeof fetch;
}

export function createBulkSmsBdProvider({ apiKey, senderId, fetchImpl }: BulkSmsBdOptions): SmsProvider {
  const doFetch = fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  // Error text is stored on the row and shown to admins: keep it short and key-free.
  const clean = (s: string) => s.split(apiKey).join("[redacted]").replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_LENGTH);

  return {
    name: "bulksmsbd",
    simulated: false,
    async send(message: SmsMessage) {
      // Form body (not query string), so the key never ends up in URL logs.
      const body = new URLSearchParams({
        api_key: apiKey,
        type: "text",
        number: message.to,
        senderid: senderId,
        message: message.text,
      });

      let res: Response;
      try {
        res = await doFetch(BULKSMSBD_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: body.toString(),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        const reason = e instanceof Error ? (e.name === "TimeoutError" ? "request timed out" : e.message) : "request failed";
        throw new SmsSendError(clean(`BulkSMSBD unreachable: ${reason}`));
      }

      const data = await readJson(res);

      if (!res.ok) {
        throw new SmsSendError(clean(`BulkSMSBD ${res.status}: ${res.statusText || "request rejected"}`), res.status);
      }

      const code = Number(data?.response_code);
      if (code !== ACCEPTED) {
        const apiText = typeof data?.error_message === "string" ? data.error_message : "";
        const text = apiText || ERROR_CODES[code] || (data ? "request rejected" : "unexpected response");
        throw new SmsSendError(clean(`BulkSMSBD ${Number.isFinite(code) ? code : res.status}: ${text}`), res.status);
      }

      const id = data?.message_id;
      return { id: typeof id === "string" || typeof id === "number" ? String(id) : `bulksmsbd-${message.idempotencyKey}` };
    },
  };
}
