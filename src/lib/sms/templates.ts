// ─────────────────────────────────────────────────────────────
// Customer SMS bodies. Plain English, ASCII apart from the company name,
// aiming for one 160-character segment with a ~80-character tracking URL.
// Like the failure email, the failure text is neutral: no internal reasons.
// ─────────────────────────────────────────────────────────────

const MAX_COMPANY_LENGTH = 24;

export interface CustomerSmsInput {
  companyName: string;
  trackingCode: string;
  trackingUrl: string;
}

/** Single-line, length-capped company name ("FleetFlow" when blank). */
function company(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "FleetFlow";
  return clean.length > MAX_COMPANY_LENGTH ? `${clean.slice(0, MAX_COMPANY_LENGTH - 1).trimEnd()}.` : clean;
}

export function customerTrackingSms(input: CustomerSmsInput): string {
  return `${company(input.companyName)}: your delivery ${input.trackingCode} is scheduled. Track it: ${input.trackingUrl}`;
}

export function customerDeliveredSms(input: CustomerSmsInput): string {
  return `${company(input.companyName)}: your delivery ${input.trackingCode} was delivered. Details: ${input.trackingUrl}`;
}

export function customerFailedSms(input: CustomerSmsInput): string {
  return `${company(input.companyName)}: delivery ${input.trackingCode} was not completed. We will contact you. ${input.trackingUrl}`;
}
