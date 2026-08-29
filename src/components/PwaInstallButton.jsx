"use client";

import { useEffect, useState } from "react";

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

/** A small, easy-to-ignore install button for page footers — not a
 * popup. Shows nothing at all if the site's already installed, or if
 * the browser hasn't signaled installability yet. */
export default function PwaInstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    if (isIos()) {
      setShowIosHint(true);
      return;
    }

    function handleBeforeInstallPrompt(e) {
      e.preventDefault();
      setDeferredPrompt(e);
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === "accepted") setInstalled(true);
  }

  if (installed || (!deferredPrompt && !showIosHint)) return null;

  return (
    <div className="relative inline-block">
      <button
        onClick={showIosHint ? () => setShowIosHint("tapped") : handleInstall}
        className="inline-flex items-center gap-1.5 rounded-full border border-ink/30 px-3 py-1 font-display text-[10px] tracking-widest text-ink/50 transition hover:border-jade hover:text-jade"
      >
        📲 INSTALL APP
      </button>

      {showIosHint === "tapped" && (
        <div className="absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 border-2 border-ink bg-paper px-3 py-2 text-center font-serif text-xs text-ink shadow-lg">
          Tap Share, then &ldquo;Add to Home Screen.&rdquo;
          <button
            onClick={() => setShowIosHint(true)}
            className="mt-1 block w-full font-display text-[10px] tracking-widest text-ink/40 hover:text-ink"
          >
            GOT IT
          </button>
        </div>
      )}
    </div>
  );
}
