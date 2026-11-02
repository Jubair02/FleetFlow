"use client";

import { Building2, Code2, CreditCard, MapPinned, Palette, Users } from "lucide-react";

import { PlanPanel } from "@/components/fleetflow/plan-panel";
import { CompanyTab, PROFILE_DETAILS } from "@/components/fleetflow/settings/company-tab";
import { DevelopersTab } from "@/components/fleetflow/settings/developers-tab";
import { SettingsHero, type SettingsNavItem } from "@/components/fleetflow/settings/hero";
import { TeamTab } from "@/components/fleetflow/settings/team-tab";
import { TrackingTab } from "@/components/fleetflow/settings/tracking-tab";
import { ZonesTab } from "@/components/fleetflow/settings/zones-tab";
import { ENTER_MOTION } from "@/components/fleetflow/driver/job-utils";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useApiData } from "@/lib/api-client";
import type { OrgSettingsResponse, StaffList } from "@/lib/types-org";
import { useAppStore, type SettingsTab } from "@/store/app-store";

function teamSummary(staff: StaffList): string {
  if (staff.limit === null) return `${staff.activeCount} active · unlimited seats`;
  const left = Math.max(0, staff.limit - staff.activeCount);
  return `${staff.activeCount} active · ${left === 0 ? "no seats left" : `${left} seat${left === 1 ? "" : "s"} left`}`;
}

export function SettingsView() {
  // The tab lives in the store so it is part of the address (/settings/<tab>);
  // goToSettings("plan") and Back/Forward switch it even while Settings is open.
  const tab = useAppStore((s) => s.settingsTab);
  const setTab = useAppStore((s) => s.setSettingsTab);

  // Fetched once here: the hero shows live summaries and the tabs render the same data.
  const org = useApiData<OrgSettingsResponse>("/api/org");
  const staff = useApiData<StaffList>("/api/staff");
  const organization = org.data?.organization;
  const planName = org.data?.planInfo?.name ?? null;

  const filled = organization ? PROFILE_DETAILS.filter((k) => !!organization[k]?.trim()).length : 0;
  const items: SettingsNavItem[] = [
    {
      value: "company",
      label: "Company",
      icon: Building2,
      summary: organization ? (filled === PROFILE_DETAILS.length ? "Profile complete" : `${filled} of ${PROFILE_DETAILS.length} details added`) : null,
    },
    { value: "team", label: "Team", icon: Users, summary: staff.data ? teamSummary(staff.data) : null },
    { value: "plan", label: "Plan & billing", icon: CreditCard, summary: planName ? `${planName} · usage & limits` : null },
    { value: "developers", label: "API & webhooks", icon: Code2, summary: "Connect your store or systems" },
    { value: "tracking", label: "Tracking page", icon: Palette, summary: "Branding, ratings & rescheduling" },
    { value: "zones", label: "Zones & charges", icon: MapPinned, summary: "Delivery areas and prices" },
  ];

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as SettingsTab)} className="gap-6">
      <SettingsHero orgName={organization?.name ?? null} since={organization?.createdAt ?? null} planName={planName} items={items} />
      <TabsContent value="company" className={ENTER_MOTION}>
        <CompanyTab org={organization} loading={org.loading} error={org.error} reload={() => void org.reload()} />
      </TabsContent>
      <TabsContent value="team" className={ENTER_MOTION}>
        <TeamTab data={staff.data} loading={staff.loading} error={staff.error} reload={() => void staff.reload()} />
      </TabsContent>
      <TabsContent value="plan" className={ENTER_MOTION}>
        <PlanPanel />
      </TabsContent>
      <TabsContent value="developers" className={ENTER_MOTION}>
        <DevelopersTab />
      </TabsContent>
      <TabsContent value="tracking" className={ENTER_MOTION}>
        <TrackingTab />
      </TabsContent>
      <TabsContent value="zones" className={ENTER_MOTION}>
        <ZonesTab />
      </TabsContent>
    </Tabs>
  );
}

export default SettingsView;
