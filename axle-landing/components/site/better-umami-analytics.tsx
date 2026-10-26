"use client";

import { useEffect } from "react";

const WEBSITE_ID = "a913388f-895a-40d7-8ca8-1f424817b793";

export function BetterUmamiAnalytics() {
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://app.betterumami.com/script.js";
    script.defer = true;
    script.setAttribute("data-website-id", WEBSITE_ID);
    document.head.appendChild(script);

    const recorder = document.createElement("script");
    recorder.src = "https://app.betterumami.com/recorder.js";
    recorder.defer = true;
    recorder.setAttribute("data-website-id", WEBSITE_ID);
    document.head.appendChild(recorder);

    return () => {
      recorder.remove();
      script.remove();
    };
  }, []);

  return null;
}
