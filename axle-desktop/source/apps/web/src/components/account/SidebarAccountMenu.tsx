import {
  ChevronsUpDownIcon,
  CoinsIcon,
  CreditCardIcon,
  KeyRoundIcon,
  LogInIcon,
  LogOutIcon,
  LoaderCircleIcon,
  SparklesIcon,
  UserRoundIcon,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { useAccountActions, useAccountState } from "../../account/AccountAuthProvider";
import { signOutAccount } from "../../account/accountClient";
import { useAccountSnapshot } from "../../account/useAccountSnapshot";
import { openUpgradeDialog } from "../billing/UpgradeDialog";
import { PLAN_DISPLAY, planSupportsUpgrade, planTierFromId } from "../../entitlements/planCatalog";
import { useEntitlements, resolvedEntitlements } from "../../entitlements/useEntitlements";
import { Badge } from "../ui/badge";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { AccountAvatar } from "./AccountAvatar";

const MENU_TRIGGER_CLASS =
  "flex h-11 w-full items-center gap-2.5 rounded-2xl px-2.5 text-start text-sidebar-foreground/90 transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * Account chip for the sidebar footer: shows the signed-in identity and offers
 * account settings plus sign-out. Signed-out users get a direct sign-in button.
 */
export function SidebarAccountMenu() {
  const account = useAccountState();
  const { signIn, signOut } = useAccountActions();
  const { state } = useAccountSnapshot();
  const entitlements = resolvedEntitlements(useEntitlements());
  const planTier = planTierFromId(entitlements?.planId ?? null);
  const showUpgrade = planTier === null || planSupportsUpgrade(planTier);
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const [signingOut, setSigningOut] = useState(false);

  const closeMobileSidebar = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      // Revoke server-side while the token can still be read, then clear locally.
      await signOutAccount();
    } catch {
      // A failed revoke must not trap the user in a signed-in shell.
    } finally {
      setSigningOut(false);
      signOut();
    }
  }, [signOut]);

  if (account.status === "loading") {
    return (
      <SidebarMenuItem>
        <span className="flex h-11 items-center gap-2.5 px-2.5 text-[13px] text-sidebar-foreground/50">
          <LoaderCircleIcon className="size-4 animate-spin" />
          Checking session…
        </span>
      </SidebarMenuItem>
    );
  }

  if (account.status !== "signed-in") {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          size="sm"
          className="h-10 gap-2.5 rounded-2xl px-2.5 text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-foreground"
          onClick={() => {
            closeMobileSidebar();
            signIn();
          }}
        >
          <LogInIcon className="size-4 shrink-0" />
          <span className="text-[13px]">Sign in to Axle</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  const profile = state.snapshot?.user ?? null;
  const email = profile?.email ?? account.user.primaryEmailAddress?.emailAddress ?? null;
  const label = profile?.displayName ?? email ?? "Axle account";

  return (
    <SidebarMenuItem>
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              aria-label={`Account: ${label}`}
              data-testid="sidebar-account-menu"
              className={MENU_TRIGGER_CLASS}
            />
          }
        >
          <AccountAvatar url={profile?.avatarUrl ?? null} name={label} email={email} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 truncate text-[13px] leading-4.5">{label}</span>
              {planTier !== null && planTier !== "free" ? (
                <Badge variant="secondary" size="sm">
                  {PLAN_DISPLAY[planTier].name}
                </Badge>
              ) : null}
            </span>
            {email ? (
              <span className="block truncate text-[11px] leading-4 text-sidebar-foreground/55">
                {email}
              </span>
            ) : null}
          </span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-sidebar-foreground/50" />
        </MenuTrigger>
        <MenuPopup align="start" side="top">
          <MenuItem
            onClick={() => {
              closeMobileSidebar();
              void navigate({ to: "/settings/account" });
            }}
          >
            <UserRoundIcon className="size-3.5" />
            Account settings
          </MenuItem>
          <MenuItem
            onClick={() => {
              closeMobileSidebar();
              void navigate({ to: "/settings/billing", search: {} });
            }}
          >
            <CreditCardIcon className="size-3.5" />
            Billing
          </MenuItem>
          <MenuItem
            onClick={() => {
              closeMobileSidebar();
              void navigate({ to: "/settings/billing", search: { tab: "credits" } });
            }}
          >
            <CoinsIcon className="size-3.5" />
            Credits
          </MenuItem>
          <MenuItem
            onClick={() => {
              closeMobileSidebar();
              void navigate({ to: "/settings/account/api-keys" });
            }}
          >
            <KeyRoundIcon className="size-3.5" />
            API keys
          </MenuItem>
          {showUpgrade ? (
            <MenuItem
              onClick={() => {
                closeMobileSidebar();
                openUpgradeDialog("account-menu");
              }}
            >
              <SparklesIcon className="size-3.5" />
              Upgrade plan
            </MenuItem>
          ) : null}
          <MenuSeparator />
          <MenuItem disabled={signingOut} onClick={() => void handleSignOut()}>
            {signingOut ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <LogOutIcon className="size-3.5" />
            )}
            Sign out
          </MenuItem>
        </MenuPopup>
      </Menu>
    </SidebarMenuItem>
  );
}
