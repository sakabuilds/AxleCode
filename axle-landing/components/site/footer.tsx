import Link from "next/link";
import {ArrowUpRight,Code2} from "lucide-react";
import {Logo} from "./logo";
import {FOOTER_GROUPS} from "@/lib/nav";
import {SITE} from "@/lib/site";
export function Footer(){return <footer className="site-footer"><div className="site-container"><div className="footer-top"><div className="footer-intro"><Link href="/" aria-label="Rivet home"><Logo/></Link><p>A little less friction.<br/>A lot more possibility.</p><a href={SITE.github} target="_blank" rel="noopener noreferrer" className="footer-source"><Code2 size={16}/>Built in the open<ArrowUpRight size={14}/></a></div><div className="footer-links">{FOOTER_GROUPS.map(group=><div key={group.title}><h3>{group.title}</h3>{group.links.map(link=><Link href={link.href} key={link.label}>{link.label}</Link>)}</div>)}</div></div><div className="footer-wordmark" aria-hidden="true">rivet<span>®</span></div><div className="footer-bottom"><p>© 2026 Rivet. Made for the way you build.</p><div><span className="status-dot"/>Your workspace. Your rules.</div><a href="#top">Back to top ↑</a></div></div></footer>;}

