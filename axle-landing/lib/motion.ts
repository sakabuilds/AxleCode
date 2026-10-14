export const EASE = [0.16, 1, 0.3, 1] as const;
export const EASE_CSS = "cubic-bezier(0.16, 1, 0.3, 1)";
export const DUR = { fast: 0.4, base: 0.6, slow: 0.8 } as const;
export const REVEAL = { distance: 16, stagger: 0.07 } as const;

/** The CSS cubic-bezier, evaluated for Lenis and GSAP. */
export function easeOut(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  let lower = 0;
  let upper = 1;
  let t = progress;
  // Solve x before evaluating y so all animation libraries use one curve.
  for (let i = 0; i < 14; i += 1) {
    const inverse = 1 - t;
    const x = 3 * inverse * inverse * t * EASE[0] + 3 * inverse * t * t * EASE[2] + t * t * t;
    if (Math.abs(x - progress) < 0.00001) break;
    if (x < progress) lower = t;
    else upper = t;
    t = (lower + upper) / 2;
  }
  return 1 - Math.pow(1 - t, 3);
}
