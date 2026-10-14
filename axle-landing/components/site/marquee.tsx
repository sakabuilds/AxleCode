import { cn } from "@/lib/cn";

export function Marquee({
  items,
  className,
  speed = 42,
}: {
  items: readonly string[];
  className?: string;
  speed?: number;
}) {
  const row = [...items, ...items];
  return (
    <div
      className={cn("group relative overflow-hidden", className)}
      style={{
        maskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)",
      }}
    >
      <div
        className="flex w-max items-center gap-14 will-change-transform group-hover:[animation-play-state:paused]"
        style={{ animation: "marquee-x " + speed + "s linear infinite" }}
      >
        {row.map((item, i) => (
          <span
            key={item + i}
            className="whitespace-nowrap text-[15px] font-medium tracking-[-0.01em] text-mute-dim transition-colors duration-[400ms] ease-premium hover:text-paper"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
