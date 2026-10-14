import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("hairline relative rounded-2xl bg-white/[0.015]", className)}>{children}</div>
  );
}
