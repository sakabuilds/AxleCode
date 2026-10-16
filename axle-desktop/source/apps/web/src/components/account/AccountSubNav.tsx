/**
 * Section switcher for the account area. Sits above the scrolling page content
 * so the account pages keep the settings shell's header and backdrop.
 */

import { Link } from "@tanstack/react-router";
import {
  CircleUserRoundIcon,
  CoinsIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  Link2Icon,
  MonitorSmartphoneIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import { cn } from "../../lib/utils";

export type AccountSectionPath =
  | "/settings/account"
  | "/settings/account/profile"
  | "/settings/account/connections"
  | "/settings/account/sessions"
  | "/settings/account/credits"
  | "/settings/account/api-keys";

const ACCOUNT_SECTIONS: ReadonlyArray<{
  label: string;
  to: AccountSectionPath;
  icon: ComponentType<{ className?: string }>;
}> = [
  { label: "Overview", to: "/settings/account", icon: LayoutDashboardIcon },
  { label: "Profile", to: "/settings/account/profile", icon: CircleUserRoundIcon },
  { label: "Connections", to: "/settings/account/connections", icon: Link2Icon },
  { label: "Sessions", to: "/settings/account/sessions", icon: MonitorSmartphoneIcon },
  { label: "Credits", to: "/settings/account/credits", icon: CoinsIcon },
  { label: "API keys", to: "/settings/account/api-keys", icon: KeyRoundIcon },
];

export function AccountSubNav() {
  return (
    <nav aria-label="Account sections" className="shrink-0 border-b border-border/60 px-5 sm:px-10">
      <ul className="scrollbar-gutter-both flex gap-1 overflow-x-auto py-2">
        {ACCOUNT_SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <li key={section.to}>
              <Link
                to={section.to}
                replace
                activeOptions={{ exact: section.to === "/settings/account" }}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors",
                  "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                )}
                activeProps={{
                  className:
                    "bg-accent text-foreground font-medium hover:bg-accent hover:text-foreground",
                }}
              >
                <Icon className="size-3.5" />
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
