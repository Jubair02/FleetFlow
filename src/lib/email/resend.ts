import { EmailSendError, type EmailMessage, type EmailProvider } from "@/lib/email/provider";

// Resend HTTP API — https://resend.com/docs/api-reference/emails/send-email
export const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 200;

interface ResendOptions {
  apiKey: string;
  /** EMAIL_FROM, e.g. "FleetFlow <notifications@example.com>" or a bare address. */
  from: string;
  fetchImpl?: typeof fetch;
}

/** Address part of "Name <addr>" (or the whole string when it is a bare address). */
export function parseFromAddress(from: string): string {
  const m = from.match(/<\s*([^<>\s]+)\s*>/);
  return (m ? m[1] : from).trim();
}

/** Strip characters that could break or inject into the From header. */
function sanitizeDisplayName(name: string): string {
  return name.replace(/[\r\n"<>,;\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** From header with a per-email display name, keeping the verified sender address. */
export function buildFromHeader(from: string, fromName?: string): string {
  if (!fromName) return from;
  const name = sanitizeDisplayName(fromName);
  return name ? `${name} <${parseFromAddress(from)}>` : from;
}

export function createResendProvider({ apiKey, from, fetchImpl }: ResendOptions): EmailProvider {
  const doFetch = fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  // Error text from the provider is stored on the row and shown to admins: keep it short and key-free.
  const clean = (s: string) => s.split(apiKey).join("[redacted]").replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_LENGTH);

  return {
    name: "resend",
    simulated: false,
    async send(message: EmailMessage) {
      let res: Response;
      try {
        res = await doFetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from: buildFromHeader(from, message.fromName),
            to: [message.to],
            subject: message.subject,
            text: message.text,
            ...(message.html ? { html: message.html } : {}),
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        const reason = e instanceof Error ? (e.name === "TimeoutError" ? "request timed out" : e.message) : "request failed";
        throw new EmailSendError(clean(`Resend unreachable: ${reason}`));
      }

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        /* empty or non-JSON body */
      }

      if (!res.ok) {
        const detail = (data as { message?: unknown } | null)?.message;
        const text = typeof detail === "string" && detail ? detail : res.statusText || "request rejected";
        throw new EmailSendError(clean(`Resend ${res.status}: ${text}`), res.status);
      }

      const id = (data as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || !id) throw new EmailSendError("Resend accepted the request but returned no message id", res.status);
      return { id };
    },
  };
}
