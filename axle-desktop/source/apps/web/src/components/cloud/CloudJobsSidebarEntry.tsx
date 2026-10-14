import { CloudIcon } from "lucide-react";
import { useCallback } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";

export function CloudJobsSidebarEntry() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();

  const handleClick = useCallback(() => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/cloud-jobs" });
  }, [isMobile, navigate, setOpenMobile]);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        isActive={pathname === "/cloud-jobs"}
        className="h-9 gap-2 px-2.5 rounded-2xl text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid="sidebar-cloud-jobs-trigger"
        aria-label="Open cloud jobs"
        onClick={handleClick}
      >
        <CloudIcon className="size-3.5 text-muted-foreground/70" />
        <span className="flex-1 truncate text-left text-xs">Cloud jobs</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}