import { Undo2Icon } from "lucide-react";
import { type ComponentPropsWithoutRef, type ReactNode, useEffect, useId, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Re-render every `intervalMs`; return a stable timestamp snapshot for render-time relative labels. */
export function useRelativeTimeTick(intervalMs = 1_000) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return nowMs;
}

export function SettingsSection({
  title,
  icon,
  headerAction,
  children,
  className,
  ...sectionProps
}: ComponentPropsWithoutRef<"section"> & {
  title: string;
  icon?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} {...sectionProps} className={cn("space-y-3", className)}>
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-3 px-0.5">
        <h2
          id={titleId}
          className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground"
        >
          {icon}
          {title}
        </h2>
        {headerAction ? (
          <div className="flex min-w-0 items-center justify-end gap-2">{headerAction}</div>
        ) : null}
      </div>
      <div className="relative min-w-0 rounded-xl border border-border bg-card text-card-foreground">
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  status,
  resetAction,
  control,
  children,
  className,
  ...rowProps
}: Omit<ComponentPropsWithoutRef<"div">, "title"> & {
  title: ReactNode;
  description: ReactNode;
  status?: ReactNode;
  resetAction?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      {...rowProps}
      className={cn(
        "min-w-0 border-t border-border/70 px-4 first:border-t-0 sm:px-5",
        children ? "pt-4 pb-0" : "py-4",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="text-[13px] leading-5 font-medium text-foreground">{title}</h3>
            {resetAction ? (
              <span className="inline-flex size-5 shrink-0 items-center justify-center">
                {resetAction}
              </span>
            ) : null}
          </div>
          <p className="max-w-prose text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
            {description}
          </p>
          {status ? <div className="pt-0.5 text-[11px] text-muted-foreground">{status}</div> : null}
        </div>
        {control ? (
          <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:max-w-[48%] sm:justify-end [&>*]:max-w-full">
            {control}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SettingResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Reset ${label} to default`}
            className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          >
            <Undo2Icon className="size-3" />
          </Button>
        }
      />
      <TooltipPopup side="top">Reset to default</TooltipPopup>
    </Tooltip>
  );
}

export function SettingsPageContainer({
  children,
  className,
  title,
  description,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
}) {
  return (
    <div className="scrollbar-gutter-both min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-8 sm:py-8">
      <div className={cn("mx-auto flex w-full max-w-3xl flex-col gap-7 pb-8", className)}>
        {title ? (
          <div className="space-y-1.5 pb-1">
            <h1 className="text-xl leading-7 font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            {description ? (
              <p className="max-w-prose text-sm leading-6 text-muted-foreground">{description}</p>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
