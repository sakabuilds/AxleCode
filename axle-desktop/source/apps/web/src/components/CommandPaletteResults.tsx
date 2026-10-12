import { type ResolvedKeybindingsConfig } from "@axle/contracts";
import { ChevronRightIcon, LoaderIcon, SearchIcon } from "lucide-react";
import { shortcutLabelForCommand } from "../keybindings";
import {
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  type CommandPaletteSubmenuItem,
} from "./CommandPalette.logic";
import {
  CommandCollection,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "./ui/command";
import { cn } from "~/lib/utils";

interface CommandPaletteResultsProps {
  emptyStateMessage?: string;
  groups: ReadonlyArray<CommandPaletteGroup>;
  highlightedItemValue?: string | null;
  isActionsOnly: boolean;
  isLoading?: boolean;
  keybindings: ResolvedKeybindingsConfig;
  onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
}

export function CommandPaletteResults(props: CommandPaletteResultsProps) {
  if (props.isLoading) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted-foreground"
      >
        <LoaderIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Loading folders…
      </div>
    );
  }

  if (props.groups.length === 0) {
    return (
      <div role="status" className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        {!props.emptyStateMessage ? (
          <SearchIcon className="mb-1 size-5 text-muted-foreground" aria-hidden="true" />
        ) : null}
        <p className="text-sm text-foreground">
          {props.emptyStateMessage ??
            (props.isActionsOnly
              ? "No matching actions"
              : "No matching commands, projects, or threads")}
        </p>
        {!props.emptyStateMessage ? (
          <p className="text-xs text-muted-foreground">Try a different name or a shorter search.</p>
        ) : null}
      </div>
    );
  }

  return (
    <CommandList className="p-2">
      {props.groups.map((group) => (
        <CommandGroup items={group.items} key={group.value}>
          <CommandGroupLabel className="px-2.5 pb-1.5 pt-3 text-[11px] font-medium tracking-wide text-muted-foreground">
            {group.label}
          </CommandGroupLabel>
          <CommandCollection>
            {(item) =>
              item.disabled ? (
                <DisabledCommandPaletteResultRow item={item} key={item.value} />
              ) : (
                <CommandPaletteResultRow
                  item={item}
                  key={item.value}
                  keybindings={props.keybindings}
                  isActive={props.highlightedItemValue === item.value}
                  onExecuteItem={props.onExecuteItem}
                />
              )
            }
          </CommandCollection>
        </CommandGroup>
      ))}
    </CommandList>
  );
}

function DisabledCommandPaletteResultRow(props: {
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
}) {
  return (
    <div
      aria-disabled="true"
      className="flex min-h-10 select-none items-center gap-3 rounded-md px-2.5 py-2 text-sm opacity-60"
    >
      {props.item.icon}
      {props.item.description ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
            {props.item.titleLeadingContent}
            <span className="truncate">{props.item.title}</span>
          </span>
          <span className="truncate text-xs leading-5 text-muted-foreground">
            {props.item.description}
          </span>
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
          {props.item.titleLeadingContent}
          <span className="truncate">{props.item.title}</span>
        </span>
      )}
      {props.item.titleTrailingContent}
    </div>
  );
}

function CommandPaletteResultRow(props: {
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
  isActive: boolean;
  keybindings: ResolvedKeybindingsConfig;
  onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
}) {
  const shortcutLabel = props.item.shortcutCommand
    ? shortcutLabelForCommand(props.keybindings, props.item.shortcutCommand)
    : null;

  return (
    <CommandItem
      value={props.item.value}
      className={cn(
        "min-h-10 cursor-pointer gap-3 rounded-md px-2.5 py-2 transition-colors duration-100 hover:bg-transparent hover:text-inherit data-highlighted:bg-transparent data-highlighted:text-inherit data-selected:bg-transparent data-selected:text-inherit [&[data-highlighted][data-selected]]:bg-transparent [&[data-highlighted][data-selected]]:text-inherit motion-reduce:transition-none",
        props.isActive && "bg-accent! text-accent-foreground! ring-1 ring-inset ring-border",
      )}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onExecuteItem(props.item);
      }}
    >
      {props.item.icon}
      {props.item.description ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
            {props.item.titleLeadingContent}
            <span className="truncate">{props.item.title}</span>
          </span>
          <span className="truncate text-xs leading-5 text-muted-foreground">
            {props.item.description}
          </span>
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
          {props.item.titleLeadingContent}
          <span className="truncate">{props.item.title}</span>
        </span>
      )}
      {props.item.titleTrailingContent}
      {props.item.timestamp ? (
        <span className="min-w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {props.item.timestamp}
        </span>
      ) : null}
      {shortcutLabel ? <CommandShortcut>{shortcutLabel}</CommandShortcut> : null}
      {props.item.kind === "submenu" ? (
        <ChevronRightIcon
          className="ml-auto size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      ) : null}
    </CommandItem>
  );
}
