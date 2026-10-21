import type { EmailMessage, EmailProvider } from "@/lib/email/provider";

/**
 * Development provider: nothing is sent. Logs only the recipient and subject
 * (never the body or any credentials); the outbox marks the row SIMULATED.
 */
export function createConsoleProvider(log: (line: string) => void = console.info): EmailProvider {
  return {
    name: "console",
    simulated: true,
    async send(message: EmailMessage) {
      log(`[email:console] simulated → ${message.to} · "${message.subject}"`);
      return { id: `simulated-${message.idempotencyKey}` };
    },
  };
}
