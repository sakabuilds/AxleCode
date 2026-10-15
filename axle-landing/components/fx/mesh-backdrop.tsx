"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { useInView, useReducedMotion } from "motion/react";
import type { MeshGradientProps } from "@paper-design/shaders-react";
import { cn } from "@/lib/cn";

const MeshGradient = dynamic<MeshGradientProps>(
  () => import("@paper-design/shaders-react").then((module) => module.MeshGradient).catch(() => () => null),
  { ssr: false, loading: () => null }
);

export const MONO_MESH = ["#080808", "#141414", "#1b1b1b", "#0b0b0b", "#101010"];

class ShaderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch { return false; }
}

/** A quiet local backdrop. CSS remains visible if the lazy shader is unavailable. */
export function MeshBackdrop({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "120px" });
  const reduce = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const [contextLost, setContextLost] = useState(false);

  useEffect(() => {
    const element = ref.current;
    const onVisibility = () => setVisible(!document.hidden);
    const onContextLost = () => setContextLost(true);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    element?.addEventListener("webglcontextlost", onContextLost, true);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      element?.removeEventListener("webglcontextlost", onContextLost, true);
    };
  }, []);

  useEffect(() => {
    if (!inView || reduce || ready || contextLost) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    // Let the page and its product image render before allocating a canvas.
    const timer = window.setTimeout(() => setReady(supportsWebGL()), 500);
    return () => window.clearTimeout(timer);
  }, [inView, reduce, ready, contextLost]);

  const moving = inView && visible && !reduce;
  return (
    <div
      ref={ref}
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      aria-hidden="true"
      style={{ contain: "paint" }}
    >
      <div className="axle-mesh-fallback" data-moving={moving ? "true" : "false"}>
        <div className="axle-mesh-blob axle-mesh-blob-a" />
        <div className="axle-mesh-blob axle-mesh-blob-b" />
        <div className="axle-mesh-blob axle-mesh-blob-c" />
      </div>
      {ready && !reduce && !contextLost ? (
        <div style={{ position: "absolute", inset: 0, opacity: 0.25 }}>
          <ShaderBoundary>
            <MeshGradient
              colors={MONO_MESH}
              speed={moving ? 0.09 : 0}
              distortion={0.55}
              swirl={0.3}
              grainMixer={0}
              grainOverlay={0}
              scale={1.5}
              rotation={18}
              fit="cover"
              width="100%"
              height="100%"
              minPixelRatio={0.5}
              maxPixelCount={700000}
              webGlContextAttributes={{ powerPreference: "low-power", antialias: false }}
              style={{ width: "100%", height: "100%" }}
            />
          </ShaderBoundary>
        </div>
      ) : null}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,transparent 35%,#090909 100%)" }} />
      <style>{`
        .axle-mesh-fallback { position: absolute; inset: 0; overflow: hidden; }
        .axle-mesh-blob { position: absolute; border-radius: 50%; background: radial-gradient(ellipse,rgba(255,255,255,.06),transparent 68%); animation: axle-mesh-drift 24s cubic-bezier(.16,1,.3,1) infinite alternate; animation-play-state: paused; }
        .axle-mesh-blob-a { width: 65%; height: 75%; left: -15%; top: -10%; }
        .axle-mesh-blob-b { width: 60%; height: 65%; right: -10%; top: 10%; animation-delay: -8s; }
        .axle-mesh-blob-c { width: 55%; height: 60%; left: 25%; bottom: -15%; animation-delay: -16s; opacity: .5; }
        .axle-mesh-fallback[data-moving="true"] .axle-mesh-blob { animation-play-state: running; }
        @keyframes axle-mesh-drift { from { transform: translate(-2%,0); } to { transform: translate(3%,4%); } }
        @media (prefers-reduced-motion: reduce) { .axle-mesh-blob { animation: none; } }
      `}</style>
    </div>
  );
}
