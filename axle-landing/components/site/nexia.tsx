import { cn } from "@/lib/cn";

/**
 * Nexia — the parent company mark.
 *
 * The glyph is a three-by-three grid: two squares on the top row, one on the
 * bottom right, and a 45° diagonal band that steps between them. It is drawn
 * from the same proportions as the supplied artwork, so it stays sharp at any
 * size and inherits `currentColor`.
 */
export function NexiaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 300 300"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M0 0h100v100H0zM200 0h100v100H200zM100 100h200l-100 100H100zM0 200h200l-100 100H0zM200 200h100v100H200z"
      />
    </svg>
  );
}

/**
 * The lockup: mark and wordmark on one baseline. Size it from the outside with
 * a font size — the mark tracks the wordmark cap height the way the brand
 * artwork does.
 */
export function NexiaLogo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-[0.34em] text-paper", className)}>
      <NexiaMark className="h-[0.74em] w-[0.74em]" />
      {showWordmark && (
        <span className="text-[1em] font-semibold leading-none tracking-[-0.045em]">
          Nexia
        </span>
      )}
    </span>
  );
}
