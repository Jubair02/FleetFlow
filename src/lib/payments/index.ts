import { manualProvider } from "@/lib/payments/manual";
import type { PaymentProvider, PaymentSettings } from "@/lib/payments/provider";

// ─────────────────────────────────────────────────────────────
// Provider selection from the environment (server only):
//   PAYMENT_PROVIDER      = "manual" (default; the only one so far)
//   PAYMENT_BKASH_NUMBER  = bKash merchant/personal number
//   PAYMENT_NAGAD_NUMBER  = Nagad number
//   PAYMENT_ROCKET_NUMBER = Rocket number (optional)
//   PAYMENT_BANK_DETAILS  = bank account details; "\n" starts a new line
// Platform settings have no stored payment details, so they live here.
// To add a gateway: implement PaymentProvider (startCheckout + a callback
// route that calls markInvoicePaid) and register it below.
// ─────────────────────────────────────────────────────────────

export type { PayableInvoice, PaymentProvider, PaymentSettings, CheckoutSession } from "@/lib/payments/provider";

type Env = Record<string, string | undefined>;

const PROVIDERS: Record<string, PaymentProvider> = {
  [manualProvider.id]: manualProvider,
};

let warned = false;

export function getPaymentProvider(env: Env = process.env): PaymentProvider {
  const requested = (env.PAYMENT_PROVIDER ?? "").trim().toLowerCase() || manualProvider.id;
  const provider = PROVIDERS[requested];
  if (provider) return provider;
  if (!warned) {
    warned = true;
    console.warn(`[payments] Unknown PAYMENT_PROVIDER "${requested}" — falling back to manual payments.`);
  }
  return manualProvider;
}

const clean = (v: string | undefined) => {
  // Env files can't hold real newlines easily: a literal "\n" starts a new line.
  const s = v?.replace(/\\n/g, "\n").trim();
  return s ? s : null;
};

export function getPaymentSettings(env: Env = process.env): PaymentSettings {
  return {
    bkashNumber: clean(env.PAYMENT_BKASH_NUMBER),
    nagadNumber: clean(env.PAYMENT_NAGAD_NUMBER),
    rocketNumber: clean(env.PAYMENT_ROCKET_NUMBER),
    bankDetails: clean(env.PAYMENT_BANK_DETAILS),
  };
}
