"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

export function CodeBlock({
  code,
  label = "Terminal",
  className,
}: {
  code: string[];
  label?: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  async function copyCode() {
    let copied = false;
    try {
      await navigator.clipboard.writeText(code.join("\n"));
      copied = true;
    } catch {
      const area = document.createElement("textarea");
      area.value = code.join("\n");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      } finally {
        area.remove();
      }
    }
    setStatus(copied ? "copied" : "error");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 2500);
  }
  return (
    <div
      className={cn(
        "hairline overflow-hidden rounded-2xl bg-[#111111]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
        <span className="font-mono text-[11px] text-mute">{label}</span>
        <button
          type="button"
          onClick={copyCode}
          aria-label={`Copy ${label} code`}
          className="flex items-center gap-2 rounded-md px-2 py-1 text-[11px] text-mute transition-colors duration-[400ms] ease-premium hover:text-paper"
        >
          {status === "copied" ? <Check size={13} /> : <Copy size={13} />}
          <span aria-live="polite">
            {status === "copied"
              ? "Copied"
              : status === "error"
                ? "Select to copy"
                : "Copy"}
          </span>
        </button>
      </div>
      <pre
        tabIndex={0}
        className="overflow-x-auto p-5 font-mono text-[12px] leading-[1.9] text-[#c8c8c8]"
        data-lenis-prevent
      >
        <code>{code.join("\n")}</code>
      </pre>
    </div>
  );
}
