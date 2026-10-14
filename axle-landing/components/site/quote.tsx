import { TESTIMONIALS } from "@/lib/content";
import { cn } from "@/lib/cn";
import { Reveal } from "@/components/fx/reveal";

export function QuoteBlock({ className }: { className?: string }) {
  const item = TESTIMONIALS[0];
  return (
    <Reveal className={className}>
      <figure className="hairline relative overflow-hidden rounded-2xl bg-white/[0.015] p-8 sm:p-12">
        <svg viewBox="0 0 24 24" className="h-8 w-8 text-white/12" aria-hidden="true">
          <path d="M9.4 5.5C6.3 6.9 4.5 9.6 4.5 12.9c0 3.1 1.8 5.6 4.4 5.6 2 0 3.5-1.5 3.5-3.5s-1.4-3.4-3.2-3.4c-.4 0-.8.1-1 .2.3-1.6 1.6-3 3.3-3.8l-2.1-2.5zM19 5.5c-3.1 1.4-4.9 4.1-4.9 7.4 0 3.1 1.8 5.6 4.4 5.6 2 0 3.5-1.5 3.5-3.5s-1.4-3.4-3.2-3.4c-.4 0-.8.1-1 .2.3-1.6 1.6-3 3.3-3.8L19 5.5z" fill="currentColor" />
        </svg>
        <blockquote className="mt-6 max-w-3xl text-balance text-[21px] font-medium leading-[1.4] tracking-[-0.02em] sm:text-[27px]">
          {item.quote}
        </blockquote>
        <figcaption className="mt-8 flex items-center gap-3">
          <span className="hairline flex h-9 w-9 items-center justify-center rounded-full font-mono text-[12px] text-mute">
            {item.name.split(" ").map((part) => part[0]).join("")}
          </span>
          <span className="flex flex-col">
            <span className="text-[13.5px] font-medium text-paper">{item.name}</span>
            <span className="text-[13px] text-mute">{item.role}</span>
          </span>
        </figcaption>
      </figure>
    </Reveal>
  );
}

export function QuoteRow({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-4 lg:grid-cols-3", className)}>
      {TESTIMONIALS.map((item, i) => (
        <Reveal key={item.name} delay={i * 0.07}>
          <figure className="hairline flex h-full flex-col justify-between rounded-2xl bg-white/[0.015] p-6">
            <blockquote className="text-[14.5px] leading-relaxed text-mute">{item.quote}</blockquote>
            <figcaption className="mt-6 border-t border-white/[0.06] pt-4">
              <span className="block text-[13.5px] font-medium text-paper">{item.name}</span>
              <span className="block text-[12.5px] text-mute-dim">{item.role}</span>
            </figcaption>
          </figure>
        </Reveal>
      ))}
    </div>
  );
}
