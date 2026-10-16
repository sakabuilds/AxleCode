import { createFileRoute } from "@tanstack/react-router";

import { AccountPage } from "../components/account/accountShared";
import { ConnectedAccountsSection } from "../components/account/ConnectedAccountsSection";

function ConnectionsRoutePage() {
  return (
    <AccountPage
      title="Sign-in methods"
      description="Connect every provider you want to sign in with. Axle links a provider to this account by verified email, so all of them reach the same profile, keys, and credits."
    >
      {(snapshot, reload) => (
        <ConnectedAccountsSection
          identities={snapshot.identities}
          availableProviders={snapshot.signInProviders}
          onChanged={reload}
        />
      )}
    </AccountPage>
  );
}

export const Route = createFileRoute("/settings/account/connections")({
  component: ConnectionsRoutePage,
});
