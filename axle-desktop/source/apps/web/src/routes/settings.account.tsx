import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AccountSubNav } from "../components/account/AccountSubNav";

/**
 * Account layout. Each section is its own route so it can be linked to directly,
 * and the section switcher stays put while the page content scrolls.
 */
function AccountLayout() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <AccountSubNav />
      <Outlet />
    </div>
  );
}

export const Route = createFileRoute("/settings/account")({
  component: AccountLayout,
});
