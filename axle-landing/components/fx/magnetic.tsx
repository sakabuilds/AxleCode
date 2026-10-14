"use client";

import { useEffect, useRef, type ReactNode, type PointerEvent } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { DUR, EASE } from "@/lib/motion";

type MagneticProps = { children: ReactNode; className?: string; strength?: number };

export function Magnetic({ children, className, strength = 4 }: MagneticProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const animations = useRef<ReturnType<typeof animate>[]>([]);

  useEffect(() => {
    if (reduce) {
      animations.current.forEach((animation) => animation.stop());
      x.jump(0);
      y.jump(0);
    }
    return () => animations.current.forEach((animation) => animation.stop());
  }, [reduce, x, y]);

  function moveTo(nextX: number, nextY: number) {
    animations.current.forEach((animation) => animation.stop());
    animations.current = [
      animate(x, nextX, { duration: DUR.fast, ease: EASE }),
      animate(y, nextY, { duration: DUR.fast, ease: EASE }),
    ];
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (reduce || event.pointerType !== "mouse" || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const max = Math.max(0, Math.min(5, strength));
    const dx = (event.clientX - rect.left - rect.width / 2) / Math.max(rect.width / 2, 1);
    const dy = (event.clientY - rect.top - rect.height / 2) / Math.max(rect.height / 2, 1);
    const nx = Math.max(-1, Math.min(1, dx));
    const ny = Math.max(-1, Math.min(1, dy));
    const scale = max / Math.max(1, Math.hypot(nx, ny));
    moveTo(nx * scale, ny * scale);
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ x, y }}
      onPointerMove={onPointerMove}
      onPointerLeave={() => moveTo(0, 0)}
      onPointerCancel={() => moveTo(0, 0)}
      onFocusCapture={() => moveTo(0, 0)}
    >
      {children}
    </motion.div>
  );
}
