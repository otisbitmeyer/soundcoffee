"use client";

import { useProfile } from "@/hooks/useProfile";

function shortNpub(pubkey) {
  return `${pubkey.slice(0, 8)}…`;
}

function timeAgo(ms) {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function CommentEntry({ entry }) {
  const { profile } = useProfile(entry.zapperPubkey);
  const name = profile?.display_name || profile?.name || shortNpub(entry.zapperPubkey);

  return (
    <div className="flex items-start gap-2 border-t border-paper/10 py-3 first:border-t-0">
      {profile?.picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.picture}
          alt=""
          className="h-6 w-6 shrink-0 rounded-full border border-paper/30 object-cover"
        />
      ) : (
        <div className="h-6 w-6 shrink-0 rounded-full border border-paper/20 bg-paper/5" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-xs text-paper/80">{name}</span>
          <span className="font-display text-xs text-jade">
            ⚡{entry.amountSats.toLocaleString()}
          </span>
          <span className="font-serif text-xs text-paper/40">{timeAgo(entry.at)}</span>
        </div>
        {entry.comment && (
          <p className="mt-0.5 font-serif text-sm text-paper/70">{entry.comment}</p>
        )}
      </div>
    </div>
  );
}

// Purely a display of past zaps/comments — no zap action lives here
// anymore, that's a separate always-visible button on the card itself.
export default function EpisodeComments({ data, loading }) {
  if (loading || !data) {
    return (
      <div className="border-t border-paper/20 px-6 py-3 font-serif text-xs italic text-paper/40">
        Loading…
      </div>
    );
  }

  if (data.entries.length === 0) {
    return (
      <div className="border-t border-paper/20 px-6 py-3 font-serif text-xs italic text-paper/40">
        No zaps yet on this episode — be the first.
      </div>
    );
  }

  return (
    <div className="border-t border-paper/20 px-6 py-3">
      {data.entries.map((entry, i) => (
        <CommentEntry key={i} entry={entry} />
      ))}
    </div>
  );
}
