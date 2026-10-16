import { createFileRoute } from "@tanstack/react-router";

import { AccountPage } from "../components/account/accountShared";
import { ApiKeysSection } from "../components/account/ApiKeysSection";

function ApiKeysRoutePage() {
  return (
    <AccountPage
      title="API keys"
      description="Keys authenticate the Axle hosted provider, so any OpenAI-compatible client can reach the Axle models with no vendor account of its own."
    >
      {() => <ApiKeysSection />}
    </AccountPage>
  );
}

export const Route = createFileRoute("/settings/account/api-keys")({
  component: ApiKeysRoutePage,
});
