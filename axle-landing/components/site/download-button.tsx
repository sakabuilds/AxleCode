"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "./logo";
import { AppleIcon, LinuxIcon, WindowsIcon } from "./os-icons";

type OS = "mac" | "windows" | "linux";

const LABELS: Record<OS, string> = {
  mac: "Download for Mac",
  windows: "Download for Windows",
  linux: "Download for Linux",
};

function detectOS(): OS | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = (nav.userAgentData?.platform || nav.platform || "").toLowerCase();
  const ua = nav.userAgent.toLowerCase();
  if (/android|cros|iphone|ipad|ipod|windows phone/.test(ua) || (/macintosh/.test(ua) && /mobile\/\w+/.test(ua))) return null;
  if (platform.includes("mac") || /macintosh|mac os x/.test(ua)) return "mac";
  if (platform.includes("win") || /windows/.test(ua)) return "windows";
  if (platform.includes("linux") || platform.includes("x11") || /linux|x11/.test(ua)) return "linux";
  return null;
}

export function DownloadButton({
  className,
  variant = "primary",
  size = "lg",
  href = "/download",
  iconClassName = "h-[17px] w-[17px]",
  logoClassName = "h-[18px] w-[16px]",
}: {
  className?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
  href?: string;
  iconClassName?: string;
  logoClassName?: string;
}) {
  const [os, setOs] = useState<OS | null>(null);
  useEffect(() => setOs(detectOS()), []);
  const Icon = os === "mac" ? AppleIcon : os === "windows" ? WindowsIcon : os === "linux" ? LinuxIcon : null;
  return (
    <Button href={href} className={className} variant={variant} size={size} ariaLabel={os ? LABELS[os] : "Download Axle"}>
      {Icon ? <Icon className={iconClassName} /> : <LogoMark className={logoClassName} />}
      {os ? LABELS[os] : "Download Axle"}
    </Button>
  );
}
