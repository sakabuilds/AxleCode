/** Shared visual grammar. Components keep their own behavior and accessibility. */
export const focusRing =
  "outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export const premiumTransition =
  "transition-[color,background-color,border-color,opacity,transform] duration-200 ease-[var(--ease-premium)] motion-reduce:transition-none";

export const controlSurface =
  "relative inline-flex w-full rounded-lg border border-input bg-background text-sm text-foreground shadow-[var(--highlight-top)] transition-[color,background-color,border-color,opacity] duration-200 ease-[var(--ease-premium)] has-focus-visible:border-ring has-focus-visible:ring-1 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background has-aria-invalid:border-destructive has-disabled:cursor-not-allowed has-disabled:opacity-40 motion-reduce:transition-none";

export const floatingSurface =
  "rounded-xl border border-border bg-popover/95 text-popover-foreground shadow-[var(--highlight-top)] backdrop-blur-[16px] outline-none transition-[opacity,transform] duration-200 ease-[var(--ease-premium)] data-ending-style:opacity-0 data-starting-style:opacity-0 data-starting-style:scale-95 motion-reduce:transition-none";

export const interactiveItem =
  "flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground outline-none transition-[color,background-color,opacity] duration-200 ease-[var(--ease-premium)] data-disabled:pointer-events-none data-disabled:opacity-40 data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 motion-reduce:transition-none";
