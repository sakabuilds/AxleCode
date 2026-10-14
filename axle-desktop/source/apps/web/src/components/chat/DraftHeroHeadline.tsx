import type { ScopedProjectRef } from "@axle/contracts";
import { scopedProjectKey, scopeProjectRef } from "@axle/client-runtime/environment";
import { useLocation } from "@tanstack/react-router";
import { ChevronDownIcon, FolderPlusIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useOpenAddProjectCommandPalette } from "~/commandPaletteContext";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useProjects, useThreadShells } from "~/state/entities";
import { AxleLogo } from "../AxleLogo";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { resolveDraftGreeting } from "./draftGreeting";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";

interface DraftHeroHeadlineProps {
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

export function DraftHeroHeadline({
  activeProjectRef,
  activeProjectTitle,
}: DraftHeroHeadlineProps) {
  const projects = useProjects();
  const threads = useThreadShells();
  const handleNewThread = useNewThreadHandler();
  const openAddProject = useOpenAddProjectCommandPalette();
  const pathname = useLocation({ select: (location) => location.pathname });
  const [openedAt] = useState(() => new Date());

  const orderedProjects = useMemo(
    () => sortScopedProjectsForSidebar(projects, threads, "updated_at"),
    [projects, threads],
  );
  const projectByKey = useMemo(
    () =>
      new Map(
        orderedProjects.map(
          (project) =>
            [
              scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
              project,
            ] as const,
        ),
      ),
    [orderedProjects],
  );
  const activeProjectKey = activeProjectRef === null ? "" : scopedProjectKey(activeProjectRef);
  const hasResolvedProject = activeProjectTitle !== null;
  const canChooseProject = orderedProjects.length > 0;
  const shouldShowProjectMenu = canChooseProject;
  const greeting = resolveDraftGreeting({
    now: openedAt,
    seed: pathname,
    projectCount: projects.length,
    activeProjectRef: hasResolvedProject ? activeProjectRef : null,
    threads,
  });
  const hasInlineProject = hasResolvedProject && greeting.projectSuffix !== undefined;

  const projectSelector = shouldShowProjectMenu ? (
    <Menu>
      <MenuTrigger
        aria-label={hasResolvedProject ? "Change project" : "Choose a project"}
        className="inline-flex max-w-full cursor-pointer items-baseline gap-1.5 rounded-md text-inherit underline decoration-muted-foreground/50 decoration-dotted underline-offset-8 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate">{activeProjectTitle ?? "Choose a project"}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 shrink-0 self-center text-muted-foreground"
        />
      </MenuTrigger>
      <MenuPopup align="start" className="max-h-80 w-64 overflow-y-auto">
        <MenuRadioGroup
          value={activeProjectKey}
          onValueChange={(value) => {
            const project = projectByKey.get(value as string);
            if (!project || value === activeProjectKey) {
              return;
            }
            void handleNewThread(scopeProjectRef(project.environmentId, project.id), {
              replace: true,
            });
          }}
        >
          {orderedProjects.map((project) => {
            const key = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
            return (
              <MenuRadioItem key={key} value={key} closeOnClick>
                <span className="min-w-0 truncate">{project.title}</span>
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem onClick={openAddProject}>
          <FolderPlusIcon />
          New project
        </MenuItem>
      </MenuPopup>
    </Menu>
  ) : (
    <button
      type="button"
      onClick={openAddProject}
      className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <FolderPlusIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
      {activeProjectTitle ?? "Add a project"}
    </button>
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col items-center px-4 text-center">
      <div aria-hidden="true" className="mb-7 text-muted-foreground/45 sm:mb-8">
        <AxleLogo aria-hidden="true" className="size-11 sm:size-12" />
      </div>
      <h1 className="flex max-w-full flex-wrap items-baseline justify-center gap-x-2 text-[25px] font-semibold leading-snug tracking-[-0.035em] text-foreground sm:gap-x-2.5 sm:text-[32px]">
        <span>{greeting.text}</span>
        {hasInlineProject ? (
          <span className="inline-flex min-w-0 items-baseline">
            {projectSelector}
            <span>{greeting.projectSuffix}</span>
          </span>
        ) : null}
      </h1>
      {!hasInlineProject ? (
        <div className="mt-5 flex min-w-0 items-center justify-center text-sm font-medium text-muted-foreground">
          {projectSelector}
        </div>
      ) : null}
    </div>
  );
}
