import { describe, expect, it } from "vitest";
import { FREE_PLAN, STARTER_PLAN } from "../../lib/billing/plans";
import { shouldShowHomeUsagePanel } from "../../lib/ui/homeUsage";

describe("home usage panel display", () => {
  it("hides the panel when the Free capacity banner already explains exhaustion", () => {
    expect(
      shouldShowHomeUsagePanel({
        plan: FREE_PLAN,
        capacityState: "exhausted",
      }),
    ).toBe(false);
  });

  it("keeps the panel visible for active Free usage", () => {
    expect(
      shouldShowHomeUsagePanel({
        plan: FREE_PLAN,
        capacityState: "low",
      }),
    ).toBe(true);
  });

  it("keeps the panel visible for Starter capacity states", () => {
    expect(
      shouldShowHomeUsagePanel({
        plan: STARTER_PLAN,
        capacityState: "exhausted",
      }),
    ).toBe(true);
  });
});
