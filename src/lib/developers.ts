// ─────────────────────────────────────────────────────────────
// Public API & webhooks — client-safe catalog and the response shapes of
// the company Developers APIs (/api/developers/**). No server imports.
// Server side: src/lib/api-keys.ts, src/lib/webhooks.ts, docs/API.md.
// ─────────────────────────────────────────────────────────────

/**
 * Events an endpoint can subscribe to. Kept deliberately small:
 * `delivery.status_changed` fires on EVERY status change (it carries the
 * previous and new status); the three outcome events are conveniences for
 * integrations that only care about the end of a delivery.
 */
export const WEBHOOK_EVENTS = {
  "delivery.created": { label: "Delivery created", description: "A delivery was created in the app, by CSV import or through the API" },
  "delivery.assigned": { label: "Driver assigned", description: "A driver and vehicle were assigned (also on re-assignment)" },
  "delivery.status_changed": {
    label: "Status changed",
    description: "Any status change — assigned, picked up, in transit, delivered, failed, cancelled, returned to pending",
  },
  "delivery.delivered": { label: "Delivered", description: "The delivery was completed with proof of delivery" },
  "delivery.failed": { label: "Delivery failed", description: "A delivery attempt failed (the reason code is included)" },
  "delivery.cancelled": { label: "Cancelled", description: "The delivery was cancelled" },
  "delivery.rated": { label: "Customer rating", description: "The recipient rated the delivery (1–5 stars) on the tracking page" },
  "delivery.reschedule_requested": {
    label: "Reschedule requested",
    description: "The recipient asked for another delivery day on the tracking page",
  },
} as const;
export type WebhookEventType = keyof typeof WEBHOOK_EVENTS;
export const WEBHOOK_EVENT_TYPES = Object.keys(WEBHOOK_EVENTS) as WebhookEventType[];

/** Sent only by "Send test event"; endpoints don't subscribe to it. */
export const PING_EVENT = "ping";

export const WEBHOOK_DELIVERY_STATUSES = ["PENDING", "SENDING", "SUCCEEDED", "FAILED"] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

export const MAX_API_KEYS = 20;
export const MAX_WEBHOOK_ENDPOINTS = 10;

// ── Company API shapes (GET /api/developers etc.) ────────────

export interface ApiKeyItem {
  id: string;
  name: string;
  /** e.g. "ff_live_Ab3x" — shown as "ff_live_Ab3x…" */
  prefix: string;
  createdByName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface WebhookEndpointItem {
  id: string;
  url: string;
  description: string | null;
  events: WebhookEventType[];
  active: boolean;
  consecutiveFailures: number;
  disabledAt: string | null;
  disabledReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** Latest delivery attempt, for the list row. */
  lastDelivery: { status: WebhookDeliveryStatus; responseStatus: number | null; at: string } | null;
}

export interface WebhookDeliveryItem {
  id: string;
  event: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: string;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
}

export interface DevelopersOverview {
  /** false = the plan lacks api_access: show the upgrade prompt. */
  apiAccess: boolean;
  planName: string;
  /** e.g. https://app.example.com/api/v1 */
  apiBaseUrl: string;
  keys: ApiKeyItem[];
  endpoints: WebhookEndpointItem[];
}

export interface CreatedApiKey {
  key: ApiKeyItem;
  /** The full key — returned once, never stored. */
  secret: string;
}

export interface WebhookTestResult {
  delivery: WebhookDeliveryItem;
}
