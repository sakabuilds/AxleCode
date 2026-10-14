import { scopedProjectKey, scopeProjectRef } from "@axle/client-runtime/environment";
import { UNSCOPED_CHAT_PROJECT_ID, type ScopedProjectRef } from "@axle/contracts";
import { ChevronDownIcon, FolderIcon, FolderPlusIcon } from "lucide-react";
import { useMemo } from "react";

import { useOpenAddProjectCommandPalette } from "../../commandPaletteContext";
import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjects } from "../../state/entities";
import { Button } from "../ui/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";

export function ComposerProjectPicker(props: {
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
  readonly draftId: DraftId | null;
}) {
  const projects = useProjects();
  const handleNewThread = useNewThreadHandler();
  const openAddProject = useOpenAddProjectCommandPalette();
  const orderedProjects = useMemo(
    () =>
      projects
        .filter((project) => project.id !== UNSCOPED_CHAT_PROJECT_ID)
        .toSorted((left, right) => left.title.localeCompare(right.title)),
    [projects],
  );
  const activeProjectKey = props.activeProjectRef ? scopedProjectKey(props.activeProjectRef) : null;

  const selectProject = async (projectRef: ScopedProjectRef) => {
    if (props.draftId && scopedProjectKey(projectRef) === activeProjectKey) return;
    const store = useComposerDraftStore.getState();
    const savedDestination = store.getDraftSessionByProjectRef(projectRef);
    const source = props.draftId ? store.getComposerDraft(props.draftId) : null;
    const selectedModel = source?.activeProvider
      ? source.modelSelectionByProvider[source.activeProvider]
      : undefined;

    await handleNewThread(projectRef, {
      replace: props.draftId !== null,
      ...(source && !savedDestination ? { initialPrompt: source.prompt } : {}),
    });

    const destination = useComposerDraftStore.getState().getDraftSessionByProjectRef(projectRef);
    if (!savedDestination && destination && selectedModel) {
      useComposerDraftStore.getState().setModelSelection(destination.draftId, selectedModel);
    }
    if (savedDestination && source?.prompt.trim()) {
      toastManager.add({
        type: "info",
        title: "Opened your saved project draft",
        description: "Your previous draft is still saved in its project.",
      });
    }
  };

  return (
    <Menu>
      <MenuTrigger
        render={<Button type="button" variant="ghost" size="xs" />}
        aria-label={props.draftId ? "Choose project" : "Project actions"}
        data-composer-project-picker="true"
        className="h-8 min-w-0 max-w-48 shrink justify-start gap-2 px-2 text-xs font-medium text-foreground/85 hover:text-foreground"
      >
        <FolderIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{props.activeProjectTitle ?? "Choose project"}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-60" aria-hidden />
      </MenuTrigger>
      <MenuPopup align="start" side="top" className="w-72">
        <MenuGroup>
        <MenuGroupLabel>{props.draftId ? "Choose project" : "New chat in project"}</MenuGroupLabel>
        {orderedProjects.map((project) => {
          const projectRef = scopeProjectRef(project.environmentId, project.id);
          const key = scopedProjectKey(projectRef);
          return (
            <MenuItem
              key={key}
              disabled={props.draftId !== null && key === activeProjectKey}
              onClick={() => {
                void selectProject(projectRef).catch(() => {
                  toastManager.add({ type: "error", title: "Could not open this project" });
                });
              }}
            >
              <FolderIcon aria-hidden />
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate">{project.title}</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {project.workspaceRoot}
                </span>
              </span>
            </MenuItem>
          );
        })}
        </MenuGroup>
        {orderedProjects.length > 0 ? <MenuSeparator /> : null}
        <MenuItem onClick={openAddProject}>
          <FolderPlusIcon aria-hidden />
          Add project…
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
