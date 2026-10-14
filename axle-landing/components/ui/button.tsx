import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
type ButtonProps={children:ReactNode;href?:string;variant?:"primary"|"secondary"|"ghost";size?:"md"|"lg";className?:string;type?:"button"|"submit";onClick?:()=>void;ariaLabel?:string;disabled?:boolean;target?:string};
export function Button({children,href,variant="primary",size="lg",className,type="button",onClick,ariaLabel,disabled,target}:ButtonProps) {
 const classes=cn("button","button-"+variant,"button-"+size,className);
 if(href)return <Link href={href} className={classes} aria-label={ariaLabel} target={target} rel={target==="_blank"?"noopener noreferrer":undefined}>{children}</Link>;
 return <button type={type} onClick={onClick} className={classes} aria-label={ariaLabel} disabled={disabled}>{children}</button>;
}
