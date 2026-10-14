import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Eyebrow } from "@/components/site/section";
import { Reveal } from "@/components/fx/reveal";

export function PageHero({
  eyebrow,
  title,
  copy,
  children,
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  copy: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("relative overflow-hidden px-6 pb-16 pt-36 sm:pb-20 sm:pt-44", className)}>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 0%, rgba(255,255,255,0.07), rgba(5,5,5,0) 70%)",
        }}
        aria-hidden="true"
      />
      <div className="relative mx-auto w-full max-w-7xl">
        <Reveal>
          <Eyebrow>{eyebrow}</Eyebrow>
        </Reveal>
        <Reveal delay={0.05}>
          <h1 className="mt-6 max-w-4xl text-balance text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[52px] lg:text-[60px]">
            {title}
          </h1>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="mt-6 max-w-2xl text-[16px] leading-relaxed text-mute sm:text-[17.5px]">{copy}</div>
        </Reveal>
        {children ? (
          <Reveal delay={0.15}>
            <div className="mt-9">{children}</div>
          </Reveal>
        ) : null}
      </div>
    </section>
  );
}
