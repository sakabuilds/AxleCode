import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { FolderPlusIcon, SearchIcon, SquarePenIcon } from "lucide-react";
import { useOpenAddProjectCommandPalette } from "../commandPaletteContext";
import { shortcutLabelForCommand } from "../keybindings";
import { primaryServerKeybindingsAtom } from "../state/server";
import { Button } from "./ui/button";
import { CommandDialogTrigger } from "./ui/command";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { Kbd } from "./ui/kbd";
import { SidebarInset } from "./ui/sidebar";
import { isElectron } from "../env";
import { cn } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

export function NoActiveThreadState() {
  const openAddProject = useOpenAddProjectCommandPalette();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const commandShortcut = shortcutLabelForCommand(keybindings, "commandPalette.toggle");

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <header
          className={cn(
            "border-b border-border px-3 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none sm:px-5",
            isElectron ? "workspace-topbar drag-region" : "workspace-topbar",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <span className="text-xs font-medium text-muted-foreground wco:pr-[var(--workspace-native-controls-inset)]">
            Workspace
          </span>
        </header>

        <Empty className="flex-1 px-6">
          <div className="w-full max-w-sm py-10 text-left">
            <EmptyHeader className="max-w-none items-start text-left">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Ready when you are
              </p>
              <EmptyTitle className="text-xl font-semibold tracking-tight text-foreground">
                Your next task starts here.
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-sm leading-6 text-muted-foreground">
                Start a thread, open a codebase, or find where you left off.
              </EmptyDescription>
            </EmptyHeader>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button size="sm" render={<Link to="/" />}>
                <SquarePenIcon className="size-4" aria-hidden="true" />
                New thread
              </Button>
              <Button size="sm" variant="outline" onClick={openAddProject}>
                <FolderPlusIcon className="size-4" aria-hidden="true" />
                Add project
              </Button>
            </div>
            <CommandDialogTrigger
              render={
                <button
                  type="button"
                  className="mt-6 flex w-full items-center gap-2 rounded-md border-t border-border px-1 py-3 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              <SearchIcon className="size-3.5" aria-hidden="true" />
              <span className="flex-1">Find a thread or command</span>
              {commandShortcut ? <Kbd>{commandShortcut}</Kbd> : null}
            </CommandDialogTrigger>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
