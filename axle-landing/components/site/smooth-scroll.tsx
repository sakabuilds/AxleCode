"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { DUR, easeOut } from "@/lib/motion";

export function SmoothScroll({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const instance = useRef<Lenis | null>(null);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let dispose = () => {};

    function setup() {
      dispose();
      dispose = () => {};
      if (preference.matches) {
        instance.current = null;
        return;
      }

      gsap.registerPlugin(ScrollTrigger);
      const lenis = new Lenis({
        duration: DUR.base,
        easing: easeOut,
        smoothWheel: true,
        syncTouch: false,
        anchors: false,
        stopInertiaOnNavigate: true,
        allowNestedScroll: true,
        prevent: (node) => node.hasAttribute("data-lenis-prevent") || node.closest('[role="dialog"], dialog, textarea, select') !== null,
      });
      instance.current = lenis;
      lenis.on("scroll", ScrollTrigger.update);
      const tick = (seconds: number) => lenis.raf(seconds * 1000);
      gsap.ticker.add(tick);

      // Native keyboard, touch, browser history, and Next Link navigation remain intact.
      const syncNativePosition = () => {
        lenis.resize();
        lenis.scrollTo(window.scrollY, { immediate: true });
        ScrollTrigger.refresh();
      };
      window.addEventListener("hashchange", syncNativePosition);
      window.addEventListener("popstate", syncNativePosition);

      // Plain in-page anchors can animate while retaining a real URL and focus target.
      const onAnchorClick = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
        if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
        const url = new URL(anchor.href, window.location.href);
        if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || url.search !== window.location.search || !url.hash) return;
        let id: string;
        try { id = decodeURIComponent(url.hash.slice(1)); } catch { return; }
        const target = document.getElementById(id);
        if (!target) return;
        event.preventDefault();
        if (window.location.hash !== url.hash) window.history.pushState(window.history.state, "", url.hash);
        const margin = Number.parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0;
        lenis.scrollTo(target, {
          offset: -margin,
          duration: DUR.base,
          easing: easeOut,
          onComplete: () => {
            const hadTabIndex = target.hasAttribute("tabindex");
            if (!hadTabIndex) target.setAttribute("tabindex", "-1");
            target.focus({ preventScroll: true });
            if (!hadTabIndex) {
              target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
            }
          },
        });
      };
      document.addEventListener("click", onAnchorClick);

      dispose = () => {
        gsap.ticker.remove(tick);
        window.removeEventListener("hashchange", syncNativePosition);
        window.removeEventListener("popstate", syncNativePosition);
        document.removeEventListener("click", onAnchorClick);
        lenis.destroy();
        if (instance.current === lenis) instance.current = null;
      };
    }

    setup();
    preference.addEventListener("change", setup);
    return () => {
      preference.removeEventListener("change", setup);
      dispose();
    };
  }, []);

  useEffect(() => {
    // Refresh after Next has committed the new page and applied its scroll restoration.
    const frame = requestAnimationFrame(() => {
      if (!instance.current) return;
      instance.current.resize();
      instance.current.scrollTo(window.scrollY, { immediate: true });
      ScrollTrigger.refresh();
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return <>{children}</>;
}
