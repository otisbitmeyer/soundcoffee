"use client";

import { useEffect } from "react";

/** Silent — just registers the service worker. The actual install
 * button lives in the footer (PwaInstallButton), not as a popup. */
export default function PwaInstall() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Best-effort — the site works fine without it, just without
        // offline caching or install eligibility.
      });
    }
  }, []);

  return null;
}
