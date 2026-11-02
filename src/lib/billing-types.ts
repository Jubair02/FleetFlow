// ─────────────────────────────────────────────────────────────
// Invoice & payment types, labels and the API contract — client-safe
// (no server imports). Server logic: src/lib/billing.ts; how to pay:
// src/lib/payments. Lifecycle: docs/BILLING.md §0.
// ─────────────────────────────────────────────────────────────

import type { BillingCycle } from "@/lib/plan-catalog";

export const INVOICE_STATUSES = ["OPEN", "PAID", "VOID"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Methods a payment can be reported / recorded with (gateways add their provider id later). */
export const PAYMENT_METHODS = ["BKASH", "NAGAD", "ROCKET", "BANK", "CASH", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Mobile-money payments always have a transaction ID (TrxID) — it's required for these. */
export const MOBILE_MONEY_METHODS: readonly PaymentMethod[] = ["BKASH", "NAGAD", "ROCKET"];

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  BKASH: "bKash",
  NAGAD: "Nagad",
  ROCKET: "Rocket",
  BANK: "Bank transfer",
  CASH: "Cash",
  OTHER: "Other",
};

export const INVOICE_STATUS_LABELS: Record<string, string> = { OPEN: "Open", PAID: "Paid", VOID: "Void" };

export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return "—";
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

/** One invoice as every invoice API returns it (dates as ISO strings). */
export interface InvoiceRow {
  id: string;
  number: string;
  organizationId: string;
  planCode: string;
  planName: string;
  billingCycle: BillingCycle;
  periodStart: string;
  periodEnd: string;
  amountBdt: number;
  status: InvoiceStatus;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentRef: string | null;
  /** Company-reported payment waiting for FleetFlow to verify (OPEN invoices only). */
  reportedAt: string | null;
  reportedMethod: string | null;
  reportedRef: string | null;
  reportedByName: string | null;
  voidReason: string | null;
  notes: string | null;
  /**
   * True when the period is provisional: it restarts on the payment date
   * (new subscription / plan change), so the dates shown are an estimate.
   */
  provisionalPeriod: boolean;
}

/** Platform console rows also carry who recorded the payment and the company name. */
export interface PlatformInvoiceRow extends InvoiceRow {
  organizationName: string;
  recordedByName: string | null;
}

/** How to pay an invoice — produced by the configured payment provider (src/lib/payments). */
export interface PaymentInstructions {
  provider: string;
  providerLabel: string;
  /** Lines such as "bKash (merchant) — 01XXXXXXXXX". Empty when nothing is configured. */
  accounts: { label: string; value: string }[];
  /** What to write as the payment reference (the invoice number). */
  reference: string;
  steps: string[];
  /** True when the provider can take the payment online (startCheckout). */
  checkout: boolean;
}

/** A plan the company can subscribe to by requesting an invoice. */
export interface UpgradeOption {
  code: string;
  name: string;
  monthlyPriceBdt: number | null;
  annualPriceBdt: number | null;
}

/** GET /api/billing/invoices (company admin). */
export interface CompanyInvoicesData {
  invoices: InvoiceRow[];
  /** The invoice to pay now (oldest OPEN one), with how to pay it. */
  openInvoice: (InvoiceRow & { instructions: PaymentInstructions }) | null;
  /** Self-service "Request invoice" is available (trial, cancelled, or the paid period has ended). */
  canRequestInvoice: boolean;
  /** Why it isn't, for the UI. */
  requestBlockedReason: string | null;
  upgradeOptions: UpgradeOption[];
  currentPlanCode: string;
}

/** GET /api/platform/invoices */
export interface PlatformInvoicesData {
  invoices: PlatformInvoiceRow[];
  total: number;
}
