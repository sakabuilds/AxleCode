import { useAtomValue } from "@effect/atom-react";

import { APP_STAGE_LABEL } from "../branding";
import { resolveServerBackedAppStageLabel } from "../branding.logic";
import { primaryServerConfigAtom } from "../state/server";

export type SidebarStageBackdropVariant = "nightly" | "dev";

export function resolveSidebarStageBackdropVariant(
  stageLabel: string,
): SidebarStageBackdropVariant | null {
  const normalized = stageLabel.trim().toLowerCase();
  if (normalized === "nightly") return "nightly";
  if (normalized === "dev") return "dev";
  return null;
}

export function useSidebarStageBackdropVariant(): SidebarStageBackdropVariant | null {
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;

  return resolveSidebarStageBackdropVariant(
    resolveServerBackedAppStageLabel({
      primaryServerVersion,
      fallbackStageLabel: APP_STAGE_LABEL,
    }),
  );
}

/** Release channels use the same quiet chrome; their identity is shown by a text badge. */
export function SidebarStageBackdrop({ variant }: { variant: SidebarStageBackdropVariant }) {
  return (
    <div
      aria-hidden="true"
      data-stage={variant}
      className="pointer-events-none absolute inset-x-0 top-0 h-[var(--workspace-topbar-height)] border-b border-sidebar-border bg-sidebar"
    />
  );
}

export function StageBackdropArt({ variant }: { variant: SidebarStageBackdropVariant }) {
  return (
    <svg
      aria-hidden="true"
      data-stage={variant}
      className="h-full w-full text-sidebar"
      viewBox="0 0 288 96"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="288" height="96" fill="currentColor" />
    </svg>
  );
}
