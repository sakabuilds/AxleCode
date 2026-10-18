import { createFileRoute, redirect } from "@tanstack/react-router";

/** Billing moved into the Settings sidebar as its own page. */
export const Route = createFileRoute("/settings/account/billing")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/billing", search: {}, replace: true });
  },
});
