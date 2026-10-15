import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A provider or integration mark: the vendor's real logo when the catalogue
 * has one, and the written mark otherwise.
 *
 * Without an explicit `size` the logo fills the surrounding font size (1em),
 * so a mark dropped into an existing symbol wrapper inherits that wrapper's
 * responsive sizing instead of fighting it.
 */
export function BrandLogo({
  logo,
  mark,
  size,
  className,
}: {
  logo?: string;
  mark?: ReactNode;
  size?: number;
  className?: string;
}) {
  if (!logo) return <>{mark}</>;
  return (
    <img
      src={logo}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      className={cn("brand-logo", className)}
      style={size === undefined ? undefined : { width: size, height: size }}
    />
  );
}
