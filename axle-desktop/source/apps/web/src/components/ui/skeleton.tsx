import { cn } from "~/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "animate-status-pulse rounded-md bg-muted motion-reduce:animate-none",
        className,
      )}
      data-slot="skeleton"
      aria-hidden="true"
      {...props}
    />
  );
}

export { Skeleton };
