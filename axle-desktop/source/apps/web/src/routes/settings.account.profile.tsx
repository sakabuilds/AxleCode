import { createFileRoute } from "@tanstack/react-router";

import { AccountIdentityHeader, AccountPage } from "../components/account/accountShared";
import { ProfileSection } from "../components/account/ProfileSection";

function ProfileRoutePage() {
  return (
    <AccountPage
      title="Profile"
      description="How you appear in Axle. Your email and sign-in methods come from the provider you signed in with."
    >
      {(snapshot, reload) => (
        <>
          <AccountIdentityHeader snapshot={snapshot} />
          <ProfileSection profile={snapshot.user} onSaved={reload} />
        </>
      )}
    </AccountPage>
  );
}

export const Route = createFileRoute("/settings/account/profile")({
  component: ProfileRoutePage,
});
