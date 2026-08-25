"use client";

import { useProfile } from "@/hooks/useProfile";
import { useEpisodeZaps } from "@/hooks/useEpisodeZaps";
import ZapButton from "./ZapButton";

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

export default function EpisodeComments({ episodeGuid, recipientPubkey, episodeTitle }) {
  const { data, loading, refresh } = useEpisodeZaps(episodeGuid);

  return (
    <div className="border-t border-paper/20 bg-ink px-1 py-3">
      <div className="flex items-center justify-between">
        <p className="font-display text-xs tracking-widest text-paper/60">
          {data ? `${data.count} ZAP${data.count === 1 ? "" : "S"}` : "LOADING…"}
          {data?.totalSats ? ` · ${data.totalSats.toLocaleString()} SATS` : ""}
        </p>
        <ZapButton
          recipientPubkey={recipientPubkey}
          label={`Zap: ${episodeTitle}`}
          episodeGuid={episodeGuid}
          onZapped={refresh}
          className="font-display text-xs tracking-widest text-jade hover:text-paper"
        >
          ⚡ ZAP THIS EPISODE
        </ZapButton>
      </div>

      {!loading && data?.entries?.length > 0 && (
        <div className="mt-2">
          {data.entries.map((entry, i) => (
            <CommentEntry key={i} entry={entry} />
          ))}
        </div>
      )}

      {!loading && data?.entries?.length === 0 && (
        <p className="mt-3 font-serif text-xs italic text-paper/40">
          No zaps yet on this episode &mdash; be the first.
        </p>
      )}
    </div>
  );
}
