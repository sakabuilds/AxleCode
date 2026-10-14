"use client";

import { useState } from "react";
import { ArrowUpRight, Check, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { RevealGroup, RevealItem } from "@/components/fx/reveal";

export function BillingToggle({
  annual,
  onChange,
}: {
  annual: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div
      className="hairline inline-flex rounded-xl bg-[#101010] p-1"
      role="group"
      aria-label="Billing period"
    >
      {[
        { label: "Monthly", value: false },
        { label: "Annual", value: true },
      ].map((option) => (
        <button
          type="button"
          key={option.label}
          aria-pressed={annual === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-w-[105px] rounded-lg px-5 py-2.5 text-xs transition-colors duration-[400ms] ease-premium",
            annual === option.value
              ? "bg-paper text-ink"
              : "text-mute hover:text-paper",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function PricingCards({ annual }: { annual: boolean }) {
  return (
    <RevealGroup className="grid gap-4 lg:grid-cols-3">
      <RevealItem>
        <div className="hairline flex h-full flex-col rounded-[24px] bg-[#161616] p-7 sm:p-9">
          <div className="flex items-center justify-between">
            <h3 className="text-xl tracking-tight">Free</h3>
            <span className="rounded-full border border-white/15 px-2.5 py-1 font-mono text-[10px] text-paper">
              Available now
            </span>
          </div>
          <p className="mt-3 text-sm text-mute">
            For your next idea and the one after.
          </p>
          <div
            className="mt-9 flex min-h-[61px] items-baseline gap-2"
            aria-live="polite"
          >
            <span className="text-[54px] leading-none tracking-[-0.06em]">
              $0
            </span>
            <span className="text-sm text-mute">
              / {annual ? "year" : "month"}
            </span>
          </div>
          <p className="mt-4 text-xs text-mute">
            Model usage billed by your provider.
          </p>
          <Button href="/download" className="mt-8 w-full">
            Get Rivet <ArrowUpRight size={16} />
          </Button>
          <ul className="mt-8 space-y-4 border-t border-white/10 pt-7">
            {[
              "Your local projects and files",
              "Bring your own model keys",
              "Code, terminal, and Git tools",
              "Local model support",
              "MCP server connections",
            ].map((feature) => (
              <li
                key={feature}
                className="flex items-center gap-3 text-[13px] text-mute"
              >
                <Check size={15} className="shrink-0 text-paper" />
                {feature}
              </li>
            ))}
          </ul>
        </div>
      </RevealItem>
      {[
        {
          name: "Pro",
          tagline: "For a more individual way to work.",
          description:
            "A planned offering for developers who want more from their daily workspace.",
          focus: "Individual workflows",
        },
        {
          name: "Team",
          tagline: "For the work you build together.",
          description:
            "A planned offering shaped around the needs of teams building together.",
          focus: "Shared workflows",
        },
      ].map((tier) => (
        <RevealItem key={tier.name}>
          <div className="hairline flex h-full flex-col rounded-[24px] bg-[#101010] p-7 sm:p-9">
            <div className="flex items-center justify-between">
              <h3 className="text-xl tracking-tight">{tier.name}</h3>
              <span className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] text-mute">
                Planned
              </span>
            </div>
            <p className="mt-3 text-sm text-mute">{tier.tagline}</p>
            <div className="mt-9 flex min-h-[61px] items-center">
              <span className="text-[34px] tracking-[-0.04em]">
                Coming soon
              </span>
            </div>
            <p className="mt-4 text-xs text-mute" aria-live="polite">
              {annual ? "Annual" : "Monthly"} pricing to be announced.
            </p>
            <Button
              href="/company#contact"
              variant="secondary"
              className="mt-8 w-full"
            >
              Talk to us <ArrowUpRight size={16} />
            </Button>
            <p className="mt-8 min-h-20 border-t border-white/10 pt-7 text-[13px] leading-7 text-mute">
              {tier.description}
            </p>
            <ul className="mt-5 space-y-4">
              {[
                tier.focus,
                "Features to be announced",
                "No paid sign-up yet",
              ].map((feature) => (
                <li
                  className="flex items-center gap-3 text-[13px] text-mute"
                  key={feature}
                >
                  <Minus size={14} className="shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}

export function PricingTeaser() {
  const [annual, setAnnual] = useState(false);
  return (
    <div className="space-y-8">
      <BillingToggle annual={annual} onChange={setAnnual} />
      <PricingCards annual={annual} />
      <p className="text-xs leading-6 text-mute">
        Free is available today. Pro and Team are planned; paid prices and
        features have not been announced.
      </p>
    </div>
  );
}
