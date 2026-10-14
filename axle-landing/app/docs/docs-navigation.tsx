"use client";

import { useEffect, useState } from "react";
import { DOC_SECTIONS, ON_THIS_PAGE } from "@/lib/docs";
import { cn } from "@/lib/cn";

export function DocsNavigation({ contents = false }: { contents?: boolean }) {
  const [active, setActive] = useState("overview");
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-110px 0px -60% 0px", threshold: 0 },
    );
    ON_THIS_PAGE.forEach((link) => {
      const element = document.getElementById(link.href.slice(1));
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);
  if (contents)
    return (
      <nav aria-label="On this page">
        <p className="mb-5 text-xs font-medium">On this page</p>
        <ul className="space-y-3 border-l border-white/10">
          {ON_THIS_PAGE.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                aria-current={
                  active === link.href.slice(1) ? "location" : undefined
                }
                className={cn(
                  "-ml-px block border-l pl-4 text-[11px] leading-5 transition-colors duration-[400ms] ease-premium hover:text-paper",
                  active === link.href.slice(1)
                    ? "border-paper text-paper"
                    : "border-transparent text-mute",
                )}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    );
  return (
    <nav aria-label="Documentation sections" className="space-y-7">
      {DOC_SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="mb-3 px-3 text-[11px] font-medium">{section.title}</p>
          <ul className="space-y-0.5">
            {section.links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  aria-current={
                    active === link.href.split("#")[1] ? "location" : undefined
                  }
                  className={cn(
                    "block rounded-lg px-3 py-2 text-xs transition-colors duration-[400ms] ease-premium hover:bg-white/[0.04] hover:text-paper",
                    active === link.href.split("#")[1]
                      ? "bg-white/[0.06] text-paper"
                      : "text-mute",
                  )}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
