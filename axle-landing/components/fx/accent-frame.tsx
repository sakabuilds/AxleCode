import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const ACCENT_COLORS = ["#ff6a24", "#ff8a3d", "#c4400d", "#4a1a07"];

/** The supplied sunset is the site's warm accent, confined to this frame. */
export function AccentFrame({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={cn("relative isolate overflow-hidden rounded-[36px] p-4 sm:p-5 lg:p-6", className)}>
      <div
        aria-hidden="true"
        style={{
          position: "absolute", inset: 0, zIndex: -1, pointerEvents: "none",
          backgroundColor: "#5d2b16",
          backgroundImage: "url('/images/sunset-field.webp')",
          backgroundPosition: "center 45%", backgroundSize: "cover",
        }}
      />
      {children}
    </div>
  );
}
