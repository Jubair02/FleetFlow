import type { OrgAction, OrgDeleteResult } from "@/lib/platform-types";
import { bumpPlatformData, platformApi } from "../platform-api";

export const orgUrl = (id: string) => `/api/platform/organizations/${encodeURIComponent(id)}`;
export const orgDeletePreviewUrl = (id: string) => `${orgUrl(id)}/delete-preview`;

/** PATCH an organization action, then refresh every mounted console view. Every rule is enforced server-side. */
export async function patchOrg<T = { success: boolean }>(id: string, body: OrgAction): Promise<T> {
  const res = await platformApi.patch<T>(orgUrl(id), body);
  bumpPlatformData();
  return res;
}

/** Permanently delete a SUSPENDED organization (server re-checks status and the exact name), then refresh the console. */
export async function deleteOrg(id: string, confirmName: string): Promise<OrgDeleteResult> {
  const res = await platformApi.delete<OrgDeleteResult>(orgUrl(id), { confirmName });
  bumpPlatformData();
  return res;
}
