import type { Metadata } from "next";
import { ArrowUpRight, Cable, Fingerprint, Terminal } from "lucide-react";
import { PageHero } from "@/components/site/page-hero";
import { Section, SectionHead } from "@/components/site/section";
import { CTASection } from "@/components/site/cta-section";
import { IntegrationExplorer } from "@/components/site/integration-explorer";
import { Reveal, RevealGroup, RevealItem } from "@/components/fx/reveal";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Integrations",
  description:
    "Bring your tools into the conversation. Local files and Git, plus MCP connections for the context your work needs.",
};

export default function IntegrationsPage() {
  return (
    <>
      <PageHero
        eyebrow="Better, together"
        title={
          <>
            Your tools.
            <br />
            <span className="text-mute">Now in the conversation.</span>
          </>
        }
        copy="Great work happens across more than one app. Connect the context you need, from your local terminal to your team's knowledge."
      >
        <Button href="/docs#integrations" variant="secondary">
          Explore MCP connections <ArrowUpRight size={16} />
        </Button>
      </PageHero>
      <Section id="directory" className="!pt-5">
        <IntegrationExplorer />
      </Section>
      <Section divider>
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-20">
          <SectionHead
            eyebrow="An open connection"
            title="Made for the tools you already use."
            copy="Model Context Protocol gives your workspace a common language for tools. Add a server that fits your workflow, with the access you choose."
          />
          <Reveal>
            <div className="hairline rounded-[24px] bg-[#101010] p-7 sm:p-10">
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 font-medium">
                  R
                </span>
                <span className="h-px flex-1 bg-white/15" />
                <span className="rounded-full border border-white/15 px-4 py-2 font-mono text-xs">
                  MCP
                </span>
                <span className="h-px flex-1 bg-white/15" />
                <Cable className="m-3 text-mute" size={25} />
              </div>
              <p className="mt-10 text-xl tracking-tight">
                One protocol. More possibilities.
              </p>
              <p className="mt-3 text-sm leading-7 text-mute">
                Remote HTTP endpoints or local stdio servers. The connection
                provides the tools; your thread brings them into the work.
              </p>
              <a
                className="mt-7 inline-flex items-center gap-2 text-sm"
                href="/docs#integrations"
              >
                Set up your first connection <ArrowUpRight size={15} />
              </a>
            </div>
          </Reveal>
        </div>
        <RevealGroup className="mt-16 grid gap-4 md:grid-cols-3">
          {[
            {
              icon: Terminal,
              title: "Start close to the code",
              copy: "Files, Git, and your terminal are already part of the local workspace.",
            },
            {
              icon: Fingerprint,
              title: "Connect with intention",
              copy: "Use the credentials and permissions appropriate for the server you connect.",
            },
            {
              icon: Cable,
              title: "Make it your own",
              copy: "Bring an existing MCP server or build one around your internal tools.",
            },
          ].map(({ icon: Icon, title, copy }) => (
            <RevealItem key={title}>
              <Card className="h-full p-7">
                <Icon size={22} className="text-mute" />
                <h2 className="mt-6 text-lg tracking-tight">{title}</h2>
                <p className="mt-3 text-sm leading-7 text-mute">{copy}</p>
              </Card>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>
      <CTASection
        title="Less context switching. More building."
        copy="Bring your project, your models, and the tools that make your workflow yours."
      />
    </>
  );
}
