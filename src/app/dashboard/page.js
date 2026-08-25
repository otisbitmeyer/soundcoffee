"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import LoginModal from "@/components/LoginModal";
import { useAuth } from "@/context/AuthContext";

function formatDate(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function DashboardPage() {
  const { isLoggedIn, pubkey, npub, restoring } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!pubkey) return;
    fetch(`/api/stats?pubkey=${pubkey}`)
      .then((res) => res.json())
      .then(setStats)
      .catch(() => setError(true));
  }, [pubkey]);

  return (
    <>
      <Header />

      <main className="flex-1 bg-paper">
        <div className="mx-auto max-w-xl px-6 py-16 text-center">
          <h1 className="font-display text-4xl tracking-wide text-ink">
            YOUR STATS
          </h1>

          {!restoring && !isLoggedIn && (
            <div className="mt-10 border-2 border-ink p-6">
              <p className="font-serif text-ink/80">
                Log in to see your Coffee Club stats.
              </p>
              <button
                onClick={() => setShowLogin(true)}
                className="mt-4 border-2 border-ink bg-ink px-5 py-2.5 font-display text-sm tracking-widest text-paper hover:bg-rust hover:border-rust"
              >
                LOG IN
              </button>
            </div>
          )}

          {isLoggedIn && error && (
            <p className="mt-10 font-serif italic text-ink/50">
              Couldn&rsquo;t load your stats right now &mdash; try again in
              a bit.
            </p>
          )}

          {isLoggedIn && !stats && !error && (
            <p className="mt-10 font-serif italic text-ink/50">Loading…</p>
          )}

          {isLoggedIn && stats && (
            <div className="mt-10 space-y-6">
              <div
                className={`border-2 p-6 ${
                  stats.isMember ? "border-jade bg-jade/10" : "border-ink/30"
                }`}
              >
                <p className="font-display text-2xl tracking-wide text-ink">
                  {stats.isMember ? "✓ COFFEE CLUB MEMBER" : "NOT A MEMBER YET"}
                </p>
                {stats.isMember && (
                  <p className="mt-1 font-serif text-sm text-ink/60">
                    Since {formatDate(stats.memberSince)}
                  </p>
                )}
                {!stats.isMember && (
                  <p className="mt-2 font-serif text-sm text-ink/70">
                    Boost the podcast 100 sats or buy a bag to join.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 text-left">
                <div className="border-2 border-ink/20 p-4">
                  <p className="font-display text-xs tracking-widest text-ink/50">
                    TOTAL ZAPPED
                  </p>
                  <p className="mt-1 font-display text-2xl text-rust">
                    {stats.totalZapSats.toLocaleString()} sats
                  </p>
                </div>
                <div className="border-2 border-ink/20 p-4">
                  <p className="font-display text-xs tracking-widest text-ink/50">
                    NUMBER OF ZAPS
                  </p>
                  <p className="mt-1 font-display text-2xl text-ink">
                    {stats.zapCount}
                  </p>
                </div>
                <div className="border-2 border-ink/20 p-4">
                  <p className="font-display text-xs tracking-widest text-ink/50">
                    COFFEE PURCHASES
                  </p>
                  <p className="mt-1 font-display text-2xl text-ink">
                    {stats.purchaseCount}
                  </p>
                </div>
                <div className="border-2 border-ink/20 p-4">
                  <p className="font-display text-xs tracking-widest text-ink/50">
                    TOTAL SPENT
                  </p>
                  <p className="mt-1 font-display text-2xl text-ink">
                    {stats.totalPurchaseSats.toLocaleString()} sats
                  </p>
                </div>
              </div>

              <p className="font-serif text-xs italic text-ink/40">
                npub: {npub}
              </p>
            </div>
          )}
        </div>
      </main>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  );
}
