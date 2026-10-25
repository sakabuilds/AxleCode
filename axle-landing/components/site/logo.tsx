import { cn } from "@/lib/cn";
export function LogoMark({ className }: { className?: string }) {
 return <svg viewBox="0 0 32 36" className={cn("h-8 w-7",className)} aria-hidden="true" focusable="false"><path fill="currentColor" d="m12.1 4.7-4.5 8.8c-1 1.9.8 3.5 2.7 2.6l12-5.8-2.9-5.6c-1.5-3-5.8-3-7.3 0ZM7.1 21.3 23.9 13l7.2 14.1c2.3 4.5-2.7 9-6.9 6.2l-7.1-4.7-8.3 4.8c-4.4 2.5-9.1-2.1-6.6-6.5l2.3-4.1c.6-.8 1.4-1.2 2.6-1.5Z"/></svg>;
}
export function Logo({className,showWordmark=true}:{className?:string;showWordmark?:boolean}) {
 return <span className={cn("inline-flex items-center gap-2.5 text-paper",className)}><LogoMark/>{showWordmark&&<span className="text-[20px] font-semibold tracking-[-0.8px]">Axle</span>}</span>;
}