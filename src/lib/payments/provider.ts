import type { PaymentInstructions } from "@/lib/billing-types";

// ─────────────────────────────────────────────────────────────
// Payment provider contract. "manual" (bKash/Nagad/bank, verified by
// FleetFlow staff) is the only provider today; an online gateway
// (SSLCommerz, bKash checkout…) implements startCheckout and confirms
// payments through its own callback/webhook, then calls
// markInvoicePaid (src/lib/billing.ts) with recordedBy = null.
// ─────────────────────────────────────────────────────────────

/** The invoice fields a provider may use. */
export interface PayableInvoice {
  id: string;
  number: string;
  amountBdt: number;
  organizationId: string;
  dueAt: Date;
}

/** Where to send money — from the environment (see src/lib/payments/index.ts). */
export interface PaymentSettings {
  bkashNumber: string | null;
  nagadNumber: string | null;
  rocketNumber: string | null;
  /** Free text, may span several lines (account name, number, bank, branch, routing). */
  bankDetails: string | null;
}

export interface CheckoutSession {
  /** Where to send the browser to pay. */
  redirectUrl: string;
  /** Gateway's own id for reconciliation. */
  providerRef?: string;
}

export interface PaymentProvider {
  id: string;
  label: string;
  instructions(invoice: PayableInvoice, settings: PaymentSettings): PaymentInstructions;
  /** Online gateways only: start a hosted checkout for the invoice. */
  startCheckout?(invoice: PayableInvoice): Promise<CheckoutSession>;
}
