"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDown, Check } from "lucide-react";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/cn";

export type Step = { tag: string; title: string; copy: string; bullets: readonly string[] };

export function StickySteps({ steps, panels }: { steps: readonly Step[]; panels: ReactNode[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const reduce = useReducedMotion();

  useEffect(() => {
    const nodes = refs.current.filter(Boolean) as HTMLDivElement[];
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActive(nodes.indexOf(entry.target as HTMLDivElement));
      });
    }, { rootMargin: "-38% 0px -38% 0px", threshold: 0 });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [steps.length]);

  function goToStep(index: number) {
    refs.current[index]?.scrollIntoView({ behavior: reduce ? "instant" : "smooth", block: "center" });
  }

  return (
    <div className="grid items-start gap-12 lg:grid-cols-[1fr_1.08fr] lg:gap-24">
      <div>
        {steps.map((step, index) => (
          <div key={step.tag} ref={(node) => { refs.current[index] = node; }} className="flex scroll-mt-28 flex-col justify-center border-t border-white/10 py-12 first:border-0 first:pt-0 lg:min-h-[70vh] lg:border-0 lg:py-16 lg:first:pt-16">
            <span className="font-mono text-[11px] tracking-[.12em] text-mute">{step.tag}</span>
            <h3 className="mt-5 max-w-md text-[30px] font-medium leading-[1.15] tracking-[-.04em] sm:text-[38px]">{step.title}</h3>
            <p className="mt-5 max-w-md text-[15px] leading-7 text-mute">{step.copy}</p>
            <ul className="mt-7 space-y-3">
              {step.bullets.map((bullet) => <li key={bullet} className="flex items-start gap-3 text-[13px] leading-6 text-mute"><Check className="mt-1 h-4 w-4 shrink-0 text-paper" strokeWidth={1.5} aria-hidden="true" /><span>{bullet}</span></li>)}
            </ul>
            <div className="hairline mt-9 overflow-hidden rounded-[20px] bg-[#101010] lg:hidden">{panels[index]}</div>
          </div>
        ))}
      </div>
      <div className="sticky top-32 hidden pt-8 lg:block">
        <div className="hairline overflow-hidden rounded-[20px] bg-[#101010]">
          <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
            <span className="font-mono text-[10px] uppercase tracking-[.12em] text-mute">A day with Rivet</span>
            <span className="font-mono text-[10px] text-mute">0{active + 1} / 0{steps.length}</span>
          </div>
          <div className="relative min-h-[390px]">
            <AnimatePresence mode="wait">
              <motion.div key={active} initial={{ opacity: 0, y: reduce ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : -8 }} transition={{ duration: .4, ease: EASE }}>{panels[active]}</motion.div>
            </AnimatePresence>
          </div>
          <div className="flex items-center justify-between border-t border-white/10 px-6 py-4">
            <div className="flex gap-2" aria-label="Walkthrough steps">
              {steps.map((step, index) => <button key={step.tag} onClick={() => goToStep(index)} aria-label={"Go to " + step.tag + ": " + step.title} aria-current={active === index ? "step" : undefined} className="group flex h-7 w-8 items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"><span className={cn("h-1 w-6 rounded-full transition-colors duration-[400ms] ease-premium", active === index ? "bg-white" : "bg-white/20 group-hover:bg-white/40")} /></button>)}
            </div>
            <span className="flex items-center gap-2 text-[11px] text-mute">Scroll to explore <ArrowDown size={13} aria-hidden="true" /></span>
          </div>
        </div>
      </div>
    </div>
  );
}
