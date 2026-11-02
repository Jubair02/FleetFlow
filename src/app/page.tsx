import { redirect } from "next/navigation";
import { CompanyEntry } from "./_company/company-entry";

/**
 * Root entry: the shared sign-in screen and the company workspace (it opens
 * the role's home screen and rewrites the address to it, e.g. /dashboard).
 * Old public tracking links (/?track=…) are redirected to /track/<token>
 * before anything else. Screen addresses live in src/app/[...path].
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const track = Array.isArray(params.track) ? params.track[0] : params.track;
  if (track) {
    const lang = typeof params.lang === "string" ? `?lang=${encodeURIComponent(params.lang)}` : "";
    redirect(`/track/${encodeURIComponent(track)}${lang}`);
  }
  return <CompanyEntry />;
}
