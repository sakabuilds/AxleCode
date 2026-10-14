import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/site/logo";
import { Reveal } from "@/components/fx/reveal";

export default function NotFound() {
  return (
    <section className="relative flex min-h-[78vh] items-center px-6 pt-36 pb-24 sm:pt-44">
      <div className="mx-auto w-full max-w-7xl">
        <Reveal>
          <div className="mb-10 flex items-center gap-4 text-mute">
            <LogoMark className="h-8 w-7" />
            <span className="h-5 w-px bg-white/15" />
            <span className="font-mono text-[11px] uppercase tracking-[0.16em]">404 / Page not found</span>
          </div>
          <h1 className="max-w-2xl text-[40px] font-medium leading-[1.08] tracking-[-0.045em] sm:text-[60px]">A little off the path.<br /><span className="text-mute">Let’s get you back.</span></h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-mute">This page may have moved, or the link may be incomplete. There’s plenty to build from here.</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button href="/"><ArrowLeft size={17} />Back to home</Button>
            <Button href="/docs" variant="secondary">Read the docs <ArrowUpRight size={17} /></Button>
          </div>
          <div className="mt-14 flex flex-wrap gap-6 border-t border-white/[0.08] pt-7 text-sm">
            <Link href="/features" className="text-mute transition-colors duration-[400ms] hover:text-paper">Explore features</Link>
            <Link href="/download" className="text-mute transition-colors duration-[400ms] hover:text-paper">Get the desktop app</Link>
            <Link href="/changelog" className="text-mute transition-colors duration-[400ms] hover:text-paper">What’s new</Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
