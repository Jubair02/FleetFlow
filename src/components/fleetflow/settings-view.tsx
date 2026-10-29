"use client";

import { useEffect, useState } from "react";
import { Building2, CreditCard, Users } from "lucide-react";

import { PlanPanel } from "@/components/fleetflow/plan-panel";
import { CompanyTab, PROFILE_DETAILS } from "@/components/fleetflow/settings/company-tab";
import { SettingsHero, type SettingsNavItem } from "@/components/fleetflow/settings/hero";
import { TeamTab } from "@/components/fleetflow/settings/team-tab";
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
  const preset = useAppStore((s) => s.settingsTabPreset);
  const [tab, setTab] = useState<SettingsTab>(preset ?? "company");
  // goToSettings("plan") while Settings is already open: follow the new preset.
  const [seenPreset, setSeenPreset] = useState(preset);
  if (preset !== seenPreset) {
    setSeenPreset(preset);
    if (preset) setTab(preset);
  }

  // The preset is one-shot: consume it once this view has picked it up.
  useEffect(() => {
    if (preset) useAppStore.getState().setSettingsTabPreset(null);
  }, [preset]);

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
    </Tabs>
  );
}

export default SettingsView;
