import { cn } from "../../lib/utils";

/**
 * Provider avatars are remote images, so `referrerPolicy` is set to avoid
 * leaking the renderer origin and the image fails closed to initials.
 */
export function AccountAvatar({
  url,
  name,
  email,
  className,
}: {
  readonly url?: string | null;
  readonly name?: string | null;
  readonly email?: string | null;
  readonly className?: string;
}) {
  const seed = name?.trim() || email?.trim() || "?";
  const initial = seed.slice(0, 1).toUpperCase();
  if (url) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden
        referrerPolicy="no-referrer"
        className={cn("size-8 shrink-0 rounded-full object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 select-none items-center justify-center rounded-full bg-muted text-[11px] font-semibold uppercase text-muted-foreground",
        className,
      )}
    >
      {initial}
    </span>
  );
}
