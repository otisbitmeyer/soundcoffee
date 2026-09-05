"use client";

import { useEffect, useState } from "react";
import { nip19 } from "nostr-tools";
import Header from "@/components/Header";
import LoginModal from "@/components/LoginModal";
import { useAuth } from "@/context/AuthContext";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";

export default function AdminRadio() {
  const { isLoggedIn, pubkey, restoring } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const isRightAccount = pubkey === SOUND_COFFEE_PUBKEY;

  const [podcasts, setPodcasts] = useState(null);
  const [playlist, setPlaylist] = useState(null);
  const [feedUrlInput, setFeedUrlInput] = useState("");
  const [npubInput, setNpubInput] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [adding, setAdding] = useState(false);
  const [addingEpisodeGuid, setAddingEpisodeGuid] = useState(null);

  useEffect(() => {
    if (!isRightAccount) return;
    fetchPodcasts();
    fetchPlaylist();
  }, [isRightAccount]);

  async function fetchPlaylist() {
    try {
      const res = await fetch("/api/radio-playlist");
      const data = await res.json();
      setPlaylist(data.episodes || []);
    } catch {
      setPlaylist([]);
    }
  }

  async function handleRemoveFromPlaylist(guid) {
    await fetch("/api/radio-playlist/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guid }),
    });
    fetchPlaylist();
  }

  async function fetchPodcasts() {
    try {
      const res = await fetch("/api/radio-podcasts");
      const data = await res.json();
      setPodcasts(data.podcasts || []);
    } catch {
      setPodcasts([]);
    }
  }

  async function handlePreview() {
    if (!feedUrlInput.trim()) return;
    setPreviewLoading(true);
    setPreviewError("");
    setPreview(null);
    try {
      const res = await fetch(`/api/radio-podcasts/preview?url=${encodeURIComponent(feedUrlInput.trim())}`);
      const data = await res.json();
      if (data.error) {
        setPreviewError(data.error);
      } else {
        setPreview(data);
      }
    } catch {
      setPreviewError("Couldn't reach that feed — check the URL and try again.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleAdd() {
    if (!preview) return;
    setAdding(true);
    try {
      let recipientPubkey = null;
      if (npubInput.trim()) {
        recipientPubkey = npubInput.trim().startsWith("npub1")
          ? nip19.decode(npubInput.trim()).data
          : npubInput.trim();
      }
      await fetch("/api/radio-podcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedUrl: feedUrlInput.trim(),
          name: preview.name,
          image: preview.image,
          recipientPubkey,
        }),
      });
      setFeedUrlInput("");
      setNpubInput("");
      setPreview(null);
      await fetchPodcasts();
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(feedUrl) {
    await fetch("/api/radio-podcasts/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedUrl }),
    });
    fetchPodcasts();
  }

  async function handleAddEpisode(episode, trackType) {
    setAddingEpisodeGuid(episode.guid);
    try {
      let recipientPubkey = null;
      if (npubInput.trim()) {
        recipientPubkey = npubInput.trim().startsWith("npub1")
          ? nip19.decode(npubInput.trim()).data
          : npubInput.trim();
      }
      await fetch("/api/radio-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guid: episode.guid,
          feedUrl: feedUrlInput.trim(),
          title: episode.title,
          audioUrl: episode.audioUrl,
          image: episode.image || preview.image,
          chaptersUrl: episode.chaptersUrl,
          feedName: preview.name,
          recipientPubkey,
          trackType,
        }),
      });
      await fetchPodcasts(); // the episode's show may now be newly curated too (unless it was added as music)
      await fetchPlaylist();
    } finally {
      setAddingEpisodeGuid(null);
    }
  }

  return (
    <>
      <Header />
      <main className="admin-fonts flex-1 bg-paper">
        <div className="mx-auto max-w-2xl px-6 py-16">
          <h1 className="font-display text-2xl tracking-wide text-ink">
            RADIO CURATION
          </h1>
          <p className="mt-2 font-serif text-sm text-ink/60">
            Podcasts added here show up in Listening Lair, alongside
            Sound Coffee&rsquo;s own show.
          </p>

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
              <div className="mt-8 border-2 border-ink/20 p-5">
                <p className="font-display text-sm text-ink">Add a podcast</p>
                <p className="mt-1 font-serif text-xs text-ink/50">
                  Paste its RSS feed URL directly — we&rsquo;ll fetch and
                  preview it before adding.
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    value={feedUrlInput}
                    onChange={(e) => {
                      setFeedUrlInput(e.target.value);
                      setPreview(null);
                      setPreviewError("");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handlePreview()}
                    placeholder="https://example.com/feed.xml"
                    className="flex-1 border-2 border-ink/30 px-3 py-2 font-mono text-xs focus:border-ink focus:outline-none"
                  />
                  <button
                    onClick={handlePreview}
                    disabled={previewLoading}
                    className="border-2 border-ink px-4 py-2 font-display text-xs tracking-widest text-ink hover:border-jade hover:text-jade disabled:opacity-50"
                  >
                    {previewLoading ? "…" : "PREVIEW"}
                  </button>
                </div>

                {previewError && (
                  <p className="mt-2 font-serif text-xs text-rust">{previewError}</p>
                )}

                {preview && (
                  <div className="mt-3 border-2 border-jade/40 bg-jade/5 p-3">
                    <div className="flex items-center gap-3">
                      {preview.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={preview.image} alt="" className="h-12 w-12 border border-ink/20 object-cover" />
                      )}
                      <div>
                        <p className="font-display text-sm text-ink">{preview.name}</p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <label className="block font-display text-xs tracking-widest text-ink/60">
                        ZAP RECIPIENT (OPTIONAL)
                      </label>
                      <input
                        value={npubInput}
                        onChange={(e) => setNpubInput(e.target.value)}
                        placeholder="npub or hex — leave blank if this show doesn't have one yet"
                        className="mt-1 w-full border-2 border-ink/30 px-3 py-2 font-mono text-xs focus:border-ink focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={handleAdd}
                      disabled={adding}
                      className="mt-3 w-full border-2 border-ink bg-ink px-4 py-2 font-display text-xs tracking-widest text-paper hover:bg-jade hover:border-jade disabled:opacity-50"
                    >
                      {adding ? "ADDING…" : "+ ADD WHOLE SHOW TO RADIO LIST"}
                    </button>

                    {preview.recentEpisodes?.length > 0 && (
                      <div className="mt-4 border-t border-ink/10 pt-3">
                        <p className="font-display text-xs tracking-widest text-ink/50">
                          OR ADD SPECIFIC TRACKS TO THE FEATURED PLAYLIST
                        </p>
                        <p className="mt-1 font-serif text-[11px] italic text-ink/40">
                          &ldquo;ADD&rdquo; also curates this show into the general
                          podcast list automatically. &ldquo;MUSIC&rdquo; never does —
                          for V4V music feeds that shouldn&rsquo;t show up as a
                          browsable podcast.
                        </p>
                        <div className="mt-2 space-y-1.5">
                          {preview.recentEpisodes.map((ep) => (
                            <div key={ep.guid} className="flex items-center justify-between gap-2 border border-ink/10 px-2 py-1.5">
                              <p className="truncate font-serif text-xs text-ink">{ep.title}</p>
                              <div className="flex shrink-0 gap-2">
                                <button
                                  onClick={() => handleAddEpisode(ep, "podcast_episode")}
                                  disabled={addingEpisodeGuid === ep.guid || !ep.audioUrl}
                                  className="font-display text-[10px] tracking-widest text-jade hover:text-ink disabled:opacity-40"
                                >
                                  {addingEpisodeGuid === ep.guid ? "…" : "+ ADD"}
                                </button>
                                <button
                                  onClick={() => handleAddEpisode(ep, "music_track")}
                                  disabled={addingEpisodeGuid === ep.guid || !ep.audioUrl}
                                  className="font-display text-[10px] tracking-widest text-rust hover:text-ink disabled:opacity-40"
                                >
                                  + MUSIC
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-6">
                <p className="font-display text-sm text-ink">Currently curated</p>
                <div className="mt-2 space-y-2">
                  {podcasts === null && (
                    <p className="font-serif text-xs italic text-ink/40">Loading…</p>
                  )}
                  {podcasts?.length === 0 && (
                    <p className="font-serif text-xs italic text-ink/40">
                      Nothing added yet — just Sound Coffee&rsquo;s own show shows in Listening Lair for now.
                    </p>
                  )}
                  {podcasts?.map((p) => (
                    <div
                      key={p.feedUrl}
                      className="flex items-center justify-between border border-ink/15 px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        {p.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.image} alt="" className="h-8 w-8 border border-ink/20 object-cover" />
                        )}
                        <p className="font-serif text-sm text-ink">
                          {p.name}
                          {!p.recipientPubkey && (
                            <span className="ml-2 font-display text-[10px] tracking-widest text-rust">
                              NO ZAP RECIPIENT SET
                            </span>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemove(p.feedUrl)}
                        className="font-display text-xs tracking-widest text-rust hover:text-ink"
                      >
                        REMOVE
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6">
                <p className="font-display text-sm text-ink">Featured playlist</p>
                <div className="mt-2 space-y-2">
                  {playlist === null && (
                    <p className="font-serif text-xs italic text-ink/40">Loading…</p>
                  )}
                  {playlist?.length === 0 && (
                    <p className="font-serif text-xs italic text-ink/40">
                      Nothing featured yet.
                    </p>
                  )}
                  {playlist?.map((e) => (
                    <div
                      key={e.guid}
                      className="flex items-center justify-between border border-ink/15 px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        {e.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={e.image} alt="" className="h-8 w-8 border border-ink/20 object-cover" />
                        )}
                        <div>
                          <p className="font-serif text-sm text-ink">{e.title}</p>
                          <p className="font-display text-[10px] tracking-widest text-ink/40">
                            {e.feedName}
                            {e.trackType === "music_track" && (
                              <span className="ml-2 text-rust">MUSIC</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveFromPlaylist(e.guid)}
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
