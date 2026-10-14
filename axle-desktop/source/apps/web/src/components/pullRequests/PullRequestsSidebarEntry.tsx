import { GitPullRequestIcon } from "lucide-react";
import { useCallback } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";

export function PullRequestsSidebarEntry() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();

  const handleClick = useCallback(() => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/pull-requests" });
  }, [isMobile, navigate, setOpenMobile]);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        isActive={pathname === "/pull-requests"}
        className="h-9 gap-2 px-2.5 rounded-2xl text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid="sidebar-pull-requests-trigger"
        aria-label="Open code reviews"
        onClick={handleClick}
      >
        <GitPullRequestIcon className="size-3.5 text-muted-foreground/70" />
        <span className="flex-1 truncate text-left text-xs">Pull requests</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
