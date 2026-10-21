import { createConsoleProvider } from "@/lib/email/console";
import type { EmailProvider, EmailProviderName } from "@/lib/email/provider";
import { createResendProvider, parseFromAddress } from "@/lib/email/resend";

// ─────────────────────────────────────────────────────────────
// Provider selection from the environment:
//   EMAIL_PROVIDER = "resend" | "console" (default console)
//   RESEND_API_KEY, EMAIL_FROM — both required for "resend"
// "resend" without its settings falls back to console (one warning).
// ─────────────────────────────────────────────────────────────

type Env = Record<string, string | undefined>;

export interface EmailStatus {
  provider: EmailProviderName;
  /** true only when real email is being sent */
  configured: boolean;
  /** sender domain only (never the full EMAIL_FROM or any key) */
  from: string | null;
  /** set when EMAIL_PROVIDER=resend was requested but could not be used */
  warning: string | null;
}

interface ResolvedConfig {
  status: EmailStatus;
  apiKey: string | null;
  from: string | null;
}

function senderDomain(from: string): string | null {
  const addr = parseFromAddress(from);
  const at = addr.lastIndexOf("@");
  return at >= 0 && at < addr.length - 1 ? addr.slice(at + 1).toLowerCase() : null;
}

export function resolveEmailConfig(env: Env = process.env): ResolvedConfig {
  const requested = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  const apiKey = env.RESEND_API_KEY?.trim() || null;
  const from = env.EMAIL_FROM?.trim() || null;
  const domain = from ? senderDomain(from) : null;

  if (requested === "resend") {
    const missing = [!apiKey && "RESEND_API_KEY", !domain && "EMAIL_FROM"].filter(Boolean) as string[];
    if (missing.length === 0) {
      return { status: { provider: "resend", configured: true, from: domain, warning: null }, apiKey, from };
    }
    return {
      status: {
        provider: "console",
        configured: false,
        from: domain,
        warning: `EMAIL_PROVIDER=resend but ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing or invalid — emails are simulated.`,
      },
      apiKey: null,
      from: null,
    };
  }

  const warning =
    requested && requested !== "console" ? `Unknown EMAIL_PROVIDER "${requested.slice(0, 20)}" — emails are simulated.` : null;
  return { status: { provider: "console", configured: false, from: domain, warning }, apiKey: null, from: null };
}

export function createEmailProvider(env: Env = process.env): { provider: EmailProvider; status: EmailStatus } {
  const cfg = resolveEmailConfig(env);
  const provider =
    cfg.status.provider === "resend" && cfg.apiKey && cfg.from
      ? createResendProvider({ apiKey: cfg.apiKey, from: cfg.from })
      : createConsoleProvider();
  return { provider, status: cfg.status };
}

let cached: { provider: EmailProvider; status: EmailStatus } | null = null;

/** Process-wide provider (env is read once). Logs the fallback warning a single time. */
export function getEmailProvider(): EmailProvider {
  if (!cached) {
    cached = createEmailProvider();
    if (cached.status.warning) console.warn(`[email] ${cached.status.warning}`);
  }
  return cached.provider;
}

export function getEmailStatus(): EmailStatus {
  getEmailProvider();
  return cached!.status;
}

/** Test hook: forget the cached provider so the env is read again. */
export function resetEmailProviderForTests(): void {
  cached = null;
}

export type { EmailMessage, EmailProvider, EmailProviderName } from "@/lib/email/provider";
export { EmailSendError } from "@/lib/email/provider";
