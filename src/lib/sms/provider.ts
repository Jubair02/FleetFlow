// ─────────────────────────────────────────────────────────────
// SMS provider contract. Providers only transmit; the outbox
// (src/lib/sms/outbox.ts, sharing src/lib/email/outbox.ts) owns
// persistence, dedupe and retries.
// ─────────────────────────────────────────────────────────────

export type SmsProviderName = "bulksmsbd" | "console";

export interface SmsMessage {
  /** Canonical Bangladesh mobile number, 8801XXXXXXXXX (see normalizeBdPhone). */
  to: string;
  text: string;
  /** Stable per outbox row (for providers that support dropping duplicates). */
  idempotencyKey: string;
}

export interface SmsProvider {
  name: SmsProviderName;
  /** true when nothing actually leaves the server (rows are marked SIMULATED). */
  simulated: boolean;
  send(message: SmsMessage): Promise<{ id: string }>;
}

/** A send that failed. `message` is short and safe to store/show (never contains secrets). */
export class SmsSendError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "SmsSendError";
    this.status = status;
  }
}
