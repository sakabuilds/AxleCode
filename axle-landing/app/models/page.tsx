import type { Metadata } from "next";
import { ArrowUpRight, Check, Cpu, KeyRound, RefreshCw } from "lucide-react";
import { PageHero } from "@/components/site/page-hero";
import { Section, SectionHead, Eyebrow } from "@/components/site/section";
import { CTASection } from "@/components/site/cta-section";
import { Reveal, RevealGroup, RevealItem } from "@/components/fx/reveal";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MODEL_PROVIDERS } from "@/lib/catalog";
import { ModelSwitcher } from "./model-switcher";

export const metadata: Metadata = {
  title: "Models",
  description:
    "Your workspace, your choice of models. Connect OpenAI, Anthropic, Gemini, open model providers, or a local Ollama runtime.",
};

export default function ModelsPage() {
  return (
    <>
      <PageHero
        eyebrow="Your models. Your call."
        title={
          <>
            Intelligence is a choice.
            <br />
            <span className="text-mute">Keep yours open.</span>
          </>
        }
        copy="Some tasks need a different way of thinking. Bring the models you trust into one familiar place to build."
      >
        <Button href="/docs#providers" variant="secondary">
          Connect a provider <ArrowUpRight size={17} />
        </Button>
      </PageHero>
      <Section className="!pt-5">
        <Reveal>
          <ModelSwitcher />
        </Reveal>
        <p className="mt-5 text-center font-mono text-[11px] text-mute">
          Interactive preview · Select a provider to explore
        </p>
      </Section>
      <Section divider>
        <SectionHead
          eyebrow="A wider perspective"
          title="The right model is your decision."
          copy="A direct connection to your provider. Familiar tools around it. Model availability follows your account and each provider's current catalog."
        />
        <RevealGroup className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODEL_PROVIDERS.map((provider) => (
            <RevealItem key={provider.id}>
              <Card className="flex h-full flex-col p-7">
                <div className="flex items-start justify-between">
                  <span
                    className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-[24px] font-medium"
                    aria-hidden="true"
                  >
                    {provider.mark}
                  </span>
                  <span className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] text-mute">
                    {provider.type}
                  </span>
                </div>
                <h2 className="mt-7 text-xl font-medium tracking-[-0.025em]">
                  {provider.name}
                </h2>
                <p className="mt-1.5 font-mono text-[11px] text-mute">
                  {provider.family}
                </p>
                <p className="mt-5 flex-1 text-sm leading-7 text-mute">
                  {provider.copy}
                </p>
                <a
                  href="/docs#providers"
                  className="mt-7 flex items-center gap-2 text-xs text-paper transition-colors duration-[400ms] ease-premium hover:text-mute"
                >
                  Setup guide <ArrowUpRight size={14} />
                </a>
              </Card>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>
      <Section divider>
        <div className="grid gap-14 lg:grid-cols-2 lg:items-center">
          <Reveal>
            <Eyebrow>Same workspace. Different engine.</Eyebrow>
            <h2 className="mt-6 text-[36px] leading-[1.1] tracking-[-0.045em] sm:text-[48px]">
              Nothing between you
              <br />
              and your next idea.
            </h2>
            <p className="mt-6 max-w-lg text-base leading-8 text-mute">
              Choose a provider in Settings, add your key, and pick a model.
              Your projects and tools stay close at hand.
            </p>
            <Button className="mt-8" href="/docs#providers" variant="secondary">
              Read the model guide <ArrowUpRight size={16} />
            </Button>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="space-y-0 divide-y divide-white/10">
              {[
                {
                  icon: KeyRound,
                  title: "Your account. Your usage.",
                  copy: "Connect directly with your own provider key. Model costs are billed by your provider.",
                },
                {
                  icon: RefreshCw,
                  title: "Room to change your mind.",
                  copy: "Pick the provider and model for your next task from the same workspace.",
                },
                {
                  icon: Cpu,
                  title: "Local is an option, too.",
                  copy: "Connect Ollama on your machine or use a compatible endpoint you control.",
                },
              ].map(({ icon: Icon, title, copy }) => (
                <div className="flex gap-5 py-7 first:pt-0" key={title}>
                  <Icon size={21} className="mt-1 shrink-0 text-mute" />
                  <div>
                    <h3 className="text-lg tracking-tight">{title}</h3>
                    <p className="mt-2 max-w-md text-sm leading-7 text-mute">
                      {copy}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
        <div className="mt-14 flex flex-wrap gap-6 border-t border-white/10 pt-7 text-xs text-mute">
          {[
            "Provider keys you control",
            "Local inference supported",
            "No single model required",
          ].map((label) => (
            <span className="flex items-center gap-2" key={label}>
              <Check size={14} />
              {label}
            </span>
          ))}
        </div>
      </Section>
      <CTASection
        title="Good tools leave you a choice."
        copy="Connect the intelligence that works for you. Build from there."
      />
    </>
  );
}
