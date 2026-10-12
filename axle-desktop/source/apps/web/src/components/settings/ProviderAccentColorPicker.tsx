"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import { normalizeProviderAccentColor } from "../../providerInstances";
import { cn } from "../../lib/utils";

const PROVIDER_TONES = [
  { color: "#262626", label: "Graphite" },
  { color: "#525252", label: "Charcoal" },
  { color: "#737373", label: "Stone" },
  { color: "#a3a3a3", label: "Silver" },
  { color: "#d4d4d4", label: "Mist" },
  { color: "#fafafa", label: "White" },
] as const;

export function ProviderAccentColorPicker(props: {
  readonly displayName: string;
  readonly value: string | undefined;
  readonly onCommit: (value: string) => void;
  readonly description?: string;
  readonly commitDelayMs?: number;
}) {
  const { commitDelayMs = 0, description, displayName, onCommit, value } = props;
  const [optimisticValue, setOptimisticValue] = useState(() => value ?? "");
  const commitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommitRef = useRef<string | null>(null);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    if (pendingCommitRef.current !== null) return;
    setOptimisticValue(value ?? "");
  }, [value]);

  useEffect(() => {
    return () => {
      if (commitTimeoutRef.current !== null) {
        clearTimeout(commitTimeoutRef.current);
      }
      const pendingCommit = pendingCommitRef.current;
      if (pendingCommit !== null) {
        onCommitRef.current(pendingCommit);
      }
    };
  }, []);

  const commitTone = useCallback(
    (nextValue: string) => {
      const normalizedValue = normalizeProviderAccentColor(nextValue) ?? "";
      setOptimisticValue(normalizedValue);
      if (commitTimeoutRef.current !== null) {
        clearTimeout(commitTimeoutRef.current);
        commitTimeoutRef.current = null;
      }
      if (commitDelayMs <= 0) {
        pendingCommitRef.current = null;
        onCommit(normalizedValue);
        return;
      }
      pendingCommitRef.current = normalizedValue;
      commitTimeoutRef.current = setTimeout(() => {
        commitTimeoutRef.current = null;
        const pendingCommit = pendingCommitRef.current;
        pendingCommitRef.current = null;
        if (pendingCommit !== null) {
          onCommitRef.current(pendingCommit);
        }
      }, commitDelayMs);
    },
    [commitDelayMs, onCommit],
  );

  const normalized = normalizeProviderAccentColor(optimisticValue);

  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium text-foreground">Provider tone</span>
      <div
        className="flex min-w-0 flex-wrap items-center gap-2"
        role="group"
        aria-label={`${displayName} provider tone`}
      >
        {PROVIDER_TONES.map(({ color, label }, index) => {
          const selected = normalized === color;
          return (
            <button
              key={color}
              type="button"
              aria-label={`${label} tone for ${displayName}`}
              aria-pressed={selected}
              title={label}
              onClick={() => commitTone(color)}
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border border-foreground/20 outline-none transition-[box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-95 motion-reduce:transition-none",
                selected && "ring-2 ring-foreground ring-offset-2 ring-offset-card",
              )}
              style={{ backgroundColor: color }}
            >
              {selected ? (
                <CheckIcon
                  className={cn("size-3.5", index < 3 ? "text-white" : "text-black")}
                  aria-hidden
                />
              ) : null}
            </button>
          );
        })}
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="size-7 shrink-0 text-muted-foreground"
          disabled={!normalized}
          onClick={() => commitTone("")}
          aria-label={`Reset provider tone for ${displayName}`}
          title="Use default tone"
        >
          <XIcon className="size-3.5" aria-hidden />
        </Button>
      </div>
      {description ? (
        <span className="text-xs leading-5 text-muted-foreground">{description}</span>
      ) : null}
    </div>
  );
}
