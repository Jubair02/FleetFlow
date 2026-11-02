import { createBulkSmsBdProvider } from "@/lib/sms/bulksmsbd";
import { createConsoleSmsProvider } from "@/lib/sms/console";
import type { SmsProvider, SmsProviderName } from "@/lib/sms/provider";

// ─────────────────────────────────────────────────────────────
// SMS provider selection from the environment:
//   SMS_PROVIDER = "bulksmsbd" | "console" (default console)
//   BULKSMSBD_API_KEY, BULKSMSBD_SENDER_ID — both required for "bulksmsbd"
// "bulksmsbd" without its settings falls back to console (one warning).
// ─────────────────────────────────────────────────────────────

type Env = Record<string, string | undefined>;

export interface SmsStatus {
  provider: SmsProviderName;
  /** true only when real SMS is being sent */
  configured: boolean;
  /** set when SMS_PROVIDER=bulksmsbd was requested but could not be used */
  warning: string | null;
}

interface ResolvedConfig {
  status: SmsStatus;
  apiKey: string | null;
  senderId: string | null;
}

export function resolveSmsConfig(env: Env = process.env): ResolvedConfig {
  const requested = (env.SMS_PROVIDER ?? "").trim().toLowerCase();
  const apiKey = env.BULKSMSBD_API_KEY?.trim() || null;
  const senderId = env.BULKSMSBD_SENDER_ID?.trim() || null;

  if (requested === "bulksmsbd") {
    const missing = [!apiKey && "BULKSMSBD_API_KEY", !senderId && "BULKSMSBD_SENDER_ID"].filter(Boolean) as string[];
    if (missing.length === 0) {
      return { status: { provider: "bulksmsbd", configured: true, warning: null }, apiKey, senderId };
    }
    return {
      status: {
        provider: "console",
        configured: false,
        warning: `SMS_PROVIDER=bulksmsbd but ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing — SMS are simulated.`,
      },
      apiKey: null,
      senderId: null,
    };
  }

  const warning =
    requested && requested !== "console" ? `Unknown SMS_PROVIDER "${requested.slice(0, 20)}" — SMS are simulated.` : null;
  return { status: { provider: "console", configured: false, warning }, apiKey: null, senderId: null };
}

export function createSmsProvider(env: Env = process.env): { provider: SmsProvider; status: SmsStatus } {
  const cfg = resolveSmsConfig(env);
  const provider =
    cfg.status.provider === "bulksmsbd" && cfg.apiKey && cfg.senderId
      ? createBulkSmsBdProvider({ apiKey: cfg.apiKey, senderId: cfg.senderId })
      : createConsoleSmsProvider();
  return { provider, status: cfg.status };
}

let cached: { provider: SmsProvider; status: SmsStatus } | null = null;

/** Process-wide provider (env is read once). Logs the fallback warning a single time. */
export function getSmsProvider(): SmsProvider {
  if (!cached) {
    cached = createSmsProvider();
    if (cached.status.warning) console.warn(`[sms] ${cached.status.warning}`);
  }
  return cached.provider;
}

export function getSmsStatus(): SmsStatus {
  getSmsProvider();
  return cached!.status;
}

/** Test hook: forget the cached provider so the env is read again. */
export function resetSmsProviderForTests(): void {
  cached = null;
}

export type { SmsMessage, SmsProvider, SmsProviderName } from "@/lib/sms/provider";
export { SmsSendError } from "@/lib/sms/provider";
export { normalizeBdPhone } from "@/lib/sms/phone";
