"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import LoginModal from "@/components/LoginModal";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";

function shortNpub(pubkey) {
  return `${pubkey.slice(0, 10)}…${pubkey.slice(-6)}`;
}

function MemberRow({ s }) {
  const { profile } = useProfile(s.pubkey);
  const displayName = profile?.display_name || profile?.name;

  return (
    <tr className="border-b border-ink/10">
      <td className="py-2 pr-4">
        <div className="flex items-center gap-2">
          {profile?.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.picture}
              alt=""
              className="h-7 w-7 shrink-0 rounded-full border border-ink/30 object-cover"
            />
          ) : (
            <div className="h-7 w-7 shrink-0 rounded-full border border-ink/20 bg-ink/5" />
          )}
          <div>
            {displayName && (
              <div className="font-display text-sm text-ink">{displayName}</div>
            )}
            <div className="font-mono text-xs text-ink/50">
              {shortNpub(s.pubkey)}
            </div>
          </div>
        </div>
      </td>
      <td className="py-2 pr-4">
        {s.isMember ? (
          <span className="text-jade">✓</span>
        ) : (
          <span className="text-ink/30">—</span>
        )}
      </td>
      <td className="py-2 pr-4">{s.totalZapSats.toLocaleString()} sats</td>
      <td className="py-2 pr-4">{s.zapCount}</td>
      <td className="py-2 pr-4">{s.purchaseCount}</td>
      <td className="py-2 pr-4">{s.totalPurchaseSats.toLocaleString()} sats</td>
      <td className="py-2 font-serif text-xs text-ink/50">
        {s.lastActivityAt ? new Date(s.lastActivityAt).toLocaleDateString() : "—"}
      </td>
    </tr>
  );
}

export default function AdminPage() {
  const { isLoggedIn, pubkey, restoring } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeResult, setRecomputeResult] = useState(null);

  const isRightAccount = pubkey === SOUND_COFFEE_PUBKEY;

  function loadData() {
    fetch("/api/club-members")
      .then((res) => res.json())
      .then(setData)
      .catch(() => setError(true));
  }

  useEffect(() => {
    if (!isRightAccount) return;
    loadData();
  }, [isRightAccount]);

  async function handleRecompute() {
    setRecomputing(true);
    setRecomputeResult(null);
    try {
      const res = await fetch("/api/admin/recompute-stats", { method: "POST" });
      const result = await res.json();
      setRecomputeResult(result);
      loadData();
    } catch {
      setRecomputeResult({ ok: false });
    } finally {
      setRecomputing(false);
    }
  }

  const sortedStats = data?.allStats
    ?.slice()
    .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));

  return (
    <>
      <Header />

      <main className="flex-1 bg-paper">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <h1 className="text-center font-display text-4xl tracking-wide text-ink">
            CLUB ADMIN
          </h1>

          {!restoring && !isLoggedIn && (
            <div className="mx-auto mt-10 max-w-sm border-2 border-ink p-6 text-center">
              <p className="font-serif text-ink/80">
                Log in as the Sound Coffee account to view this.
              </p>
              <button
                onClick={() => setShowLogin(true)}
                className="mt-4 border-2 border-ink bg-ink px-5 py-2.5 font-display text-sm tracking-widest text-paper hover:bg-rust hover:border-rust"
              >
                LOG IN
              </button>
            </div>
          )}

          {isLoggedIn && !isRightAccount && (
            <p className="mx-auto mt-10 max-w-sm border-2 border-rust bg-rust/10 p-4 text-center font-serif text-rust">
              You&rsquo;re logged in, but not as the Sound Coffee account.
            </p>
          )}

          {isRightAccount && error && (
            <p className="mt-10 text-center font-serif italic text-ink/50">
              Couldn&rsquo;t load member data right now.
            </p>
          )}

          {isRightAccount && data && (
            <div className="mt-10">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="font-serif text-ink/70">
                  <span className="font-display text-2xl text-jade">
                    {data.members.length}
                  </span>{" "}
                  club member{data.members.length === 1 ? "" : "s"} out of{" "}
                  {data.allStats.length} tracked pubkey
                  {data.allStats.length === 1 ? "" : "s"}.
                </p>
                <button
                  onClick={handleRecompute}
                  disabled={recomputing}
                  className="border-2 border-ink px-4 py-2 font-display text-xs tracking-widest text-ink hover:border-jade hover:text-jade disabled:opacity-50"
                >
                  {recomputing ? "RECOMPUTING…" : "RECOMPUTE ALL STATS"}
                </button>
              </div>

              {recomputeResult && (
                <p
                  className={`mt-3 text-sm font-serif ${
                    recomputeResult.ok ? "text-jade" : "text-rust"
                  }`}
                >
                  {recomputeResult.ok
                    ? `Done — rebuilt stats for ${recomputeResult.pubkeysRecomputed} pubkeys from ${recomputeResult.uniqueZapsFound} unique zaps and ${recomputeResult.uniquePurchasesFound} unique purchases.`
                    : "Something went wrong recomputing stats."}
                </p>
              )}

              <div className="mt-6 overflow-x-auto">
                <table className="w-full border-collapse text-left font-serif text-sm">
                  <thead>
                    <tr className="border-b-2 border-ink font-display text-xs tracking-widest text-ink/60">
                      <th className="py-2 pr-4">MEMBER</th>
                      <th className="py-2 pr-4">CLUB</th>
                      <th className="py-2 pr-4">ZAPPED</th>
                      <th className="py-2 pr-4">ZAPS</th>
                      <th className="py-2 pr-4">PURCHASES</th>
                      <th className="py-2 pr-4">SPENT</th>
                      <th className="py-2">LAST ACTIVITY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStats.map((s) => (
                      <MemberRow key={s.pubkey} s={s} />
                    ))}
                  </tbody>
                </table>
                {sortedStats?.length === 0 && (
                  <p className="mt-6 font-serif italic text-ink/50">
                    No activity tracked yet.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  );
}
