import type { Metadata } from "next";
import { ArrowUpRight, Check, ChevronDown, Code2, FileCode2, FolderOpen, GitBranch, History, ListChecks, LockKeyhole, Search, TerminalSquare } from "lucide-react";
import { PageHero } from "@/components/site/page-hero";
import { Section, SectionHead } from "@/components/site/section";
import { CTASection } from "@/components/site/cta-section";
import { RevealGroup, RevealItem } from "@/components/fx/reveal";
import { NoiseDisplace } from "@/components/fx/noise-displace";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FEATURE_DETAILS } from "@/lib/product-content";

export const metadata: Metadata = { title: "Features", description: "The capabilities behind Rivet: code context, file editing, terminal and Git tools, model choice, Plan mode, persistent threads, and remote access." };

function CodeVisual() {
  return <div className="flex min-h-[225px] overflow-hidden rounded-tl-xl border-l border-t border-white/10 bg-[#090909] font-mono text-[10px]">
    <div className="hidden w-36 shrink-0 border-r border-white/10 p-4 sm:block"><div className="mb-5 flex items-center gap-2 text-mute"><FolderOpen size={12}/>storefront</div>{["src", "  auth", "  components", "  routes", "tests", "package.json"].map((file,i)=><div key={file} className={"mb-3 whitespace-pre " + (i===1 ? "text-paper" : "text-mute")}>{file}</div>)}</div>
    <div className="min-w-0 flex-1"><div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-mute"><FileCode2 size={12}/> session.ts <span className="ml-auto text-[9px]">READING</span></div><div className="space-y-1 overflow-x-auto p-4 leading-6">{[["01","export async function refresh() {"],["02","  const session = await getSession();"],["03","  if (!session) return null;"],["04",""],["05","  return issueToken(session.user);"],["06","}"]].map(([line,code])=><div key={line} className="flex gap-4 whitespace-pre"><span className="text-white/30">{line}</span><span className={line==="05"?"text-paper":"text-mute"}>{code}</span></div>)}</div></div>
  </div>;
}

function ModelsVisual() {
  return <div className="mx-auto w-full max-w-xs rounded-xl border border-white/10 bg-[#0b0b0b] p-3"><div className="flex items-center justify-between px-2 pb-3 pt-1 font-mono text-[10px] text-mute">CHOOSE A PROVIDER <ChevronDown size={12}/></div>{["OpenAI","Anthropic","Google","OpenRouter"].map((provider,index)=><div key={provider} className={"flex items-center gap-3 rounded-lg px-3 py-3 text-xs " + (index===1 ? "bg-white/[.07]" : "text-mute")}><span className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 font-mono text-[10px]">{["O","A","G","↗"][index]}</span>{provider}{index===1&&<Check size={13} className="ml-auto"/>}</div>)}</div>;
}

function TerminalVisual() {
  return <div className="rounded-xl border border-white/10 bg-[#090909] px-4 py-4 font-mono text-[10px] leading-7"><div className="mb-3 flex items-center gap-2 text-mute"><TerminalSquare size={13}/>Terminal<span className="ml-auto">zsh</span></div><p>$ pnpm test</p><p className="text-mute">Running session.test.ts</p><p className="mt-3">✓ refreshes the session</p><p>✓ keeps the user signed in</p><div className="mt-4 border-t border-white/10 pt-3 text-mute">2 tests passed<span className="ml-2 inline-block h-3 w-1.5 translate-y-0.5 bg-white/60"/></div></div>;
}

function ApprovalVisual() {
  return <div className="rounded-xl border border-white/10 bg-[#090909] p-4"><div className="flex items-center gap-2 text-xs"><LockKeyhole size={14}/>Permission to proceed</div><p className="mt-3 text-[11px] leading-6 text-mute">Rivet wants to run a command in your project.</p><div className="mt-4 rounded-lg bg-white/[.04] px-3 py-3 font-mono text-[10px]">$ pnpm test</div><div className="mt-5 flex gap-2" aria-hidden="true"><span className="rounded-lg bg-white px-4 py-2 text-[10px] text-black">Allow once</span><span className="rounded-lg border border-white/15 px-4 py-2 text-[10px] text-mute">Decline</span></div></div>;
}

function ThreadsVisual() {
  return <div className="rounded-xl border border-white/10 bg-[#090909] p-4"><div className="mb-4 flex items-center gap-2 font-mono text-[10px] text-mute"><Search size={12}/>Find a conversation</div>{[{name:"Fix session refresh",time:"Just now",current:true},{name:"Review the checkout flow",time:"Yesterday"},{name:"Build account settings",time:"Monday"}].map(thread=><div key={thread.name} className={"flex items-start justify-between gap-2 rounded-lg px-3 py-3 " + (thread.current?"bg-white/[.06]":"")}><div><p className="text-[10px]">{thread.name}</p><p className="mt-1 text-[9px] text-mute">{thread.time}</p></div><History size={12} className="mt-1 shrink-0 text-mute"/></div>)}</div>;
}

const cards = [
  { title:"Your code is the context.", copy:"Read across files, follow the relevant details, and make changes inside your existing project.", icon:Code2, href:"/product", link:"Explore the workspace", span:"lg:col-span-2", visual:<CodeVisual/>, wide:true },
  { title:"The right model for the work.", copy:"Connect your own provider accounts. Keep choice close to the task.", icon:GitBranch, href:"/models", link:"Meet the models", span:"", visual:<ModelsVisual/> },
  { title:"A terminal that stays close.", copy:"Build, test, and inspect the output without breaking the flow.", icon:TerminalSquare, href:"/docs#cli", link:"Explore the tools", span:"", visual:<TerminalVisual/> },
  { title:"Your call, at every step.", copy:"Think first in Plan mode. Control approvals when it is time to act.", icon:ListChecks, href:"/docs#approvals", link:"Set your permissions", span:"", visual:<ApprovalVisual/> },
  { title:"Context worth coming back to.", copy:"Keep a local history of your work, organized in persistent threads.", icon:History, href:"/docs#projects", link:"Organize your projects", span:"", visual:<ThreadsVisual/> },
];

export default function FeaturesPage() {
  return <>
    <PageHero eyebrow="Features" title={<>Thoughtfully connected.<br/><span className="text-mute">Ready for real work.</span></>} copy="From the first question to the last test, Rivet gives you the tools to keep going. All in a workspace that feels like yours."/>
    <Section className="!pt-4">
      <RevealGroup className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map(({title,copy,icon:Icon,href,link,span,visual,wide})=><RevealItem key={title} className={span}><Card className="flex h-full flex-col overflow-hidden !rounded-[20px] !bg-[#101010]">
          <div className="p-7 sm:p-8"><Icon size={20} strokeWidth={1.5} className="mb-6 text-mute" aria-hidden="true"/><h2 className="text-xl font-medium tracking-[-.025em]">{title}</h2><p className="mt-3 max-w-md text-[13px] leading-6 text-mute">{copy}</p></div>
          <NoiseDisplace className={"relative mt-auto " + (wide ? "pl-7 sm:pl-8" : "px-7 sm:px-8")}>{visual}</NoiseDisplace>
          <a href={href} className="ease-premium mx-7 mt-6 flex items-center justify-between border-t border-white/10 py-5 text-xs text-mute transition-colors duration-[400ms] hover:text-white sm:mx-8">{link}<ArrowUpRight size={14}/></a>
        </Card></RevealItem>)}
      </RevealGroup>
      <p className="mt-4 font-mono text-[10px] text-mute-dim">Interface illustrations show example workflows.</p>
    </Section>
    <Section divider>
      <SectionHead eyebrow="The details" title={<>A capable workspace.<br/><span className="text-mute">Down to the little things.</span></>}/>
      <div className="mt-14">{FEATURE_DETAILS.map((group,index)=><div key={group.group} className="grid gap-7 border-t border-white/10 py-9 lg:grid-cols-[1fr_3fr] lg:gap-16"><div><span className="font-mono text-[10px] text-mute">0{index+1}</span><h3 className="mt-3 text-lg tracking-tight">{group.group}</h3></div><div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">{group.items.map(item=><div key={item.title}><h4 className="text-[13px] font-medium">{item.title}</h4><p className="mt-2 max-w-sm text-xs leading-6 text-mute">{item.copy}</p></div>)}</div></div>)}</div>
      <div className="mt-6 border-t border-white/10 pt-8"><Button href="/docs" variant="secondary">Go deeper in the docs <ArrowUpRight size={15}/></Button></div>
    </Section>
    <CTASection title="Everything you need to find your flow." copy="Download Rivet, connect a provider, and start with the work in front of you."/>
  </>;
}
