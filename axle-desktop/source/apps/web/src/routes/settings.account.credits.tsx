import { createFileRoute } from "@tanstack/react-router";

import { AccountPage } from "../components/account/accountShared";
import { CreditsSection } from "../components/account/CreditsSection";

function CreditsRoutePage() {
  return (
    <AccountPage
      title="Credits"
      description="Axle credits are what the hosted provider spends. Every account gets a free daily grant, and models are priced by tier so you choose how fast to spend it."
    >
      {() => <CreditsSection />}
    </AccountPage>
  );
}

export const Route = createFileRoute("/settings/account/credits")({
  component: CreditsRoutePage,
});
