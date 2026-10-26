import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { AccountAuthProvider } from "./account/AccountAuthProvider";
import { AccountGate } from "./account/AccountGate";
import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { PluginAuthorizationCardHost } from "./components/plugins/PluginAuthorizationCardHost";
import { PreviewAutomationHosts } from "./components/preview/PreviewAutomationHosts";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";
import { AppRoot } from "./AppRoot";

describe("AppRoot", () => {
  it("shares the application atom registry with authenticated routed UI and renderer-wide hosts", () => {
    const root = AppRoot({ router: {} as AppRouter });

    expect(root.type).toBe(AppAtomRegistryProvider);
    const children = Children.toArray(
      (root as ReactElement<{ readonly children: ReactNode }>).props.children,
    );
    expect(children).toHaveLength(3);

    const accountRoot = children[0];
    expect(isValidElement(accountRoot) && accountRoot.type).toBe(AccountAuthProvider);
    const accountChildren = isValidElement<{ readonly children: ReactNode }>(accountRoot)
      ? Children.toArray(accountRoot.props.children)
      : [];
    expect(accountChildren).toHaveLength(2);
    const accountGate = accountChildren[0];
    expect(isValidElement(accountGate) && accountGate.type).toBe(AccountGate);
    const gatedChildren = isValidElement<{ readonly children: ReactNode }>(accountGate)
      ? Children.toArray(accountGate.props.children)
      : [];
    expect(gatedChildren).toHaveLength(1);
    expect(isValidElement(gatedChildren[0]) && gatedChildren[0].type).toBe(RouterProvider);
    expect(isValidElement(accountChildren[1]) && accountChildren[1].type).toBe(
      PluginAuthorizationCardHost,
    );

    expect(isValidElement(children[1]) && children[1].type).toBe(PreviewAutomationHosts);
    expect(isValidElement(children[2]) && children[2].type).toBe(ElectronBrowserHost);
  });
});
