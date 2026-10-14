"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { DOC_INDEX } from "@/lib/docs";

export function DocsSearch() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return DOC_INDEX.filter((item) =>
      terms.every((term) =>
        `${item.title} ${item.section} ${item.keywords}`
          .toLowerCase()
          .includes(term),
      ),
    );
  }, [query]);
  function openSearch() {
    dialogRef.current?.showModal();
    inputRef.current?.focus();
  }
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (dialogRef.current?.open) dialogRef.current.close();
        else {
          dialogRef.current?.showModal();
          inputRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
  return (
    <>
      <button
        type="button"
        onClick={openSearch}
        aria-haspopup="dialog"
        className="hairline flex w-full items-center gap-3 rounded-xl bg-[#101010] px-3.5 py-3 text-left text-xs text-mute transition-colors duration-[400ms] ease-premium hover:border-white/25"
      >
        <Search size={15} />
        <span className="flex-1">Search docs</span>
        <kbd className="rounded border border-white/10 px-1 py-0.5 font-mono text-[9px]">
          ⌘ K
        </kbd>
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="docs-search-title"
        className="hairline fixed inset-0 m-auto w-[calc(100%_-_32px)] max-w-xl overflow-hidden rounded-[20px] bg-[#121212] p-0 text-paper backdrop:bg-black/80"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const box = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < box.left ||
              event.clientX > box.right ||
              event.clientY < box.top ||
              event.clientY > box.bottom
            )
              dialogRef.current?.close();
          }
        }}
      >
        <h2 id="docs-search-title" className="sr-only">
          Search documentation
        </h2>
        <div className="flex items-center gap-3 border-b border-white/10 p-4 sm:px-6">
          <Search size={18} className="shrink-0 text-mute" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search documentation"
            placeholder="What would you like to know?"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-paper outline-none placeholder:text-mute"
          />
          <button
            onClick={() => dialogRef.current?.close()}
            type="button"
            aria-label="Close documentation search"
            className="rounded-lg p-2 text-mute hover:text-paper"
          >
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-3" data-lenis-prevent>
          <p
            className="px-3 py-2 font-mono text-[10px] text-mute"
            aria-live="polite"
          >
            {query ? `${results.length} results` : "Explore the documentation"}
          </p>
          <ul>
            {results.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={() => dialogRef.current?.close()}
                  className="flex items-center gap-4 rounded-xl px-3 py-3.5 transition-colors duration-[400ms] ease-premium hover:bg-white/[0.05]"
                >
                  <div className="flex-1">
                    <span className="text-sm">{item.title}</span>
                    <span className="mt-1 block text-[11px] text-mute">
                      {item.section}
                    </span>
                  </div>
                  <ArrowUpRight size={15} className="text-mute" />
                </a>
              </li>
            ))}
          </ul>
          {results.length === 0 && (
            <div className="px-6 py-12 text-center">
              <p className="text-sm">No results for “{query}”.</p>
              <p className="mt-2 text-xs text-mute">
                Try “models”, “install”, or “MCP”.
              </p>
              <button
                type="button"
                className="mt-5 text-xs underline underline-offset-4"
                onClick={() => setQuery("")}
              >
                Clear search
              </button>
            </div>
          )}
        </div>
        <div className="border-t border-white/10 px-6 py-3 font-mono text-[10px] text-mute">
          Tab to browse · Enter to open · Esc to close
        </div>
      </dialog>
    </>
  );
}
