import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Section({
  children,
  className,
  id,
  divider = false,
  wash = false,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  divider?: boolean;
  wash?: boolean;
}) {
  return (
    <section
      id={id}
      className={cn(
        "relative px-6 py-24 sm:py-28 lg:py-36",
        divider ? "border-t border-white/[0.06]" : "",
        wash ? "section-wash" : "",
        divider && wash ? "edge-glow" : "",
        className
      )}
    >
      <div className="relative mx-auto w-full max-w-7xl">{children}</div>
    </section>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "hairline-lite inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-mute",
        className
      )}
    >
      {children}
    </span>
  );
}

export function SectionHead({
  eyebrow,
  title,
  copy,
  align = "left",
  className,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  copy?: ReactNode;
  align?: "left" | "center";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-5",
        align === "center" ? "items-center text-center" : "items-start",
        className
      )}
    >
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2
        className={cn(
          "text-balance text-[30px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[40px] lg:text-[46px]",
          align === "center" ? "mx-auto max-w-3xl" : "max-w-3xl"
        )}
      >
        {title}
      </h2>
      {copy ? (
        <p
          className={cn(
            "text-[15.5px] leading-relaxed text-mute sm:text-[16.5px]",
            align === "center" ? "mx-auto max-w-2xl" : "max-w-2xl"
          )}
        >
          {copy}
        </p>
      ) : null}
      {children}
    </div>
  );
}

export function Rule({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-white/[0.07]", className)} aria-hidden="true" />;
}
