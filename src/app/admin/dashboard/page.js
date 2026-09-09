"use client";

import { useEffect, useState } from "react";
import { nip19 } from "nostr-tools";
import Header from "@/components/Header";
import LoginModal from "@/components/LoginModal";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";

function formatSats(sats) {
  return `${(sats || 0).toLocaleString()} sats`;
}
function formatUsd(cents) {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}
function shortPubkey(pk) {
  return `${pk.slice(0, 12)}…`;
}

// A handful of preset ranges plus a real custom picker — covers the
// common cases without forcing two date inputs for every quick check.
function getPresetRange(preset) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (preset === "7d") return { from: now - 7 * day, to: now };
  if (preset === "30d") return { from: now - 30 * day, to: now };
  if (preset === "90d") return { from: now - 90 * day, to: now };
  return { from: 0, to: now }; // all time
}

/** Resolves a pubkey to its actual name and avatar where one exists —
 * falls back to the shortened pubkey itself when there's no profile
 * to find, rather than showing a broken image or blank name. */
function ProfileLabel({ pubkey }) {
  const { profile } = useProfile(pubkey);
  const displayName = profile?.display_name || profile?.name;

  return (
    <span className="inline-flex items-center gap-1.5">
      {profile?.picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.picture}
          alt=""
          className="h-4 w-4 shrink-0 rounded-full border border-ink/20 object-cover"
          onError={(e) => {
            e.target.style.display = "none";
          }}
        />
      ) : null}
      <span>{displayName || shortPubkey(pubkey)}</span>
    </span>
  );
}

export default function AdminDashboard() {
  const { isLoggedIn, pubkey, restoring } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const isRightAccount = pubkey === SOUND_COFFEE_PUBKEY;

  const [members, setMembers] = useState(null);
  const [newMemberNpub, setNewMemberNpub] = useState("");
  const [newMemberDiscount, setNewMemberDiscount] = useState("10");
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState("");

  const [preset, setPreset] = useState("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!isRightAccount) return;
    fetchMembers();
  }, [isRightAccount]);

  useEffect(() => {
    if (!isRightAccount) return;
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRightAccount, preset, customFrom, customTo]);

  async function fetchMembers() {
    try {
      const res = await fetch("/api/coffee-club");
      const data = await res.json();
      setMembers(data.members || []);
    } catch {
      setMembers([]);
    }
  }

  function currentRange() {
    if (preset === "custom") {
      const from = customFrom ? new Date(customFrom).getTime() : 0;
      const to = customTo ? new Date(customTo).getTime() + 24 * 60 * 60 * 1000 - 1 : Date.now();
      return { from, to };
    }
    return getPresetRange(preset);
  }

  async function fetchSummary() {
    const { from, to } = currentRange();
    try {
      const res = await fetch(`/api/sales-summary?from=${from}&to=${to}`);
      const data = await res.json();
      setSummary(data);
    } catch {
      setSummary(null);
    }
  }

  async function handleAddMember() {
    setMemberError("");
    if (!newMemberNpub.trim()) {
      setMemberError("Enter an npub or hex pubkey.");
      return;
    }
    const discountPercent = Number(newMemberDiscount);
    if (!discountPercent || discountPercent <= 0) {
      setMemberError("Enter a discount percentage greater than 0.");
      return;
    }
    setAddingMember(true);
    try {
      const trimmed = newMemberNpub.trim();
      const pubkeyToAdd = trimmed.startsWith("npub1") ? nip19.decode(trimmed).data : trimmed;
      await fetch("/api/coffee-club", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pubkey: pubkeyToAdd, discountPercent }),
      });
      setNewMemberNpub("");
      await fetchMembers();
    } catch {
      setMemberError("Couldn't add that member — check the npub/pubkey and try again.");
    } finally {
      setAddingMember(false);
    }
  }

  async function handleRemoveMember(memberPubkey) {
    await fetch("/api/coffee-club/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pubkey: memberPubkey }),
    });
    fetchMembers();
  }

  return (
    <>
      <Header />
      <main className="flex-1 bg-paper">
        <div className="mx-auto max-w-2xl px-6 py-16">
          <h1 className="font-display text-2xl tracking-wide text-ink">DASHBOARD</h1>

          {!isLoggedIn && !restoring && (
            <button
              onClick={() => setShowLogin(true)}
              className="mt-6 border-2 border-ink bg-ink px-5 py-2.5 font-display text-sm tracking-widest text-paper hover:bg-rust hover:border-rust"
            >
              LOG IN
            </button>
          )}

          {isLoggedIn && !isRightAccount && (
            <p className="mt-6 border-2 border-rust bg-rust/10 p-4 font-serif text-rust">
              You&rsquo;re logged in, but not as the Sound Coffee account.
            </p>
          )}

          {isRightAccount && (
            <>
              {/* ---------- SALES SUMMARY ---------- */}
              <div className="mt-8">
                <p className="font-display text-sm text-ink">Sales</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[
                    { key: "7d", label: "7 DAYS" },
                    { key: "30d", label: "30 DAYS" },
                    { key: "90d", label: "90 DAYS" },
                    { key: "all", label: "ALL TIME" },
                    { key: "custom", label: "CUSTOM" },
                  ].map((p) => (
                    <button
                      key={p.key}
                      onClick={() => setPreset(p.key)}
                      className={`border-2 px-3 py-1.5 font-display text-xs tracking-widest ${
                        preset === p.key
                          ? "border-ink bg-ink text-paper"
                          : "border-ink/30 text-ink/60 hover:border-ink hover:text-ink"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {preset === "custom" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="border-2 border-ink/30 px-3 py-1.5 font-mono text-xs focus:border-ink focus:outline-none"
                    />
                    <span className="font-serif text-xs text-ink/50">to</span>
                    <input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="border-2 border-ink/30 px-3 py-1.5 font-mono text-xs focus:border-ink focus:outline-none"
                    />
                  </div>
                )}

                {summary && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="border-2 border-ink/20 p-4 text-center">
                      <p className="font-display text-xs tracking-widest text-ink/50">SATS</p>
                      <p className="mt-1 font-display text-xl text-ink">{formatSats(summary.totalSats)}</p>
                    </div>
                    <div className="border-2 border-ink/20 p-4 text-center">
                      <p className="font-display text-xs tracking-widest text-ink/50">DOLLARS</p>
                      <p className="mt-1 font-display text-xl text-ink">{formatUsd(summary.totalUsdCents)}</p>
                    </div>
                  </div>
                )}

                {summary && (summary.guestSats > 0 || summary.guestUsdCents > 0) && (
                  <p className="mt-2 font-serif text-xs italic text-ink/50">
                    Includes {formatSats(summary.guestSats)} / {formatUsd(summary.guestUsdCents)} from guest / unattributed orders — not a real customer identity, so not broken out below.
                  </p>
                )}

                {summary?.byBuyer?.length > 0 && (
                  <div className="mt-4">
                    <p className="font-display text-xs tracking-widest text-ink/50">BY BUYER</p>
                    <div className="mt-2 space-y-1.5">
                      {summary.byBuyer.map((b) => (
                        <div
                          key={b.pubkey}
                          className="flex items-center justify-between border border-ink/15 px-3 py-2 font-mono text-xs"
                        >
                          <span className="text-ink/70"><ProfileLabel pubkey={b.pubkey} /></span>
                          <span className="text-ink/50">{b.orderCount} order{b.orderCount === 1 ? "" : "s"}</span>
                          <span className="text-ink">
                            {b.sats > 0 && formatSats(b.sats)}
                            {b.sats > 0 && b.usdCents > 0 && " + "}
                            {b.usdCents > 0 && formatUsd(b.usdCents)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ---------- COFFEE CLUB ---------- */}
              <div className="mt-10 border-t border-ink/10 pt-6">
                <p className="font-display text-sm text-ink">Coffee Club</p>
                <p className="mt-1 font-serif text-xs text-ink/60">
                  Members get their discount applied automatically at
                  checkout once logged in — no code needed.
                </p>

                <div className="mt-3 space-y-2 border border-ink/15 p-3">
                  <div className="flex gap-2">
                    <input
                      value={newMemberNpub}
                      onChange={(e) => setNewMemberNpub(e.target.value)}
                      placeholder="npub or hex"
                      className="flex-1 border-2 border-ink/30 px-3 py-2 font-mono text-xs focus:border-ink focus:outline-none"
                    />
                    <input
                      value={newMemberDiscount}
                      onChange={(e) => setNewMemberDiscount(e.target.value)}
                      type="number"
                      placeholder="10"
                      className="w-20 border-2 border-ink/30 px-2 py-2 font-mono text-xs focus:border-ink focus:outline-none"
                    />
                    <span className="flex items-center font-display text-xs text-ink/50">%</span>
                  </div>
                  {memberError && <p className="font-serif text-xs text-rust">{memberError}</p>}
                  <button
                    onClick={handleAddMember}
                    disabled={addingMember}
                    className="w-full border-2 border-ink bg-ink px-4 py-2 font-display text-xs tracking-widest text-paper hover:bg-jade hover:border-jade disabled:opacity-50"
                  >
                    {addingMember ? "ADDING…" : "+ ADD MEMBER"}
                  </button>
                </div>

                <div className="mt-3 space-y-2">
                  {members === null && (
                    <p className="font-serif text-xs italic text-ink/40">Loading…</p>
                  )}
                  {members?.length === 0 && (
                    <p className="font-serif text-xs italic text-ink/40">No members yet.</p>
                  )}
                  {members?.map((m) => (
                    <div
                      key={m.pubkey}
                      className="flex items-center justify-between border border-ink/15 px-3 py-2"
                    >
                      <p className="font-mono text-xs text-ink">
                        <ProfileLabel pubkey={m.pubkey} />{" "}
                        <span className="text-ink/50">— {m.discountPercent}% off</span>
                      </p>
                      <button
                        onClick={() => handleRemoveMember(m.pubkey)}
                        className="font-display text-xs tracking-widest text-rust hover:text-ink"
                      >
                        REMOVE
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  );
}
