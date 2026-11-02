import type { PaymentProvider } from "@/lib/payments/provider";

/** Pay by bKash / Nagad / Rocket / bank transfer; the company reports it and FleetFlow verifies. */
const LABEL = "bKash, Nagad or bank transfer";

export const manualProvider: PaymentProvider = {
  id: "manual",
  label: LABEL,
  instructions(invoice, settings) {
    const accounts: { label: string; value: string }[] = [];
    if (settings.bkashNumber) accounts.push({ label: "bKash", value: settings.bkashNumber });
    if (settings.nagadNumber) accounts.push({ label: "Nagad", value: settings.nagadNumber });
    if (settings.rocketNumber) accounts.push({ label: "Rocket", value: settings.rocketNumber });
    if (settings.bankDetails) accounts.push({ label: "Bank transfer", value: settings.bankDetails });
    const amount = `৳${invoice.amountBdt.toLocaleString("en-US")}`;
    const steps = accounts.length
      ? [
          `Send ${amount} to one of the accounts below.`,
          `Write ${invoice.number} as the reference (bKash/Nagad "Reference", or the bank transfer narration).`,
          "Then tell us here with the transaction ID — FleetFlow confirms payments within 1 business day.",
        ]
      : [
          `Contact FleetFlow for payment details and pay ${amount} with ${invoice.number} as the reference.`,
          "Then tell us here with the transaction ID — FleetFlow confirms payments within 1 business day.",
        ];
    return { provider: "manual", providerLabel: LABEL, accounts, reference: invoice.number, steps, checkout: false };
  },
};
