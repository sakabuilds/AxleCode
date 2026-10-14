import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function GlassPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("glass relative rounded-2xl", className)}>{children}</div>;
}
