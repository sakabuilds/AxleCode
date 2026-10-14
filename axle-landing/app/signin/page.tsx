import type { Metadata } from "next";
import { ArrowUpRight, Download, FolderOpen, LogIn, SlidersHorizontal } from "lucide-react";
import { LogoMark } from "@/components/site/logo";
import { Button } from "@/components/ui/button";
import { Reveal, RevealGroup, RevealItem } from "@/components/fx/reveal";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Open the desktop app to sign in and connect your workspace, models, and tools.",
};

const steps = [
  { icon: FolderOpen, title: "Open the desktop app", copy: "Launch Axle on your computer. Current desktop builds use the Axle project name." },
  { icon: LogIn, title: "Choose Sign in", copy: "Start authentication from the app and follow the sign-in prompts. When your browser opens, complete the flow to return to your workspace." },
  { icon: SlidersHorizontal, title: "Connect your models", copy: "Open Settings → Models to configure a provider. Model-provider accounts and API keys are managed separately." },
];

export default function SignInPage() {
  return (
    <section className="relative px-6 pt-36 pb-24 sm:pt-44 sm:pb-32">
      <div className="mx-auto grid max-w-7xl items-start gap-14 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
        <div className="lg:pt-6">
          <Reveal><LogoMark className="mb-10 h-12 w-11 text-white/90" /></Reveal>
          <Reveal delay={0.05}><p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">Welcome back</p></Reveal>
          <Reveal delay={0.1}>
            <h1 className="mt-6 max-w-xl text-[38px] font-medium leading-[1.08] tracking-[-0.045em] sm:text-[52px]">Your workspace starts <span className="text-mute">on your desktop.</span></h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-mute">Open the app to sign in and pick up where you left off. Your projects, conversations, and connected tools are waiting there.</p>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button href="/download"><Download size={17} />Get the desktop app</Button>
              <Button href="/docs#models" variant="secondary">Model setup <ArrowUpRight size={17} /></Button>
            </div>
            <p className="mt-6 text-xs leading-6 text-mute">Already installed? Launch Axle from your applications.</p>
          </Reveal>
        </div>

        <RevealGroup className="overflow-hidden rounded-[28px] border border-white/[0.09] bg-white/[0.018]">
          <div className="border-b border-white/[0.07] px-7 py-6 sm:px-9">
            <p className="text-sm font-medium">Back to building, in a few steps.</p>
          </div>
          {steps.map((step, index) => (
            <RevealItem key={step.title}>
              <div className={"flex gap-5 px-7 py-8 sm:px-9" + (index < steps.length - 1 ? " border-b border-white/[0.07]" : "")}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.025] text-mute">
                  <step.icon size={18} strokeWidth={1.5} />
                </div>
                <div>
                  <span className="font-mono text-[10px] text-mute">0{index + 1}</span>
                  <h2 className="mt-1 text-base font-medium tracking-[-0.02em]">{step.title}</h2>
                  <p className="mt-3 text-sm leading-6 text-mute">{step.copy}</p>
                </div>
              </div>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
