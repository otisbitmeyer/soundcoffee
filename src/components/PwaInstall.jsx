"use client";

import { useEffect, useState } from "react";

const DISMISSED_KEY = "sound-coffee-pwa-dismissed";

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

export default function PwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(true); // default true until checked, avoids a flash

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Best-effort — the site works fine without it, just without
        // offline caching or install eligibility.
      });
    }

    const alreadyDismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    setDismissed(alreadyDismissed);

    if (isStandalone() || alreadyDismissed) return;

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

  function handleDismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
    setDeferredPrompt(null);
    setShowIosHint(false);
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    handleDismiss();
  }

  if (dismissed || (!deferredPrompt && !showIosHint)) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-[150] mx-auto max-w-sm border-2 border-ink bg-paper px-4 py-3 shadow-lg sm:inset-x-auto sm:right-4">
      {showIosHint ? (
        <p className="font-serif text-sm text-ink">
          Add Sound Coffee to your home screen: tap Share, then
          &ldquo;Add to Home Screen.&rdquo;
        </p>
      ) : (
        <p className="font-serif text-sm text-ink">
          Install Sound Coffee for quicker access next time.
        </p>
      )}
      <div className="mt-2 flex gap-2">
        {!showIosHint && (
          <button
            onClick={handleInstall}
            className="border-2 border-ink bg-ink px-3 py-1.5 font-display text-xs tracking-widest text-paper hover:bg-rust hover:border-rust"
          >
            INSTALL
          </button>
        )}
        <button
          onClick={handleDismiss}
          className="border-2 border-ink/30 px-3 py-1.5 font-display text-xs tracking-widest text-ink/60 hover:border-ink hover:text-ink"
        >
          NOT NOW
        </button>
      </div>
    </div>
  );
}
