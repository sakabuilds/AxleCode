import { BugIcon, Code2Icon, CompassIcon } from "lucide-react";

const QUICK_STARTS = [
  {
    label: "Build a feature",
    description: "Turn an idea into a plan",
    icon: Code2Icon,
    prompt:
      "I want to build a new feature. Explore the codebase first, then help me plan the implementation. Here’s what I have in mind: ",
  },
  {
    label: "Find and fix a bug",
    description: "Get to the root of an issue",
    icon: BugIcon,
    prompt:
      "Help me investigate and fix a bug. Trace the relevant code, explain the cause, and verify the fix. Here’s what’s happening: ",
  },
  {
    label: "Explore this codebase",
    description: "Understand how it fits together",
    icon: CompassIcon,
    prompt:
      "Explore this codebase and explain its architecture, main entry points, and how the key pieces work together. Start by reading the project instructions and documentation.",
  },
] as const;

export function DraftQuickStarts({
  onSelect,
  disabled,
}: {
  readonly onSelect: (prompt: string) => void;
  readonly disabled: boolean;
}) {
  return (
    <section
      aria-label="Task starters"
      className="draft-quick-starts mx-auto mt-3 w-full max-w-3xl"
    >
      <div className="flex flex-wrap items-center justify-center gap-1 sm:gap-3">
        {QUICK_STARTS.map(({ label, description, icon: Icon, prompt }) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(prompt)}
            title={description}
            className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.5} />
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
