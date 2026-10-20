import { CalendarClockIcon } from "lucide-react";
import { useCallback } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";

export function CloudSchedulesSidebarEntry() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();

  const handleClick = useCallback(() => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/cloud-schedules" });
  }, [isMobile, navigate, setOpenMobile]);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        isActive={pathname === "/cloud-schedules"}
        className="h-9 gap-2 px-2.5 rounded-2xl text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid="sidebar-cloud-schedules-trigger"
        aria-label="Open cloud schedules"
        onClick={handleClick}
      >
        <CalendarClockIcon className="size-3.5 text-muted-foreground/70" />
        <span className="flex-1 truncate text-left text-xs">Cloud schedules</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
