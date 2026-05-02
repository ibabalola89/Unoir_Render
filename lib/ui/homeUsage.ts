import { FREE_PLAN } from "@lib/billing/plans";

type HomeUsagePanelInput = {
  plan: string;
  capacityState: "available" | "approaching" | "low" | "exhausted";
};

export function shouldShowHomeUsagePanel({ plan, capacityState }: HomeUsagePanelInput): boolean {
  return !(plan === FREE_PLAN && capacityState === "exhausted");
}
