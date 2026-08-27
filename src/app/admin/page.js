"use client";

import { useEffect, useState } from "react";
import { SimplePool } from "nostr-tools/pool";
import Header from "@/components/Header";
import LoginModal from "@/components/LoginModal";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { DEFAULT_RELAYS } from "@/lib/relays";
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
  const { isLoggedIn, pubkey, signEvent, restoring } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeResult, setRecomputeResult] = useState(null);

  const [dmRelayStatus, setDmRelayStatus] = useState(null); // "checking" | "missing" | "set" | "publishing" | "done" | "error"
  const [dmRelayList, setDmRelayList] = useState(DEFAULT_RELAYS); // editable list
  const [newRelayInput, setNewRelayInput] = useState("");
  const [paymentPrefStatus, setPaymentPrefStatus] = useState(null);
  const [existingPaymentPref, setExistingPaymentPref] = useState(null);

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

    // Check current merchant settings so we can show real status instead
    // of guessing.
    (async () => {
      const pool = new SimplePool();
      try {
        setDmRelayStatus("checking");
        setPaymentPrefStatus("checking");

        const [relayListEvent, profileEvent] = await Promise.all([
          pool.get(DEFAULT_RELAYS, { kinds: [10050], authors: [SOUND_COFFEE_PUBKEY] }),
          pool.get(DEFAULT_RELAYS, { kinds: [0], authors: [SOUND_COFFEE_PUBKEY] }),
        ]);

        if (relayListEvent) {
          const relays = relayListEvent.tags
            .filter((t) => t[0] === "relay")
            .map((t) => t[1]);
          setDmRelayList(relays.length > 0 ? relays : DEFAULT_RELAYS);
          setDmRelayStatus("set");
        } else {
          setDmRelayStatus("missing");
        }

        if (profileEvent) {
          const pref = profileEvent.tags.find((t) => t[0] === "payment_preference")?.[1];
          setExistingPaymentPref(pref || "manual (default)");
          setPaymentPrefStatus(pref === "lud16" ? "set" : "missing");
        } else {
          setPaymentPrefStatus("missing");
        }
      } finally {
        pool.close(DEFAULT_RELAYS);
      }
    })();
  }, [isRightAccount]);

  function addRelay() {
    let url = newRelayInput.trim();
    if (!url) return;
    if (!url.startsWith("wss://") && !url.startsWith("ws://")) url = `wss://${url}`;
    if (!dmRelayList.includes(url)) setDmRelayList((list) => [...list, url]);
    setNewRelayInput("");
  }

  function removeRelay(url) {
    setDmRelayList((list) => list.filter((r) => r !== url));
  }

  async function handlePublishDmRelays() {
    if (dmRelayList.length === 0) {
      setDmRelayStatus("error");
      return;
    }
    setDmRelayStatus("publishing");
    try {
      const template = {
        kind: 10050,
        created_at: Math.floor(Date.now() / 1000),
        tags: dmRelayList.map((url) => ["relay", url]),
        content: "",
      };
      const signed = await signEvent(template);
      const pool = new SimplePool();
      // Publish to the new list itself plus our known defaults, so the
      // update is discoverable even from relays not on the new list.
      const publishTo = [...new Set([...dmRelayList, ...DEFAULT_RELAYS])];
      await Promise.any(pool.publish(publishTo, signed));
      pool.close(publishTo);
      setDmRelayStatus("done");
    } catch {
      setDmRelayStatus("error");
    }
  }

  async function handleSetPaymentPreference() {
    setPaymentPrefStatus("publishing");
    try {
      const pool = new SimplePool();
      const currentProfile = await pool.get(DEFAULT_RELAYS, {
        kinds: [0],
        authors: [SOUND_COFFEE_PUBKEY],
      });

      const preservedTags = (currentProfile?.tags || []).filter(
        (t) => t[0] !== "payment_preference"
      );
      const template = {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        // Content (name, picture, lud16, etc.) MUST be preserved exactly
        // — kind 0 is your whole profile, not just this one setting.
        content: currentProfile?.content || "{}",
        tags: [...preservedTags, ["payment_preference", "lud16"]],
      };
      const signed = await signEvent(template);
      await Promise.any(pool.publish(DEFAULT_RELAYS, signed));
      pool.close(DEFAULT_RELAYS);
      setExistingPaymentPref("lud16");
      setPaymentPrefStatus("done");
    } catch {
      setPaymentPrefStatus("error");
    }
  }

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

      <main className="admin-fonts flex-1 bg-paper">
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

          {isRightAccount && (
            <div className="mx-auto mt-10 max-w-2xl border-2 border-ink/20 p-5">
              <h2 className="font-display text-lg tracking-wide text-ink">
                MERCHANT SETTINGS
              </h2>
              <p className="mt-1 mb-4 font-serif text-sm text-ink/60">
                These make order delivery and payment processing more
                reliable for buyers using any Gamma-compatible app, not
                just this site.
              </p>

              <div className="space-y-4">
                <div className="border-t border-ink/10 pt-4">
                  <div className="flex items-center justify-between">
                    <p className="font-display text-sm text-ink">DM Relay List</p>
                    <button
                      onClick={handlePublishDmRelays}
                      disabled={dmRelayStatus === "publishing"}
                      className="shrink-0 border-2 border-ink px-4 py-2 font-display text-xs tracking-widest text-ink hover:border-jade hover:text-jade disabled:opacity-50"
                    >
                      {dmRelayStatus === "publishing"
                        ? "PUBLISHING…"
                        : dmRelayStatus === "done"
                        ? "✓ PUBLISHED"
                        : dmRelayStatus === "set"
                        ? "REPUBLISH"
                        : "PUBLISH"}
                    </button>
                  </div>
                  <p className="mt-1 font-serif text-xs text-ink/60">
                    {dmRelayStatus === "checking" && "Checking…"}
                    {dmRelayStatus === "missing" &&
                      "Not published yet — apps are guessing where to send orders."}
                    {dmRelayStatus === "error" && "Something went wrong."}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {dmRelayList.map((url) => (
                      <span
                        key={url}
                        className="flex items-center gap-1.5 border border-ink/30 px-2 py-1 font-mono text-xs text-ink"
                      >
                        {url}
                        <button
                          onClick={() => removeRelay(url)}
                          className="text-rust hover:text-ink"
                          aria-label={`Remove ${url}`}
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                    {dmRelayList.length === 0 && (
                      <span className="font-serif text-xs italic text-rust">
                        No relays — add at least one before publishing.
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <input
                      value={newRelayInput}
                      onChange={(e) => setNewRelayInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addRelay()}
                      placeholder="relay.example.com"
                      className="flex-1 border-2 border-ink/30 px-2 py-1.5 font-mono text-xs focus:border-ink focus:outline-none"
                    />
                    <button
                      onClick={addRelay}
                      className="border-2 border-ink/30 px-3 py-1.5 font-display text-xs text-ink hover:border-ink"
                    >
                      + ADD
                    </button>
                  </div>
                  <p className="mt-2 font-serif text-xs italic text-ink/50">
                    Changes here only take effect once you click Publish
                    &mdash; adding/removing above is just editing the draft.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-4">
                  <div>
                    <p className="font-display text-sm text-ink">
                      Payment Preference
                    </p>
                    <p className="font-serif text-xs text-ink/60">
                      {paymentPrefStatus === "checking" && "Checking…"}
                      {paymentPrefStatus === "missing" &&
                        `Currently: ${existingPaymentPref} — apps may wait for you to manually respond instead of paying instantly.`}
                      {(paymentPrefStatus === "set" || paymentPrefStatus === "done") &&
                        "Set to lud16 — apps can pay instantly via your Lightning address."}
                      {paymentPrefStatus === "error" && "Something went wrong."}
                    </p>
                  </div>
                  <button
                    onClick={handleSetPaymentPreference}
                    disabled={paymentPrefStatus === "publishing"}
                    className="shrink-0 border-2 border-ink px-4 py-2 font-display text-xs tracking-widest text-ink hover:border-jade hover:text-jade disabled:opacity-50"
                  >
                    {paymentPrefStatus === "publishing"
                      ? "PUBLISHING…"
                      : paymentPrefStatus === "done" || paymentPrefStatus === "set"
                      ? "✓ SET"
                      : "SET TO LIGHTNING"}
                  </button>
                </div>
              </div>
            </div>
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
