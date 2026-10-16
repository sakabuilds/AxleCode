import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { isElectron } from "../env";
import { getLocalStorageItem } from "../hooks/useLocalStorage";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { isMacPlatform } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import { DesktopUpdateBanner } from "./DesktopUpdateBanner";
import {
  resolveSidebarEdgePointerAction,
  resolveSidebarEdgePress,
  SIDEBAR_EDGE_REVEAL_CLOSE_DELAY_MS,
} from "./AppSidebarLayout.logic";
import ThreadSidebar from "./Sidebar";
import {
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_MIN_WIDTH,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "./threadSidebarWidth";
import { Sidebar, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar } from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const MACOS_TRAFFIC_LIGHTS_LEFT_INSET = "90px";

/**
 * The open sidebar slides in from the left edge and slides back off-screen when
 * collapsed, so its measured width is also the x range the open sidebar covers.
 */
function resolveOpenSidebarFootprint(): number {
  const container = document.querySelector<HTMLElement>("[data-slot='sidebar-container']");
  return container?.getBoundingClientRect().width ?? 0;
}

function isInsideSidebarChrome(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    (target.closest("[data-slot='sidebar-container']") !== null ||
      target.closest("[data-sidebar-control]") !== null)
  );
}

function readInitialThreadSidebarWidth(): number {
  try {
    return resolveInitialThreadSidebarWidth(
      getLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, Schema.Finite),
      window.innerWidth,
    );
  } catch (error) {
    console.error("Could not read persisted thread sidebar width.", error);
    return resolveInitialThreadSidebarWidth(null, window.innerWidth);
  }
}

function SidebarControl() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { toggleSidebar } = useSidebar();
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      if (resolveShortcutCommand(event, keybindings) !== "sidebar.toggle") return;

      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, toggleSidebar]);

  return (
    <div
      className="pointer-events-none fixed left-[var(--workspace-controls-left)] top-[var(--workspace-controls-top)] z-[100] flex h-[var(--workspace-topbar-height)] items-center"
      data-sidebar-control=""
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarTrigger
              className="pointer-events-auto rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Toggle main sidebar"
            />
          }
        />
        <TooltipPopup side="bottom">
          Toggle main sidebar{shortcutLabel ? ` (${shortcutLabel})` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

/**
 * Reveals the collapsed off-canvas sidebar when the pointer reaches the left
 * window edge, and hides it again once the pointer leaves both the edge and the
 * sidebar. Pointer events are tracked from the window instead of an overlay, so
 * nothing covers the app content or the native scrollbar at that edge.
 */
function SidebarEdgeReveal() {
  const { isMobile, open, setOpen } = useSidebar();
  const revealedByHoverRef = useRef(false);

  useEffect(() => {
    if (isMobile) return;

    let closeTimer: number | null = null;

    const clearCloseTimer = () => {
      if (closeTimer === null) return;
      window.clearTimeout(closeTimer);
      closeTimer = null;
    };

    const scheduleClose = () => {
      if (closeTimer !== null) return;
      closeTimer = window.setTimeout(() => {
        closeTimer = null;
        revealedByHoverRef.current = false;
        setOpen(false);
      }, SIDEBAR_EDGE_REVEAL_CLOSE_DELAY_MS);
    };

    const reveal = () => {
      revealedByHoverRef.current = true;
      setOpen(true);
    };

    const onPointerMove = (event: PointerEvent) => {
      const action = resolveSidebarEdgePointerAction({
        clientX: event.clientX,
        open,
        revealedByHover: revealedByHoverRef.current,
        sidebarWidth: resolveOpenSidebarFootprint(),
      });
      if (action === "reveal") {
        reveal();
      } else if (action === "hold") {
        clearCloseTimer();
      } else if (action === "schedule-close") {
        scheduleClose();
      }
    };

    // A press on the collapsed edge is the sidebar's "open" handle: the rail
    // cannot serve as one while it keeps pointer events disabled. Pressing the
    // sidebar or its toggle keeps a hover reveal on screen instead.
    const onPointerDown = (event: PointerEvent) => {
      const action = resolveSidebarEdgePress({
        button: event.button,
        clientX: event.clientX,
        insideSidebarChrome: isInsideSidebarChrome(event.target),
        open,
        revealedByHover: revealedByHoverRef.current,
      });
      if (action === "ignore") {
        return;
      }
      revealedByHoverRef.current = false;
      if (action === "open") {
        setOpen(true);
      }
    };

    // Leaving the window also means leaving the sidebar.
    const onPointerLeaveWindow = () => {
      if (open && revealedByHoverRef.current) {
        scheduleClose();
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, true);
    document.documentElement.addEventListener("pointerleave", onPointerLeaveWindow);
    return () => {
      clearCloseTimer();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown, true);
      document.documentElement.removeEventListener("pointerleave", onPointerLeaveWindow);
    };
  }, [isMobile, open, setOpen]);

  // A closed sidebar is no longer a hover reveal, so the next edge hover starts
  // a fresh one.
  useEffect(() => {
    if (!open) {
      revealedByHoverRef.current = false;
    }
  }, [open]);

  return null;
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const isMacosDesktop = isElectron && isMacPlatform(navigator.platform);
  const [sidebarWidth, setSidebarWidth] = useState(readInitialThreadSidebarWidth);
  const sidebarMaximumWidth = resolveThreadSidebarMaximumWidth(window.innerWidth);
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(() => {
    const getWindowFullscreenState = window.desktopBridge?.getWindowFullscreenState;
    return isMacosDesktop && typeof getWindowFullscreenState === "function"
      ? getWindowFullscreenState()
      : false;
  });
  const sidebarProviderStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
    ...(isMacosDesktop && !isWindowFullscreen
      ? { "--workspace-controls-left": MACOS_TRAFFIC_LIGHTS_LEFT_INSET }
      : {}),
  } as CSSProperties;

  useEffect(() => {
    if (!isMacosDesktop) return;
    const bridge = window.desktopBridge;
    if (!bridge) return;
    const { getWindowFullscreenState, onWindowFullscreenStateChange } = bridge;
    if (
      typeof getWindowFullscreenState !== "function" ||
      typeof onWindowFullscreenStateChange !== "function"
    ) {
      return;
    }

    const unsubscribe = onWindowFullscreenStateChange(setIsWindowFullscreen);
    setIsWindowFullscreen(getWindowFullscreenState());
    return unsubscribe;
  }, [isMacosDesktop]);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        const isSettingsRoute = /^\/settings(\/|$)/.test(pathname);
        if (!isSettingsRoute) {
          void navigate({ to: "/settings" });
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate, pathname]);

  return (
    <SidebarProvider className="h-dvh! min-h-0!" defaultOpen style={sidebarProviderStyle}>
      <Sidebar
        side="left"
        variant="sidebar"
        collapsible="offcanvas"
        className="border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
        resizable={{
          maxWidth: sidebarMaximumWidth,
          minWidth: THREAD_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: ({ currentWidth, nextWidth, wrapper }) =>
            nextWidth <= currentWidth ||
            wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
          storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
          onResize: setSidebarWidth,
        }}
      >
        <ThreadSidebar />
        <SidebarRail />
      </Sidebar>
      <SidebarControl />
      <SidebarEdgeReveal />
      {children}
      <DesktopUpdateBanner />
    </SidebarProvider>
  );
}
