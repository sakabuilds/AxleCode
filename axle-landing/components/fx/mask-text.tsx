"use client";

import { motion, useReducedMotion } from "motion/react";
import { DUR, EASE, REVEAL } from "@/lib/motion";

type MaskTextProps = {
  lines: string[];
  className?: string;
  lineClassName?: string;
  delay?: number;
  stagger?: number;
  trigger?: "view" | "mount";
  start?: boolean;
};

export function MaskText({
  lines, className, lineClassName, delay = 0, stagger = REVEAL.stagger, trigger = "view", start = true,
}: MaskTextProps) {
  const reduce = useReducedMotion();
  const hidden = { opacity: 0, y: reduce ? 0 : "110%" };
  const shown = { opacity: 1, y: 0 };

  return (
    <span className={className}>
      {lines.map((line, index) => (
        <span key={index} style={{ display: "block", overflow: "hidden", paddingBottom: "0.08em", marginBottom: "-0.08em" }}>
          <motion.span
            className={lineClassName}
            style={{ display: "block" }}
            initial={hidden}
            animate={trigger === "mount" ? (start ? shown : hidden) : undefined}
            whileInView={trigger === "view" ? shown : undefined}
            viewport={{ once: true, margin: "-24px 0px" }}
            transition={{
              duration: reduce ? DUR.fast : DUR.slow,
              delay: reduce ? 0 : delay + index * stagger,
              ease: EASE,
            }}
          >
            {line}{index < lines.length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </span>
  );
}
