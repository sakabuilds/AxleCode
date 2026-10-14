"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";

export function Accordion({
  items,
}: {
  items: readonly { q: string; a: string }[];
}) {
  const [open, setOpen] = useState<number | null>(0);
  const id = useId();
  return (
    <div className="divide-y divide-white/10 border-y border-white/10">
      {items.map((item, index) => {
        const isOpen = index === open;
        return (
          <div key={item.q}>
            <h3>
              <button
                type="button"
                id={`${id}-trigger-${index}`}
                aria-expanded={isOpen}
                aria-controls={`${id}-panel-${index}`}
                onClick={() => setOpen(isOpen ? null : index)}
                className="flex w-full items-center justify-between gap-6 py-6 text-left text-[15px] font-medium leading-6 transition-colors duration-[400ms] ease-premium hover:text-mute"
              >
                {item.q}
                <Plus
                  size={18}
                  className={cn(
                    "shrink-0 text-mute transition-transform duration-[400ms] ease-premium motion-reduce:transition-none",
                    isOpen && "rotate-45",
                  )}
                  aria-hidden="true"
                />
              </button>
            </h3>
            <div
              id={`${id}-panel-${index}`}
              aria-labelledby={`${id}-trigger-${index}`}
              hidden={!isOpen}
              role="region"
            >
              <p className="max-w-xl pb-7 pr-7 text-sm leading-7 text-mute">
                {item.a}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
