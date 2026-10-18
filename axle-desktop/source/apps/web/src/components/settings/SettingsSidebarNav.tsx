import { useCallback, type ComponentType } from "react";
import {
  ArchiveIcon,
  ActivityIcon,
  ArrowLeftIcon,
  BoxesIcon,
  SlidersHorizontalIcon,
  BrainIcon,
  CreditCardIcon,
  KeyboardIcon,
  CircleUserRoundIcon,
  PlugZapIcon,
  Settings2Icon,
} from "lucide-react";
import { useCanGoBack, useNavigate } from "@tanstack/react-router";

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "../ui/sidebar";

export type SettingsSectionPath =
  | "/settings/account"
  | "/settings/billing"
  | "/settings/general"
  | "/settings/personalize"
  | "/settings/keybindings"
  | "/settings/models"
  | "/settings/plugins"
  | "/settings/memory"
  | "/settings/archived"
  | "/settings/diagnostics";

export const SETTINGS_NAV_ITEMS: ReadonlyArray<{
  label: string;
  to: SettingsSectionPath;
  icon: ComponentType<{ className?: string }>;
}> = [
  { label: "Account", to: "/settings/account", icon: CircleUserRoundIcon },
  { label: "Billing", to: "/settings/billing", icon: CreditCardIcon },
  { label: "General", to: "/settings/general", icon: Settings2Icon },
  { label: "Personalize", to: "/settings/personalize", icon: SlidersHorizontalIcon },
  { label: "Keybindings", to: "/settings/keybindings", icon: KeyboardIcon },
  { label: "Providers", to: "/settings/models", icon: BoxesIcon },
  { label: "Plugins", to: "/settings/plugins", icon: PlugZapIcon },
  { label: "Memory", to: "/settings/memory", icon: BrainIcon },
  { label: "Archive", to: "/settings/archived", icon: ArchiveIcon },
  { label: "Diagnostics", to: "/settings/diagnostics", icon: ActivityIcon },
];

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const { isMobile, setOpenMobile } = useSidebar();
  const handleSectionClick = useCallback(
    (to: SettingsSectionPath) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({ to, replace: true });
    },
    [isMobile, navigate, setOpenMobile],
  );
  const handleBackClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, isMobile, navigate, setOpenMobile]);

  return (
    <>
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup className="px-3 py-5">
          <p className="px-3 pb-4 text-xs font-medium text-muted-foreground">Settings</p>
          <SidebarMenu className="gap-1" aria-label="Settings sections">
            {SETTINGS_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.to;
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    size="sm"
                    isActive={isActive}
                    aria-current={isActive ? "page" : undefined}
                    className={
                      isActive
                        ? "h-10 gap-3 rounded-xl bg-sidebar-accent px-3 text-left text-sm font-medium text-foreground"
                        : "h-10 gap-3 rounded-xl px-3 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
                    }
                    onClick={() => handleSectionClick(item.to)}
                  >
                    <Icon
                      className={
                        isActive
                          ? "size-4 shrink-0 text-foreground"
                          : "size-4 shrink-0 text-muted-foreground"
                      }
                    />
                    <span className="truncate">{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="p-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
          <SidebarMenu className="min-w-0">
            <SidebarMenuItem>
              <SidebarMenuButton
                size="sm"
                className="h-10 gap-3 rounded-xl px-3 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={handleBackClick}
              >
                <ArrowLeftIcon className="size-4" />
                <span>Back to workspace</span>
                <kbd className="ml-auto text-[11px] leading-none text-muted-foreground/70">Esc</kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarFooter>
    </>
  );
}
