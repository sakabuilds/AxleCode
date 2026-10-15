"use client";

import { useState } from "react";
import { Section, SectionHead } from "@/components/site/section";
import { BillingToggle, PricingCards } from "@/components/site/pricing-card";
import { ComparisonTable } from "@/components/site/comparison";
import { Accordion } from "@/components/site/accordion";
import { Reveal } from "@/components/fx/reveal";
import { PRICING_FAQS } from "@/lib/catalog";

export function PricingBody() {
  const [annual, setAnnual] = useState(false);
  return (
    <>
      <Section className="!pt-5">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-5">
          <BillingToggle annual={annual} onChange={setAnnual} />
          <p className="text-xs text-mute">
            Start free. No Axle credit card required.
          </p>
        </div>
        <PricingCards annual={annual} />
        <p className="mt-7 max-w-3xl text-xs leading-6 text-mute">
          Free is available today. Pro and Team are planned offerings. Paid
          prices, features, and billing terms will be announced before sign-up
          opens.
        </p>
      </Section>
      <Section divider>
        <SectionHead
          eyebrow="All the details"
          title="Know what you're getting."
          copy="The core workspace is available today. Future paid plans will be described here when their details are ready."
        />
        <Reveal className="mt-12">
          <ComparisonTable />
        </Reveal>
      </Section>
      <Section divider>
        <div className="grid gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20">
          <SectionHead
            eyebrow="Good questions"
            title="A few things worth knowing."
            copy="A clear start, without the small print surprise."
          />
          <Reveal delay={0.08}>
            <Accordion items={PRICING_FAQS} />
          </Reveal>
        </div>
      </Section>
    </>
  );
}
