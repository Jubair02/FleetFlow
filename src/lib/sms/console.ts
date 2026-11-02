import { maskPhone } from "@/lib/sms/phone";
import type { SmsMessage, SmsProvider } from "@/lib/sms/provider";

/**
 * Development provider: nothing is sent. Logs only the masked number and
 * the message length (never the text or any credentials); the outbox
 * marks the row SIMULATED.
 */
export function createConsoleSmsProvider(log: (line: string) => void = console.info): SmsProvider {
  return {
    name: "console",
    simulated: true,
    async send(message: SmsMessage) {
      log(`[sms:console] simulated → ${maskPhone(message.to)} · ${message.text.length} chars`);
      return { id: `simulated-${message.idempotencyKey}` };
    },
  };
}
