"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { DUR, EASE, REVEAL } from "@/lib/motion";

type RevealProps = { children: ReactNode; className?: string; delay?: number; y?: number };
const viewport = { once: true, margin: "-32px 0px", amount: 0.08 } as const;

export function Reveal({ children, className, delay = 0, y = REVEAL.distance }: RevealProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduce ? 0 : y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={viewport}
      transition={{ duration: reduce ? DUR.fast : DUR.base, delay: reduce ? 0 : delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

export function RevealGroup({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={{ hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : REVEAL.stagger } } }}
      initial="hidden"
      whileInView="show"
      viewport={viewport}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: reduce ? 0 : REVEAL.distance },
        show: { opacity: 1, y: 0, transition: { duration: reduce ? DUR.fast : DUR.base, ease: EASE } },
      }}
    >
      {children}
    </motion.div>
  );
}
