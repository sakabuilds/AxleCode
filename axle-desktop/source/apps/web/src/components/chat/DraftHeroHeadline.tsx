import type { ScopedProjectRef } from "@axle/contracts";
import { scopedProjectKey, scopeProjectRef } from "@axle/client-runtime/environment";
import { ChevronDownIcon, FolderIcon, FolderPlusIcon } from "lucide-react";
import { useMemo } from "react";

import { useOpenAddProjectCommandPalette } from "~/commandPaletteContext";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useProjects, useThreadShells } from "~/state/entities";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
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

  const projectSelector = shouldShowProjectMenu ? (
    <Menu>
      <MenuTrigger
        aria-label={hasResolvedProject ? "Change project" : "Choose a project"}
        className="inline-flex max-w-full cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FolderIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{activeProjectTitle ?? "Choose a project"}</span>
        <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
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
      className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <FolderPlusIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
      {activeProjectTitle ?? "Add a project"}
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-3xl text-left">
      <div className="mb-4 flex items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Workspace
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        What are we building?
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {hasResolvedProject
          ? "Describe a change, investigate an issue, or plan your next step."
          : "Bring a codebase, choose your model, and get to work."}
      </p>
      <div className="mt-5 flex min-w-0 items-center gap-3">{projectSelector}</div>
    </div>
  );
}
