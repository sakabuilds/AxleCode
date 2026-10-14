"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { DUR, easeOut } from "@/lib/motion";

type ParallaxProps = { children: ReactNode; className?: string; distance?: number };

export function Parallax({ children, className, distance = 32 }: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const element = ref.current;
    if (!element || reduce || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const travel = Math.max(-64, Math.min(64, distance));
    gsap.registerPlugin(ScrollTrigger);
    const context = gsap.context(() => {
      gsap.fromTo(element, { y: travel / 2 }, {
        y: -travel / 2,
        ease: easeOut,
        scrollTrigger: {
          trigger: element,
          start: "top bottom",
          end: "bottom top",
          scrub: DUR.base,
          invalidateOnRefresh: true,
        },
      });
    }, element);
    return () => context.revert();
  }, [distance, reduce]);

  return <div ref={ref} className={className}>{children}</div>;
}
