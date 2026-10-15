import type { Metadata } from "next";
import { ArrowUpRight, Check, ChevronRight, FileCode2, FolderOpen, GitBranch, Laptop, Search, ShieldCheck, TerminalSquare } from "lucide-react";
import { PageHero } from "@/components/site/page-hero";
import { Section, SectionHead } from "@/components/site/section";
import { CTASection } from "@/components/site/cta-section";
import { StickySteps } from "@/components/site/sticky-steps";
import { AppWindow } from "@/components/site/app-window";
import { Reveal } from "@/components/fx/reveal";
import { Parallax } from "@/components/fx/parallax";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PRODUCT_STEPS } from "@/lib/product-content";

export const metadata: Metadata = { title: "Product", description: "Meet Axle, a local AI development workspace that brings your code, chats, pull requests, cloud jobs, plugins, schedules, and models into one connected workflow." };

function ContextPanel() {
  return <div className="p-6 sm:p-8">
    <div className="flex items-center gap-3 text-sm"><FolderOpen size={18} className="text-mute" /><span>storefront</span><span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-mute"><GitBranch size={12} /> main</span></div>
    <div className="hairline mt-6 rounded-xl bg-[#080808] px-4 py-3 text-[13px] leading-6 text-mute">Why does the session expire after a refresh?</div>
    <div className="mt-6 flex items-center gap-2 text-xs text-mute"><Search size={14} /> Reading the session flow</div>
    <div className="mt-4 space-y-1.5">{["src/auth/session.ts", "src/auth/middleware.ts", "tests/session.test.ts"].map((file, index) => <div key={file} className="flex items-center gap-3 rounded-lg bg-white/[.025] px-3 py-3 font-mono text-[11px]"><FileCode2 size={15} className="text-mute" /><span className="min-w-0 truncate">{file}</span><span className="ml-auto text-mute">{index === 2 ? "test" : "read"}</span></div>)}</div>
    <p className="mt-6 text-xs leading-6 text-mute">The refresh path is returning the previous token. I found the relevant handler and its tests.</p>
  </div>;
}

function PlanPanel() {
  return <div className="p-6 sm:p-8">
    <div className="flex items-center justify-between"><span className="text-sm">Fix session refresh</span><span className="hairline rounded-md px-2 py-1 font-mono text-[9px] text-mute">PLAN MODE</span></div>
    <p className="mt-4 text-xs leading-6 text-mute">A small change, with a regression test to cover it.</p>
    <div className="mt-7 space-y-5">{["Read the refresh handler and token lifecycle", "Return the newly issued session token", "Add a test for consecutive refreshes", "Run the session test suite"].map((item, index) => <div key={item} className="flex items-start gap-3 text-[12px] leading-6"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 font-mono text-[10px] text-mute">{index + 1}</span>{item}</div>)}</div>
    <div className="mt-7 flex items-start gap-3 rounded-xl border border-white/10 bg-white/[.025] px-4 py-3 text-[11px] leading-5 text-mute"><ShieldCheck size={16} className="mt-0.5 shrink-0" />Read-only exploration. Move to an editing mode when you are ready.</div>
  </div>;
}

function BuildPanel() {
  return <div className="p-6 sm:p-8">
    <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-xs"><FileCode2 size={15} /> session.ts</span><span className="font-mono text-[10px] text-mute">Changes</span></div>
    <div className="mt-6 overflow-x-auto rounded-xl border border-white/10 bg-[#080808] p-4 font-mono text-[11px] leading-7"><div className="text-mute">  async function refresh() {"{"}</div><div className="text-mute line-through decoration-white/30">−   return currentToken;</div><div className="bg-white/[.055]">+   const token = await issueToken();</div><div className="bg-white/[.055]">+   return token;</div><div className="text-mute">  {"}"}</div></div>
    <div className="mt-5 rounded-xl border border-white/10 bg-[#080808] p-4 font-mono text-[10px] leading-6"><div className="flex items-center gap-2 text-mute"><TerminalSquare size={13} /> Terminal</div><div className="mt-2">$ pnpm test session</div><div className="mt-2 flex items-center gap-2"><Check size={12} /> session refresh</div><div className="flex items-center gap-2"><Check size={12} /> consecutive refreshes</div><div className="mt-2 text-mute">Tests passed · exit 0</div></div>
  </div>;
}

function ContinuePanel() {
  return <div className="p-6 sm:p-8">
    <div className="flex items-center justify-between text-sm"><span>Your workspace</span><Laptop size={18} className="text-mute" /></div>
    <div className="mt-6 rounded-xl border border-white/10 bg-[#080808] p-4"><div className="mb-4 flex items-center gap-2 font-mono text-[10px] text-mute"><FolderOpen size={13} /> storefront</div>{["Fix session refresh", "Explore checkout flow", "Add an account settings page"].map((thread, index) => <div key={thread} className={"flex items-center justify-between gap-3 rounded-lg px-3 py-3 text-[11px] " + (index === 0 ? "bg-white/[.07] text-paper" : "text-mute")}><span>{thread}</span>{index === 0 ? <Check size={13} /> : <ChevronRight size={13} />}</div>)}</div>
    <div className="mt-6 flex items-center gap-3 rounded-xl border border-white/10 px-4 py-4"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[.06]"><Laptop size={17} /></span><div><p className="text-xs">This computer</p><p className="mt-1 text-[10px] text-mute">Your projects and conversations, saved locally.</p></div></div>
    <p className="mt-5 text-[11px] leading-6 text-mute">Close the app. Come back tomorrow. The context is still here.</p>
  </div>;
}

export default function ProductPage() {
  return <>
    <PageHero eyebrow="Meet Axle" title={<>One workspace.<br /><span className="text-mute">From thought to working code.</span></>} copy="A place to think through the problem, make the change, and see it work. Axle brings AI development home to your computer.">
      <div className="flex flex-wrap gap-3"><Button href="/download">Get Axle <ArrowUpRight size={16} /></Button><Button href="#walkthrough" variant="secondary">See how it works</Button></div>
    </PageHero>
    <Section className="!py-10">
      <div className="grid gap-6 border-y border-white/10 py-7 sm:grid-cols-3">{[{icon: Laptop,title:"Runs on your computer",copy:"macOS, Windows, and Linux"},{icon: GitBranch,title:"Fits your workflow",copy:"Your files, terminal, and Git"},{icon: ShieldCheck,title:"Keeps you in control",copy:"Your models and approval settings"}].map(({icon:Icon,title,copy})=><div key={title} className="flex items-start gap-3"><Icon size={18} className="mt-0.5 text-mute" strokeWidth={1.5}/><div><p className="text-[13px]">{title}</p><p className="mt-1 text-xs text-mute">{copy}</p></div></div>)}</div>
    </Section>
    <Section id="walkthrough" className="scroll-mt-24 !pt-14">
      <StickySteps steps={PRODUCT_STEPS} panels={[<ContextPanel key="context" />,<PlanPanel key="plan" />,<BuildPanel key="build" />,<ContinuePanel key="continue" />]} />
      <p className="mt-4 text-right font-mono text-[10px] text-mute-dim">Illustrative workflow · session refresh example</p>
    </Section>
    <Section divider>
      <SectionHead
        eyebrow="An interactive preview"
        title={<>Ask for something.<br /><span className="text-mute">See where the work lands.</span></>}
        copy="This is the real layout: your projects and chats on the left, the conversation in the middle, and the controls you need along the bottom. Nothing here reaches a model."
      />
      <Reveal className="mt-14"><AppWindow /></Reveal>
      <p className="mt-4 text-center font-mono text-[10px] text-mute-dim">Interactive preview · no project is opened and no request is sent</p>
    </Section>
    <Section divider>
      <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-24">
        <SectionHead eyebrow="Built around your environment" title={<>Everything connects.<br /><span className="text-mute">You stay in the flow.</span></>} copy="Your editor, terminal, repository, and model provider each have a job. Axle brings the work between them into one conversation."><Button href="/integrations" variant="ghost" className="!px-0">Explore integrations <ArrowUpRight size={16} /></Button></SectionHead>
        <Reveal><Parallax><Card className="overflow-hidden !rounded-[20px] !bg-[#101010] p-8 sm:p-12"><div className="mx-auto flex max-w-sm flex-col items-center"><div className="hairline flex h-16 w-36 items-center justify-center gap-2 rounded-xl bg-[#171717] text-lg font-medium tracking-tight"><span className="text-mute">↗</span> Axle</div><div className="h-12 w-px bg-white/20"/><div className="h-6 w-[74%] rounded-t-xl border-x border-t border-white/20"/><div className="grid w-full grid-cols-3 gap-3">{[{icon:FileCode2,label:"Your code"},{icon:TerminalSquare,label:"Your tools"},{icon:ShieldCheck,label:"Your models"}].map(({icon:Icon,label})=><div key={label} className="hairline flex flex-col items-center gap-4 rounded-xl bg-[#0b0b0b] px-2 py-5"><Icon size={22} strokeWidth={1.25}/><span className="text-center text-[10px] text-mute sm:text-xs">{label}</span></div>)}</div><p className="mt-9 text-center text-xs leading-6 text-mute">Familiar tools. One connected workspace.</p></div></Card></Parallax></Reveal>
      </div>
    </Section>
    <CTASection title="Your next idea deserves a workspace." copy="Bring a project, connect a model, and make something that works." />
  </>;
}
