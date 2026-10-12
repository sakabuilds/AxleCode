import { isValidElement, type ReactElement, type SVGProps } from "react";
import { describe, expect, it } from "vite-plus/test";

import { AxleLogo } from "../AxleLogo";
import { AuthLoadingScreen } from "./AuthSurfaceShell";

describe("AuthLoadingScreen", () => {
  it("uses the colorable Axle logo without exposing a visible account-loading label", () => {
    const screen = AuthLoadingScreen() as ReactElement<{
      readonly children: ReactElement<{
        readonly children: readonly [ReactElement<SVGProps<SVGSVGElement>>, ReactElement];
        readonly "aria-label": string;
      }>;
      readonly className: string;
    }>;
    expect(isValidElement(screen)).toBe(true);

    expect(screen.props.className).toContain("text-foreground");
    expect(screen.props.children.props["aria-label"]).toBe("Loading Axle");
    const logo = screen.props.children.props.children[0];
    expect(logo.type).toBe(AxleLogo);
    expect(logo.props).toMatchObject({
      "aria-label": "Axle",
      className: "size-20",
      role: "img",
    });
  });
});
