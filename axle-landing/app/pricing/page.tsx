import type { Metadata } from "next";
import { PageHero } from "@/components/site/page-hero";
import { PricingBody } from "@/components/site/pricing-body";
import { CTASection } from "@/components/site/cta-section";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Start with the free desktop app and your own model keys. Explore what's available today and the direction for Pro and Team.",
};

export default function PricingPage() {
  return (
    <>
      <PageHero
        eyebrow="A little less friction"
        title={
          <>
            Start with an idea.
            <br />
            <span className="text-mute">The workspace is on us.</span>
          </>
        }
        copy="Download Rivet for free. Bring your own model keys and pay your provider directly, or keep inference on your own machine."
      />
      <PricingBody />
      <CTASection
        title="Your next project starts here."
        copy="Get the free desktop app. Connect a model. Make something that matters to you."
      />
    </>
  );
}
