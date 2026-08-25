"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import LoginModal from "@/components/LoginModal";
import { useAuth } from "@/context/AuthContext";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";

function shortNpub(pubkey) {
  return `${pubkey.slice(0, 10)}…${pubkey.slice(-6)}`;
}

export default function AdminPage() {
  const { isLoggedIn, pubkey, restoring } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  const isRightAccount = pubkey === SOUND_COFFEE_PUBKEY;

  useEffect(() => {
    if (!isRightAccount) return;
    fetch("/api/club-members")
      .then((res) => res.json())
      .then(setData)
      .catch(() => setError(true));
  }, [isRightAccount]);

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
              <p className="font-serif text-ink/70">
                <span className="font-display text-2xl text-jade">
                  {data.members.length}
                </span>{" "}
                club member{data.members.length === 1 ? "" : "s"} out of{" "}
                {data.allStats.length} tracked pubkey
                {data.allStats.length === 1 ? "" : "s"}.
              </p>

              <div className="mt-6 overflow-x-auto">
                <table className="w-full border-collapse text-left font-serif text-sm">
                  <thead>
                    <tr className="border-b-2 border-ink font-display text-xs tracking-widest text-ink/60">
                      <th className="py-2 pr-4">NPUB</th>
                      <th className="py-2 pr-4">MEMBER</th>
                      <th className="py-2 pr-4">ZAPPED</th>
                      <th className="py-2 pr-4">ZAPS</th>
                      <th className="py-2 pr-4">PURCHASES</th>
                      <th className="py-2 pr-4">SPENT</th>
                      <th className="py-2">LAST ACTIVITY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStats.map((s) => (
                      <tr key={s.pubkey} className="border-b border-ink/10">
                        <td className="py-2 pr-4 font-mono text-xs">
                          {shortNpub(s.pubkey)}
                        </td>
                        <td className="py-2 pr-4">
                          {s.isMember ? (
                            <span className="text-jade">✓</span>
                          ) : (
                            <span className="text-ink/30">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          {s.totalZapSats.toLocaleString()} sats
                        </td>
                        <td className="py-2 pr-4">{s.zapCount}</td>
                        <td className="py-2 pr-4">{s.purchaseCount}</td>
                        <td className="py-2 pr-4">
                          {s.totalPurchaseSats.toLocaleString()} sats
                        </td>
                        <td className="py-2 font-serif text-xs text-ink/50">
                          {s.lastActivityAt
                            ? new Date(s.lastActivityAt).toLocaleDateString()
                            : "—"}
                        </td>
                      </tr>
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
