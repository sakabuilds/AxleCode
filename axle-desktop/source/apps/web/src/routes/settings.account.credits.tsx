import { createFileRoute, redirect } from "@tanstack/react-router";

/** Credits is now a tab inside the Billing page. */
export const Route = createFileRoute("/settings/account/credits")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/billing", search: { tab: "credits" }, replace: true });
  },
});
