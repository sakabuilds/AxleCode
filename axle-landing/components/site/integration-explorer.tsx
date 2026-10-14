"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { INTEGRATION_CATALOG } from "@/lib/catalog";
import { cn } from "@/lib/cn";

const CATEGORIES = [
  "All tools",
  "Code",
  "Development",
  "Design",
  "Planning",
  "Knowledge",
];

export function IntegrationExplorer() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All tools");
  const [selected, setSelected] = useState<
    (typeof INTEGRATION_CATALOG)[number] | null
  >(null);
  const detailRef = useRef<HTMLDialogElement>(null);
  const results = useMemo(
    () =>
      INTEGRATION_CATALOG.filter(
        (item) =>
          (category === "All tools" || category === item.category) &&
          `${item.name} ${item.description} ${item.kind} ${item.category}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [query, category],
  );
  function clearFilters() {
    setQuery("");
    setCategory("All tools");
  }
  return (
    <>
      <div className="flex flex-col gap-6 border-b border-white/10 pb-8 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Filter integrations by category"
        >
          {CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
              className={cn(
                "rounded-lg px-3.5 py-2.5 text-xs transition-colors duration-[400ms] ease-premium",
                item === category
                  ? "bg-paper text-ink"
                  : "text-mute hover:bg-white/[0.04] hover:text-paper",
              )}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="relative w-full lg:max-w-[280px]">
          <Search
            size={16}
            aria-hidden="true"
            className="absolute left-4 top-1/2 -translate-y-1/2 text-mute"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search integrations..."
            aria-label="Search integrations"
            className="hairline w-full rounded-xl bg-[#101010] py-3 pl-11 pr-4 text-sm text-paper outline-none placeholder:text-mute focus:border-white/40"
          />
        </div>
      </div>
      <div className="my-7 flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] text-mute" aria-live="polite">
          {results.length} {results.length === 1 ? "connection" : "connections"}
          {query ? ` matching “${query}”` : " to explore"}
        </p>
        {query || category !== "All tools" ? (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1.5 text-xs text-paper"
          >
            Clear filters <X size={13} />
          </button>
        ) : (
          <p className="hidden text-xs text-mute sm:block">
            Built in + MCP ecosystem
          </p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((item) => (
          <button
            type="button"
            key={item.name}
            onClick={() => {
              setSelected(item);
              detailRef.current?.showModal();
            }}
            className="hairline group flex min-h-[245px] flex-col rounded-[20px] bg-[#101010] p-7 text-left transition-colors duration-[400ms] ease-premium hover:border-white/25 hover:bg-[#141414]"
            aria-haspopup="dialog"
          >
            <div className="flex w-full items-start justify-between">
              <span
                className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] font-mono text-[20px] tracking-tighter"
                aria-hidden="true"
              >
                {item.mark}
              </span>
              <ArrowUpRight
                size={17}
                className="text-mute transition-transform duration-[400ms] ease-premium group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              />
            </div>
            <h2 className="mt-6 text-xl font-medium tracking-tight">
              {item.name}
            </h2>
            <p className="mt-2 flex-1 text-[13px] leading-6 text-mute">
              {item.description}
            </p>
            <span className="mt-5 font-mono text-[10px] uppercase tracking-wider text-mute">
              {item.kind}
            </span>
          </button>
        ))}
      </div>
      {results.length === 0 ? (
        <div className="hairline rounded-[20px] bg-[#101010] px-6 py-20 text-center">
          <Search size={27} className="mx-auto mb-5 text-mute" />
          <h2 className="text-xl">No matching connections.</h2>
          <p className="mt-3 text-sm text-mute">
            Try a different tool name or choose another category.
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-6 rounded-lg bg-paper px-5 py-3 text-sm text-ink"
          >
            Show all connections
          </button>
        </div>
      ) : null}
      <p className="mt-7 max-w-3xl text-xs leading-6 text-mute">
        MCP compatibility depends on the server you configure and the
        permissions available in your account. Third-party tools may require
        their own subscription.
      </p>
      <dialog
        ref={detailRef}
        aria-labelledby="integration-detail-title"
        className="hairline fixed inset-0 m-auto w-[calc(100%_-_32px)] max-w-lg rounded-[24px] bg-[#121212] p-7 text-paper backdrop:bg-black/80 sm:p-9"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const box = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < box.left ||
              event.clientX > box.right ||
              event.clientY < box.top ||
              event.clientY > box.bottom
            )
              detailRef.current?.close();
          }
        }}
      >
        <div className="flex items-start justify-between">
          <span className="font-mono text-3xl" aria-hidden="true">
            {selected?.mark}
          </span>
          <button
            aria-label="Close integration details"
            className="rounded-lg p-2 text-mute hover:text-paper"
            type="button"
            onClick={() => detailRef.current?.close()}
          >
            <X size={19} />
          </button>
        </div>
        <span className="mt-7 block font-mono text-[10px] uppercase tracking-wider text-mute">
          {selected?.kind}
        </span>
        <h2
          id="integration-detail-title"
          className="mt-3 text-3xl tracking-tight"
        >
          {selected?.name}
        </h2>
        <p className="mt-5 text-sm leading-7 text-mute">{selected?.detail}</p>
        <a
          href={`/docs#${selected?.anchor ?? "integrations"}`}
          className="mt-8 inline-flex items-center gap-3 rounded-xl bg-paper px-5 py-3 text-sm font-medium text-ink"
          onClick={() => detailRef.current?.close()}
        >
          Read the setup guide <ArrowUpRight size={15} />
        </a>
      </dialog>
    </>
  );
}
