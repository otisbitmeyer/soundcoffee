"use client";

import { useState, useRef, useEffect } from "react";
import { SimplePool } from "nostr-tools/pool";
import ZapButton from "./ZapButton";
import EpisodeComments from "./EpisodeComments";
import { useEpisodeZaps } from "@/hooks/useEpisodeZaps";
import { useEpisodeNote } from "@/hooks/useEpisodeNote";
import { useChapters } from "@/hooks/useChapters";
import { useAuth } from "@/context/AuthContext";
import { episodeTags } from "@/lib/episodeId";
import { DEFAULT_RELAYS } from "@/lib/relays";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";

let publishPool;
function getPublishPool() {
  if (!publishPool) publishPool = new SimplePool();
  return publishPool;
}

function formatDate(dateString) {
  try {
    return new Date(dateString).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function formatChapterTime(seconds) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

// Show notes from RSS commonly carry HTML markup (paragraphs, links) —
// stripped to plain text here rather than rendered as HTML, which
// avoids any injection risk entirely rather than needing to sanitize it.
function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<(p|br|div|li)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function EpisodeCard({ episode }) {
  const [playing, setPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState(null); // null | "notes" | "chapters" | "comments"
  const [publishing, setPublishing] = useState(false);
  const { data, loading, refresh } = useEpisodeZaps(episode.guid);
  const { noteId, loading: noteLoading, refresh: refreshNote } = useEpisodeNote(episode.guid);
  const { chapters, loading: chaptersLoading, load: loadChapters } = useChapters(episode.chaptersUrl);
  const { pubkey, signEvent } = useAuth();
  const isSoundCoffeeAccount = pubkey === SOUND_COFFEE_PUBKEY;

  const showNotes = stripHtml(episode.description);

  const audioRef = useRef(null);
  const pendingSeekRef = useRef(null); // seconds to seek to once the audio element is ready

  // Applies a pending seek once the <audio> element actually exists —
  // covers both "already playing, seek immediately" and "wasn't
  // playing yet, start playing then seek once mounted".
  useEffect(() => {
    if (playing && pendingSeekRef.current != null && audioRef.current) {
      audioRef.current.currentTime = pendingSeekRef.current;
      audioRef.current.play().catch(() => {});
      pendingSeekRef.current = null;
    }
  }, [playing]);

  function handleChapterClick(startTime) {
    pendingSeekRef.current = startTime;
    if (playing && audioRef.current) {
      audioRef.current.currentTime = startTime;
      audioRef.current.play().catch(() => {});
      pendingSeekRef.current = null;
    } else {
      setPlaying(true); // effect above applies the seek once mounted
    }
  }

  function selectTab(tab) {
    if (tab === "chapters" && activeTab !== "chapters") loadChapters();
    setActiveTab((current) => (current === tab ? null : tab));
  }

  async function handlePublishNote() {
    setPublishing(true);
    try {
      const template = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: episodeTags(episode.guid),
        content: `🎙️ New episode: "${episode.title}"\n\n${episode.link}`,
      };
      const signed = await signEvent(template);
      await Promise.any(getPublishPool().publish(DEFAULT_RELAYS, signed));
      refreshNote();
    } catch {
      // best-effort — the zap flow still works fine without a note,
      // it just won't show comments as prominently in other clients
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="border-2 border-paper/30 transition hover:border-jade">
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="font-display text-sm tracking-widest text-jade">
              {formatDate(episode.pubDate)}
            </span>
            <h3 className="mt-2 font-display text-xl">{episode.title}</h3>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            {episode.audioUrl ? (
              <button
                onClick={() => setPlaying((p) => !p)}
                className="border-2 border-paper/50 px-4 py-2 font-display text-sm tracking-widest text-paper transition hover:border-jade hover:text-jade"
              >
                {playing ? "CLOSE" : "PLAY ▸"}
              </button>
            ) : (
              <a
                href={episode.link}
                target="_blank"
                rel="noopener noreferrer"
                className="font-display text-sm tracking-widest text-paper/50 hover:text-jade"
              >
                LISTEN &rarr;
              </a>
            )}

            {episode.guid && (
              <ZapButton
                recipientPubkey={SOUND_COFFEE_PUBKEY}
                label={`Zap: ${episode.title}`}
                episodeGuid={episode.guid}
                eventId={noteId || undefined}
                onZapped={refresh}
                className="font-display text-xs tracking-widest text-jade transition hover:text-paper"
              >
                ⚡ ZAP
              </ZapButton>
            )}

            {episode.guid && isSoundCoffeeAccount && !noteLoading && !noteId && (
              <button
                onClick={handlePublishNote}
                disabled={publishing}
                title="Publishes a Nostr note for this episode so zap comments show up clearly in other clients"
                className="font-display text-xs tracking-widest text-rust transition hover:text-paper disabled:opacity-50"
              >
                {publishing ? "PUBLISHING…" : "📝 PUBLISH NOTE"}
              </button>
            )}
          </div>
        </div>

        {playing && episode.audioUrl && (
          <audio
            ref={audioRef}
            controls
            autoPlay
            src={episode.audioUrl}
            className="mt-4 w-full"
          >
            Your browser doesn&rsquo;t support inline audio.{" "}
            <a href={episode.link}>Listen on the episode page instead.</a>
          </audio>
        )}
      </div>

      {episode.guid && (
        <>
          <div className="flex border-t border-paper/20">
            {showNotes && (
              <button
                onClick={() => selectTab("notes")}
                className={`flex-1 px-3 py-2.5 font-display text-[11px] tracking-widest transition ${
                  activeTab === "notes" ? "bg-paper/10 text-jade" : "text-paper/50 hover:text-paper"
                }`}
              >
                SHOW NOTES
              </button>
            )}
            {episode.chaptersUrl && (
              <button
                onClick={() => selectTab("chapters")}
                className={`flex-1 px-3 py-2.5 font-display text-[11px] tracking-widest transition ${
                  activeTab === "chapters" ? "bg-paper/10 text-jade" : "text-paper/50 hover:text-paper"
                }`}
              >
                CHAPTERS
              </button>
            )}
            <button
              onClick={() => selectTab("comments")}
              className={`flex-1 px-3 py-2.5 font-display text-[11px] tracking-widest transition ${
                activeTab === "comments" ? "bg-paper/10 text-jade" : "text-paper/50 hover:text-paper"
              }`}
            >
              ZAPS &amp; COMMENTS
            </button>
          </div>

          {activeTab === "notes" && (
            <div className="border-t border-paper/20 px-6 py-4">
              <p className="whitespace-pre-line break-words font-serif text-sm text-paper/80">{showNotes}</p>
            </div>
          )}

          {activeTab === "chapters" && (
            <div className="border-t border-paper/20 px-6 py-3">
              {chaptersLoading && (
                <p className="font-serif text-xs text-paper/50">Loading chapters…</p>
              )}
              {!chaptersLoading && chapters?.length > 0 && (
                <ul className="space-y-1.5">
                  {chapters.map((ch, i) => (
                    <li key={i}>
                      <button
                        onClick={() => handleChapterClick(ch.startTime)}
                        className="flex w-full items-baseline gap-3 text-left font-serif text-sm text-paper/80 hover:text-jade"
                      >
                        <span className="shrink-0 font-mono text-xs text-jade/70">
                          {formatChapterTime(ch.startTime)}
                        </span>
                        {ch.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!chaptersLoading && chapters?.length === 0 && (
                <p className="font-serif text-xs italic text-paper/40">
                  No chapters for this episode.
                </p>
              )}
            </div>
          )}

          {activeTab === "comments" && <EpisodeComments data={data} loading={loading} />}
        </>
      )}
    </div>
  );
}

export default function EpisodeList({ episodes, count }) {
  const list = count ? episodes.slice(0, count) : episodes;

  return (
    <div className="grid gap-4">
      {list.map((ep, i) => (
        <EpisodeCard key={ep.guid || i} episode={ep} />
      ))}
    </div>
  );
}
