"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";

const EMPTY = { name: "", origin: "", producer: "", process: "", tasting: "", story: "", note: "", roastWeek: 2 };

const FIELDS = [
  ["name", "Coffee name", "e.g. Huehuetenango"],
  ["origin", "Origin", "Country, region"],
  ["producer", "Farm or producer (optional)", ""],
  ["process", "Process (optional)", "washed, natural, honey…"],
];

/**
 * Merchant Settings → Club roast. Edits the coffee shown on the /join page.
 * Saving signs a short-lived Nostr event with the Sound Coffee key, which
 * the Worker checks before storing anything.
 */
export default function ClubRoastAdmin() {
  const { signEvent } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/club-roast")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.roast) setForm({ ...EMPTY, ...d.roast });
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setError("Couldn't load the current roast.");
        setStatus("ready");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (status === "saved") setStatus("ready");
  };

  async function save() {
    setError("");
    setStatus("saving");
    try {
      const signed = await signEvent({
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["u", `${window.location.origin}/api/club-roast`], ["method", "POST"]],
        content: JSON.stringify(form),
      });
      const res = await fetch("/api/club-roast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: signed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save.");
      setForm({ ...EMPTY, ...data.roast });
      setStatus("saved");
    } catch (e) {
      setError(e.message);
      setStatus("ready");
    }
  }

  const input = "mt-1 w-full border-2 border-ink bg-white px-3 py-2 font-serif text-sm text-ink";
  const label = "block font-display text-xs tracking-wide text-ink";

  return (
    <div className="mt-10 border-2 border-ink/20 p-5">
      <p className="font-display text-sm text-ink">CLUB ROAST</p>
      <p className="mt-1 font-serif text-xs text-ink/60">
        The coffee shown on the join page under &ldquo;This month&rsquo;s Sound Coffee.&rdquo; Change it
        when the coffee changes. It goes live as soon as you save.
      </p>

      {status === "loading" ? (
        <p className="mt-4 font-serif text-xs text-ink/60">Loading…</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {FIELDS.map(([key, text, ph]) => (
            <label key={key} className={label}>
              {text.toUpperCase()}
              <input className={input} value={form[key]} onChange={set(key)} placeholder={ph} maxLength={160} />
            </label>
          ))}
          <label className={label}>
            TASTING NOTES
            <input className={input} value={form.tasting} onChange={set("tasting")} maxLength={400}
              placeholder="Full body, sweet, with cherry juice on the finish." />
          </label>
          <label className={label}>
            STORY
            <textarea className={`${input} min-h-[96px]`} value={form.story} onChange={set("story")} maxLength={1200} />
          </label>
          <label className={label}>
            ROAST WEEK OF THE MONTH
            <select className={input} value={form.roastWeek} onChange={set("roastWeek")}>
              <option value={1}>First week (days 1–7)</option>
              <option value={2}>Second week (days 8–14)</option>
              <option value={3}>Third week (days 15–21)</option>
              <option value={4}>Fourth week (days 22–28)</option>
            </select>
          </label>
          <label className={label}>
            ROAST NOTE
            <input className={input} value={form.note} onChange={set("note")} maxLength={400}
              placeholder="I roast once a month and send everything out right after." />
          </label>

          {error && (
            <p className="border-2 border-rust bg-rust/10 px-3 py-2 font-serif text-xs text-rust">{error}</p>
          )}
          <div className="flex items-center gap-4">
            <button
              onClick={save}
              disabled={status === "saving" || !form.name.trim()}
              className="border-2 border-ink bg-ink px-5 py-2 font-display text-sm text-paper hover:bg-rust hover:border-rust disabled:opacity-50"
            >
              {status === "saving" ? "SAVING…" : "SAVE"}
            </button>
            {status === "saved" && <span className="font-serif text-xs text-jade">Saved. The join page is updated.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
