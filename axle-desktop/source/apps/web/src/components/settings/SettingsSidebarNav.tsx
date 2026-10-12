import { useCallback, type ComponentType } from "react";
import {
  ArchiveIcon,
  ActivityIcon,
  ArrowLeftIcon,
  BoxesIcon,
  SlidersHorizontalIcon,
  BrainIcon,
  KeyboardIcon,
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
  { label: "General", to: "/settings/general", icon: Settings2Icon },
  { label: "Personalize", to: "/settings/personalize", icon: SlidersHorizontalIcon },
  { label: "Keybindings", to: "/settings/keybindings", icon: KeyboardIcon },
  { label: "Models", to: "/settings/models", icon: BoxesIcon },
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
        <SidebarGroup className="px-3 py-4">
          <p className="px-2.5 pb-3 text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
            Settings
          </p>
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
                        ? "h-9 gap-3 rounded-lg bg-sidebar-accent px-2.5 text-left text-[13px] font-medium text-foreground"
                        : "h-9 gap-3 rounded-lg px-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground"
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
                    {isActive ? (
                      <span
                        className="ml-auto size-1 shrink-0 rounded-full bg-foreground"
                        aria-hidden
                      />
                    ) : null}
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
                className="h-9 gap-3 px-2.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={handleBackClick}
              >
                <ArrowLeftIcon className="size-4" />
                <span>Back to workspace</span>
                <kbd className="ml-auto rounded border border-border px-1 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
                  Esc
                </kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarFooter>
    </>
  );
}
