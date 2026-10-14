"use client";

import { useEffect, useId, useRef, type ReactNode, type PointerEvent } from "react";
import { useReducedMotion } from "motion/react";
import gsap from "gsap";
import { DUR, easeOut } from "@/lib/motion";

export function NoiseDisplace({ children, className }: { children: ReactNode; className?: string }) {
  const filterId = "displace-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const reduce = useReducedMotion();
  const displacement = useRef<SVGFEDisplacementMapElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const filter = displacement.current;
    const element = content.current;
    if (reduce && filter && element) {
      gsap.killTweensOf(filter);
      filter.setAttribute("scale", "0");
      element.style.filter = "none";
    }
    return () => { if (filter) gsap.killTweensOf(filter); };
  }, [reduce]);

  function animateTo(scale: number, event?: PointerEvent<HTMLDivElement>) {
    const filter = displacement.current;
    const element = content.current;
    if (!filter || !element || reduce || (event && event.pointerType !== "mouse")) return;
    if (typeof CSS === "undefined" || !CSS.supports("filter", "url(#filter)")) return;
    gsap.killTweensOf(filter);
    element.style.filter = "url(#" + filterId + ")";
    gsap.to(filter, {
      attr: { scale }, duration: DUR.base, ease: easeOut,
      onComplete: () => { if (scale === 0) element.style.filter = "none"; },
    });
  }

  return (
    <div className={className} onPointerEnter={(event) => animateTo(3, event)} onPointerLeave={() => animateTo(0)} onPointerCancel={() => animateTo(0)}>
      <svg width="0" height="0" style={{ position: "absolute", pointerEvents: "none" }} aria-hidden="true" focusable="false">
        <defs>
          <filter id={filterId} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.015 0.025" numOctaves={2} seed={7} result="noise" />
            <feDisplacementMap ref={displacement} in="SourceGraphic" in2="noise" scale={0} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <div ref={content} style={{ width: "100%", height: "100%" }}>{children}</div>
    </div>
  );
}
