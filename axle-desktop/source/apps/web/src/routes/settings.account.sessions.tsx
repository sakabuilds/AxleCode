import { createFileRoute } from "@tanstack/react-router";

import { AccountPage } from "../components/account/accountShared";
import { SessionsSection } from "../components/account/SessionsSection";

function SessionsRoutePage() {
  return (
    <AccountPage
      title="Devices and sessions"
      description="Every device holding a live Axle session for this account. Revoking one signs that device out immediately and leaves the others alone."
    >
      {(snapshot, reload) => <SessionsSection sessions={snapshot.sessions} onChanged={reload} />}
    </AccountPage>
  );
}

export const Route = createFileRoute("/settings/account/sessions")({
  component: SessionsRoutePage,
});
