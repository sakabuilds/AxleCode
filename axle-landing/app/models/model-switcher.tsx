"use client";

import { useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Folder,
  SlidersHorizontal,
} from "lucide-react";
import { MODEL_PROVIDERS } from "@/lib/catalog";
import { cn } from "@/lib/cn";

const DEMO_PROVIDERS = MODEL_PROVIDERS.filter((provider) =>
  ["openai", "anthropic", "gemini", "ollama"].includes(provider.id),
);

export function ModelSwitcher() {
  const [selected, setSelected] = useState(1);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const provider = DEMO_PROVIDERS[selected];
  return (
    <div className="hairline overflow-hidden rounded-[24px] bg-[#101010]">
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <span className="flex items-center gap-2 font-mono text-[11px] text-mute">
          <Folder size={14} /> your-next-project
        </span>
        <span className="hidden font-mono text-[11px] text-mute sm:block">
          A workspace with options
        </span>
        <SlidersHorizontal size={15} className="text-mute" />
      </div>
      <div className="grid md:grid-cols-[1fr_1.1fr]">
        <div className="p-7 sm:p-10 lg:p-14">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
            01 / Choose your intelligence
          </span>
          <h2 className="mt-7 max-w-sm text-[30px] leading-[1.15] tracking-[-0.04em] lg:text-[38px]">
            Different models.
            <br />
            Same place to think.
          </h2>
          <p className="mt-5 max-w-sm text-sm leading-7 text-mute">
            Explore a few of the providers you can connect. The model changes.
            Your project stays yours.
          </p>
          <div
            role="tablist"
            aria-label="Model provider preview"
            className="mt-9 flex flex-wrap gap-2"
          >
            {DEMO_PROVIDERS.map((item, index) => (
              <button
                key={item.id}
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                id={`provider-tab-${item.id}`}
                role="tab"
                type="button"
                aria-selected={selected === index}
                aria-controls="provider-panel"
                tabIndex={selected === index ? 0 : -1}
                onClick={() => setSelected(index)}
                onKeyDown={(event) => {
                  let next = index;
                  if (event.key === "ArrowRight")
                    next = (index + 1) % DEMO_PROVIDERS.length;
                  else if (event.key === "ArrowLeft")
                    next =
                      (index - 1 + DEMO_PROVIDERS.length) %
                      DEMO_PROVIDERS.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End")
                    next = DEMO_PROVIDERS.length - 1;
                  else return;
                  event.preventDefault();
                  setSelected(next);
                  tabRefs.current[next]?.focus();
                }}
                className={cn(
                  "rounded-lg border px-3.5 py-2.5 text-xs transition-colors duration-[400ms] ease-premium",
                  selected === index
                    ? "border-white/80 bg-paper text-ink"
                    : "border-white/10 text-mute hover:border-white/30 hover:text-paper",
                )}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-white/10 bg-[#0b0b0b] p-7 sm:p-10 md:border-l md:border-t-0 lg:p-12">
          <div
            role="tabpanel"
            id="provider-panel"
            aria-labelledby={`provider-tab-${provider.id}`}
            tabIndex={0}
            className="hairline mx-auto max-w-md rounded-2xl bg-[#121212] p-6"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.06] text-xl"
              >
                {provider.mark}
              </span>
              <div>
                <p className="text-sm font-medium">{provider.name}</p>
                <p className="mt-1 text-[11px] text-mute">
                  {provider.type === "Local"
                    ? "On your machine"
                    : "Your provider account"}
                </p>
              </div>
              <Check size={16} className="ml-auto text-paper" />
            </div>
            <div className="mt-7 border-t border-white/10 pt-5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-mute">
                Model family
              </p>
              <div className="mt-3 flex items-center justify-between rounded-lg border border-white/10 px-3 py-3 text-sm">
                {provider.family}
                <ChevronDown size={14} className="text-mute" />
              </div>
              <p className="mt-5 min-h-[72px] text-xs leading-6 text-mute">
                {provider.copy}
              </p>
            </div>
            <a
              href="/docs#providers"
              className="mt-4 flex items-center justify-between border-t border-white/10 pt-5 text-xs"
            >
              Connect {provider.name}
              <ArrowUpRight size={14} />
            </a>
          </div>
          <p className="mx-auto mt-4 max-w-md text-center font-mono text-[10px] text-mute">
            No request is sent in this preview.
          </p>
        </div>
      </div>
    </div>
  );
}
