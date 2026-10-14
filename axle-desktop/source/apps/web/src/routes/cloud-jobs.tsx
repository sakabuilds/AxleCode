import { createFileRoute, redirect } from "@tanstack/react-router";

import { CloudJobsPage } from "../components/cloud/CloudJobsPage";

export const Route = createFileRoute("/cloud-jobs")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: CloudJobsPage,
});