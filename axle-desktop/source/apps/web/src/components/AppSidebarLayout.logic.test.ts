import { describe, expect, it } from "vite-plus/test";

import {
  resolveSidebarEdgePointerAction,
  resolveSidebarEdgePress,
  SIDEBAR_EDGE_REVEAL_ZONE_WIDTH,
} from "./AppSidebarLayout.logic";

const SIDEBAR_WIDTH = 256;

describe("sidebar edge reveal", () => {
  it("reveals a collapsed sidebar when the pointer reaches the window edge", () => {
    expect(
      resolveSidebarEdgePointerAction({
        clientX: 0,
        open: false,
        revealedByHover: false,
        sidebarWidth: SIDEBAR_WIDTH,
      }),
    ).toBe("reveal");
    expect(
      resolveSidebarEdgePointerAction({
        clientX: SIDEBAR_EDGE_REVEAL_ZONE_WIDTH,
        open: false,
        revealedByHover: false,
        sidebarWidth: SIDEBAR_WIDTH,
      }),
    ).toBe("reveal");
  });

  it("leaves a collapsed sidebar alone elsewhere", () => {
    expect(
      resolveSidebarEdgePointerAction({
        clientX: SIDEBAR_EDGE_REVEAL_ZONE_WIDTH + 1,
        open: false,
        revealedByHover: false,
        sidebarWidth: SIDEBAR_WIDTH,
      }),
    ).toBe("ignore");
  });

  it("keeps a hover reveal while the pointer stays on the edge or over it", () => {
    expect(
      resolveSidebarEdgePointerAction({
        clientX: SIDEBAR_EDGE_REVEAL_ZONE_WIDTH,
        open: true,
        revealedByHover: true,
        sidebarWidth: SIDEBAR_WIDTH,
      }),
    ).toBe("hold");
    expect(
      resolveSidebarEdgePointerAction({
        clientX: SIDEBAR_WIDTH,
        open: true,
        revealedByHover: true,
        sidebarWidth: SIDEBAR_WIDTH,
      }),
    ).toBe("hold");
  });

  it("slides a hover reveal away once the pointer leaves it", () => {
    expect(
      resolveSidebarEdgePointerAction({
        clientX: SIDEBAR_WIDTH + 1,
        open: true,
        revealedByHover: true,
        sidebarWidth: SIDEBAR_WIDTH,
      }),
    ).toBe("schedule-close");
  });

  it("never auto-hides a sidebar the user opened themselves", () => {
    expect(
      resolveSidebarEdgePointerAction({
        clientX: 900,
        open: true,
        revealedByHover: false,
        sidebarWidth: SIDEBAR_WIDTH,
      }),
    ).toBe("ignore");
    expect(
      resolveSidebarEdgePointerAction({
        clientX: 0,
        open: true,
        revealedByHover: false,
        sidebarWidth: SIDEBAR_WIDTH,
      }),
    ).toBe("ignore");
  });
});

describe("sidebar edge press", () => {
  it("opens a collapsed sidebar from a primary press on the edge", () => {
    expect(
      resolveSidebarEdgePress({
        button: 0,
        clientX: 4,
        insideSidebarChrome: false,
        open: false,
        revealedByHover: false,
      }),
    ).toBe("open");
  });

  it("ignores presses away from the collapsed edge", () => {
    expect(
      resolveSidebarEdgePress({
        button: 0,
        clientX: SIDEBAR_EDGE_REVEAL_ZONE_WIDTH + 2,
        insideSidebarChrome: false,
        open: false,
        revealedByHover: false,
      }),
    ).toBe("ignore");
    expect(
      resolveSidebarEdgePress({
        button: 2,
        clientX: 4,
        insideSidebarChrome: false,
        open: false,
        revealedByHover: false,
      }),
    ).toBe("ignore");
  });

  it("pins a hover reveal once the user presses the sidebar or its toggle", () => {
    expect(
      resolveSidebarEdgePress({
        button: 0,
        clientX: 26,
        insideSidebarChrome: true,
        open: true,
        revealedByHover: true,
      }),
    ).toBe("pin");
  });

  it("does not pin presses that miss the sidebar", () => {
    expect(
      resolveSidebarEdgePress({
        button: 0,
        clientX: 700,
        insideSidebarChrome: false,
        open: true,
        revealedByHover: true,
      }),
    ).toBe("ignore");
    expect(
      resolveSidebarEdgePress({
        button: 0,
        clientX: 26,
        insideSidebarChrome: true,
        open: true,
        revealedByHover: false,
      }),
    ).toBe("ignore");
  });
});
