import type { EnvironmentId, ProviderInteractionMode } from "@axle/contracts";
import { PaperclipIcon, PlusIcon, PencilRulerIcon, PlugIcon } from "lucide-react";
import { memo, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";

/**
 * Context, connected apps, and planning share one keyboard-accessible entry point.
 * File selection delegates to the same picker used by @.
 */
export const ComposerAddMenu = memo(function ComposerAddMenu(props: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  workspaceContextEnabled: boolean;
  interactionMode: ProviderInteractionMode;
  disabled?: boolean;
  onOpenPicker: () => void;
  onPlanMode: () => void;
}) {
  const navigate = useNavigate();
  const openingPicker = useRef(false);
  return (
    <Menu
      onOpenChange={(open) => {
        if (open) openingPicker.current = false;
      }}
    >
      <MenuTrigger
        render={<Button type="button" size="icon-sm" variant="ghost" />}
        disabled={props.disabled}
        aria-label="Add context and apps"
        data-composer-add-menu-trigger="true"
        className="size-8 shrink-0 rounded-full text-foreground/85 hover:bg-foreground/5 hover:text-foreground"
      >
        <PlusIcon className="size-5" strokeWidth={1.75} aria-hidden />
      </MenuTrigger>
      <MenuPopup
        align="start"
        side="top"
        className="w-60"
        finalFocus={() => (openingPicker.current ? false : undefined)}
      >
        <MenuItem
          onClick={() => {
            openingPicker.current = true;
            props.onOpenPicker();
          }}
        >
          <PaperclipIcon aria-hidden />
          Add files or context
        </MenuItem>
        <MenuItem onClick={() => void navigate({ to: "/plugins" })}>
          <PlugIcon aria-hidden />
          Connect apps
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={props.interactionMode === "plan"} onClick={props.onPlanMode}>
          <PencilRulerIcon aria-hidden />
          {props.interactionMode === "plan" ? "Plan mode enabled" : "Plan before building"}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
});
