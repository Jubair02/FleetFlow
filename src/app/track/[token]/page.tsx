import { cache } from "react";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { loadTracking, type TrackingLookup } from "@/lib/tracking";
import { TrackingView, type TrackingInitialState } from "@/components/fleetflow/tracking-view";
import { DICTIONARIES, LANG_COOKIE, pickLang, type Lang } from "@/components/fleetflow/tracking/i18n";

/**
 * /track/[token] — public customer tracking page (linked from emails / SMS).
 *
 * Server-rendered from the same customer-safe data as GET /api/track/[token]
 * (src/lib/tracking.ts), so the first paint already shows the delivery; the
 * client then polls the API. Deliberately imports only the tracking UI — never
 * the company workspace — so customers download a small bundle.
 * Never indexed: the page shows the recipient's name and address.
 */

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type Loaded = { lookup: TrackingLookup | { kind: "error" }; loadedAt: number };

/** One DB lookup per request, shared by generateMetadata and the page. */
const load = cache(async (token: string): Promise<Loaded> => {
  try {
    return { lookup: await loadTracking(token), loadedAt: Date.now() };
  } catch (e) {
    console.error("[track page] error:", e);
    return { lookup: { kind: "error" }, loadedAt: Date.now() };
  }
});

async function resolveLang(searchParams: Props["searchParams"]): Promise<{ lang: Lang; fromUrl: boolean }> {
  const [sp, h, c] = await Promise.all([searchParams, headers(), cookies()]);
  const query = typeof sp.lang === "string" ? sp.lang : undefined;
  const lang = pickLang({ query, saved: c.get(LANG_COOKIE)?.value, acceptLanguage: h.get("accept-language") });
  return { lang, fromUrl: query === lang };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ token }, { lang }] = await Promise.all([params, resolveLang(searchParams)]);
  const { lookup } = await load(token);
  const t = DICTIONARIES[lang];
  return {
    // Tracking code + sender only — never the recipient's name or address.
    title: lookup.kind === "ok" ? t.metaTitle(lookup.data.trackingCode, lookup.data.sender.name) : t.metaTitleGeneric,
    description: null,
    keywords: null,
    robots: { index: false, follow: false },
    // Origin only (never the token in the path) — map tiles need a referrer.
    referrer: "strict-origin",
  };
}

export default async function TrackPage({ params, searchParams }: Props) {
  const [{ token }, { lang, fromUrl }] = await Promise.all([params, resolveLang(searchParams)]);
  const { lookup, loadedAt } = await load(token);

  const initial: TrackingInitialState =
    lookup.kind === "ok"
      ? { phase: "ready", data: lookup.data }
      : lookup.kind === "revoked"
        ? { phase: "revoked" }
        : lookup.kind === "not_found"
          ? { phase: "invalid" }
          : { phase: "error" };

  // key: a different token gets a fresh state / polling cycle.
  return <TrackingView key={token} token={token} initial={initial} initialNow={loadedAt} initialLang={lang} langFromUrl={fromUrl} />;
}
