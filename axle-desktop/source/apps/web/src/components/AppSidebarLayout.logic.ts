/**
 * The collapsed off-canvas sidebar leaves nothing clickable at the window edge:
 * its rail deliberately disables pointer events so it cannot cover the native
 * scrollbar. These helpers drive a zero-footprint hot zone from window pointer
 * events instead, so the edge still opens the sidebar without any element
 * overlapping the app content.
 */
export const SIDEBAR_EDGE_REVEAL_ZONE_WIDTH = 8;
export const SIDEBAR_EDGE_REVEAL_CLOSE_DELAY_MS = 260;

export type SidebarEdgePointerAction = "ignore" | "reveal" | "hold" | "schedule-close";
export type SidebarEdgePressAction = "ignore" | "open" | "pin";

export function resolveSidebarEdgePointerAction(input: {
  clientX: number;
  open: boolean;
  /** True while the sidebar is only on screen because the pointer revealed it. */
  revealedByHover: boolean;
  /** Width the sidebar occupies while open, read before the slide animation. */
  sidebarWidth: number;
}): SidebarEdgePointerAction {
  if (input.clientX <= SIDEBAR_EDGE_REVEAL_ZONE_WIDTH) {
    if (!input.open) {
      return "reveal";
    }
    return input.revealedByHover ? "hold" : "ignore";
  }

  // Only a hover reveal auto-hides; a sidebar the user opened stays put.
  if (!input.open || !input.revealedByHover) {
    return "ignore";
  }

  return input.clientX <= input.sidebarWidth ? "hold" : "schedule-close";
}

/**
 * Pressing the collapsed edge is the sidebar's "open" handle. Pressing anything
 * belonging to the sidebar, or the toggle button, keeps a hover reveal on
 * screen instead of letting it slide away with the pointer.
 */
export function resolveSidebarEdgePress(input: {
  button: number;
  clientX: number;
  insideSidebarChrome: boolean;
  open: boolean;
  revealedByHover: boolean;
}): SidebarEdgePressAction {
  if (input.button !== 0) {
    return "ignore";
  }
  if (input.clientX <= SIDEBAR_EDGE_REVEAL_ZONE_WIDTH) {
    return "open";
  }
  if (input.open && input.revealedByHover && input.insideSidebarChrome) {
    return "pin";
  }
  return "ignore";
}
