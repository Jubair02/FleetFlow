// ─────────────────────────────────────────────────────────────
// Email provider contract. Providers only transmit; the outbox
// (src/lib/email/outbox.ts) owns persistence, dedupe and retries.
// ─────────────────────────────────────────────────────────────

export type EmailProviderName = "resend" | "console";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Stable per outbox row, so a provider can drop duplicate sends of the same email. */
  idempotencyKey: string;
  /** Display name for the From header, e.g. "Acme Traders via FleetFlow". */
  fromName?: string;
}

export interface EmailProvider {
  name: EmailProviderName;
  /** true when nothing actually leaves the server (rows are marked SIMULATED). */
  simulated: boolean;
  send(message: EmailMessage): Promise<{ id: string }>;
}

/** A send that failed. `message` is short and safe to store/show (never contains secrets). */
export class EmailSendError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "EmailSendError";
    this.status = status;
  }
}
