import { createFileRoute } from "@tanstack/react-router";

import { AccountPage } from "../components/account/accountShared";
import { BillingSection } from "../components/account/BillingSection";

function BillingRoutePage() {
  return (
    <AccountPage
      title="Billing"
      description="Your plan, monthly credits, and one-time credit packs. Checkouts open in Bachs's secure hosted page."
    >
      {() => <BillingSection />}
    </AccountPage>
  );
}

export const Route = createFileRoute("/settings/account/billing")({
  component: BillingRoutePage,
});
