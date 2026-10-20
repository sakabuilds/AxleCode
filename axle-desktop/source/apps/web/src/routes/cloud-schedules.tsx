import { createFileRoute, redirect } from "@tanstack/react-router";

import { CloudSchedulesPage } from "../components/cloud/CloudSchedulesPage";

export const Route = createFileRoute("/cloud-schedules")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: CloudSchedulesPage,
});
