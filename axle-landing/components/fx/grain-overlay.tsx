const grain = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 180 180'%3E%3Cfilter id='grain'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23grain)'/%3E%3C/svg%3E";

/** A repeated static SVG: no animation, oversized layer, or WebGL. */
export function GrainOverlay() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed", inset: 0, zIndex: 60, pointerEvents: "none", opacity: 0.03,
        backgroundImage: 'url("' + grain + '")',
        backgroundRepeat: "repeat", backgroundSize: "180px 180px",
      }}
    />
  );
}
