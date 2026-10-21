// ─────────────────────────────────────────────────────────────
// Email templates. Each email is stored as plain text (subject + body)
// on its Notification row; the HTML part is rendered from that text at
// send time, so retries produce exactly the same message.
// ─────────────────────────────────────────────────────────────

export interface EmailContent {
  subject: string;
  text: string;
}

const DEFAULT_APP_URL = "http://localhost:3000";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "<Company> via FleetFlow" — the sender display name customers see. */
export function senderName(companyName: string | null | undefined): string {
  const company = companyName?.trim();
  return company ? `${company} via FleetFlow` : "FleetFlow";
}

export function appBaseUrl(appUrl: string | undefined = process.env.APP_URL): string {
  return (appUrl?.trim() || DEFAULT_APP_URL).replace(/\/+$/, "");
}

/** Public tracking page for a delivery (`/?track=<token>`). */
export function trackingUrl(token: string, appUrl?: string): string {
  return `${appBaseUrl(appUrl)}/?track=${encodeURIComponent(token)}`;
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;

/** Escape the text, then turn URLs into links. */
function linkify(escapedLine: string): string {
  return escapedLine.replace(URL_RE, (url) => `<a href="${url}" style="color:#047857">${url}</a>`);
}

/** Simple, email-client-safe HTML version of a plain-text email. */
export function renderHtml({ subject, text, companyName }: EmailContent & { companyName?: string | null }): string {
  const paragraphs = text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.split("\n").map((l) => linkify(escapeHtml(l))).join("<br>")}</p>`)
    .join("");
  return [
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>`,
    `<body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">`,
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;font-size:15px;line-height:1.5">`,
    `<p style="margin:0 0 16px;font-size:13px;color:#71717a">${escapeHtml(senderName(companyName))}</p>`,
    paragraphs,
    `<p style="margin:20px 0 0;font-size:12px;color:#a1a1aa">Sent by FleetFlow delivery notifications.</p>`,
    `</div></body></html>`,
  ].join("");
}

// ── customer emails (recipients without an account) ─────────

interface CustomerEmailInput {
  companyName: string;
  recipientName: string;
  trackingCode: string;
}

function greeting(name: string): string {
  const n = name.trim();
  return n ? `Hello ${n},` : "Hello,";
}

export function customerTrackingEmail(input: CustomerEmailInput & { trackingUrl: string }): EmailContent {
  return {
    subject: `Your delivery ${input.trackingCode} from ${input.companyName}`,
    text: [
      greeting(input.recipientName),
      `${input.companyName} has scheduled a delivery for you (reference ${input.trackingCode}).`,
      `Follow its progress here:\n${input.trackingUrl}`,
      `— ${senderName(input.companyName)}`,
    ].join("\n\n"),
  };
}

export function customerDeliveredEmail(input: CustomerEmailInput & { trackingUrl: string }): EmailContent {
  return {
    subject: `Your delivery ${input.trackingCode} was delivered`,
    text: [
      greeting(input.recipientName),
      `Your delivery ${input.trackingCode} from ${input.companyName} was delivered.`,
      `Details: ${input.trackingUrl}`,
      `— ${senderName(input.companyName)}`,
    ].join("\n\n"),
  };
}

/** Neutral wording on purpose: no internal failure reasons or driver notes reach the customer. */
export function customerFailedEmail(input: CustomerEmailInput): EmailContent {
  return {
    subject: `Delivery attempt for ${input.trackingCode} was unsuccessful`,
    text: [
      greeting(input.recipientName),
      `We tried to deliver ${input.trackingCode} from ${input.companyName}, but the attempt was unsuccessful.`,
      `${input.companyName} will contact you to arrange the next step.`,
      `— ${senderName(input.companyName)}`,
    ].join("\n\n"),
  };
}
