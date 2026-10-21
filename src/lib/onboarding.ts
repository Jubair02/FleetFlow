import type { OnboardingData, OnboardingStep } from "@/lib/types-org";

// ─────────────────────────────────────────────────────────────
// Onboarding checklist — pure computation shared by the API and
// tests. The step order is the guided first-delivery flow.
// ─────────────────────────────────────────────────────────────

export interface OnboardingInput {
  org: {
    phone: string | null;
    address: string | null;
    defaultPickupAddress: string | null;
    onboardingDismissedAt: Date | string | null;
  };
  vehicles: number;
  drivers: number;
  deliveries: number;
  assignments: number;
  admins: number;
}

const filled = (v: string | null | undefined) => !!v && v.trim().length > 0;

export function isCompanyProfileComplete(org: OnboardingInput["org"]): boolean {
  return filled(org.phone) && filled(org.address) && filled(org.defaultPickupAddress);
}

export function computeOnboarding(input: OnboardingInput): OnboardingData {
  const steps: OnboardingStep[] = [
    {
      key: "company",
      label: "Complete your company profile",
      description: "Your phone, address and default pickup point are prefilled on every delivery you create.",
      done: isCompanyProfileComplete(input.org),
      optional: false,
    },
    {
      key: "vehicle",
      label: "Add your first vehicle",
      description: "Every delivery is dispatched on a vehicle, so you always know which van or bike carried it.",
      done: input.vehicles > 0,
      optional: false,
    },
    {
      key: "driver",
      label: "Add your first driver",
      description: "Drivers get their jobs on their phone and capture proof of delivery at the shop.",
      done: input.drivers > 0,
      optional: false,
    },
    {
      key: "delivery",
      label: "Create or import your first delivery",
      description: "Enter an order by hand or import today's orders from a CSV in one go.",
      done: input.deliveries > 0,
      optional: false,
    },
    {
      key: "assign",
      label: "Assign your first delivery",
      description: "Assigning sends the job to the driver and starts the tracking your customer can follow.",
      done: input.assignments > 0,
      optional: false,
    },
    {
      key: "team",
      label: "Invite a second dispatcher",
      description: "Optional: give a colleague their own login so dispatch keeps running when you're away.",
      done: input.admins > 1,
      optional: true,
    },
  ];
  const allDone = steps.every((s) => s.optional || s.done);
  return { steps, dismissed: input.org.onboardingDismissedAt != null, allDone };
}

/** Required steps completed, for the progress bar. */
export function onboardingProgress(data: Pick<OnboardingData, "steps">): { done: number; total: number; percent: number } {
  const required = data.steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  const total = required.length;
  return { done, total, percent: total === 0 ? 100 : Math.round((done / total) * 100) };
}
