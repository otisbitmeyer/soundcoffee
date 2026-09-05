"use client";

import { useEffect, useState } from "react";
import { nip19 } from "nostr-tools";
import Header from "@/components/Header";
import LoginModal from "@/components/LoginModal";
import { useAuth } from "@/context/AuthContext";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";

/** A curated feed's row (podcast or music), expandable to browse and
 * add its own episodes/tracks directly to the featured playlist —
 * fetches lazily, only once actually clicked, reusing the same
 * preview endpoint used for adding a brand new feed. Paginated 10 at
 * a time, same "load more" pattern as the public episode lists.
 * Editable in place — changing the zap recipient re-posts to the same
 * add endpoint, which already upserts on feedUrl, rather than needing
 * to remove and re-add the whole thing. */
function CuratedFeedRow({ feed, previewEndpoint, addingEpisodeGuid, onAddEpisode, onRemove, onEditRecipient, showPodcastAddButton = true }) {
  const [expanded, setExpanded] = useState(false);
  const [episodes, setEpisodes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);
  const [editing, setEditing] = useState(false);
  const [editNpubInput, setEditNpubInput] = useState("");
  const [saving, setSaving] = useState(false);

  async function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && episodes === null) {
      setLoading(true);
      try {
        const res = await fetch(`${previewEndpoint}?url=${encodeURIComponent(feed.feedUrl)}`);
        const data = await res.json();
        setEpisodes(data.recentEpisodes || []);
      } catch {
        setEpisodes([]);
      } finally {
        setLoading(false);
      }
    }
  }

  function startEditing() {
    setEditNpubInput(feed.recipientPubkey || "");
    setEditing(true);
  }

  async function handleSaveRecipient() {
    setSaving(true);
    try {
      await onEditRecipient(feed, editNpubInput);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const visibleEpisodes = episodes?.slice(0, visibleCount) || [];
  const hasMore = episodes && visibleCount < episodes.length;

  return (
    <div className="border border-ink/15">
      <div className="flex items-center justify-between px-3 py-2">
        <button onClick={toggleExpand} className="flex flex-1 items-center gap-3 text-left">
          {feed.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={feed.image} alt="" className="h-8 w-8 border border-ink/20 object-cover" />
          )}
          <p className="font-serif text-sm text-ink">
            {feed.name}
            {!feed.recipientPubkey && (
              <span className="ml-2 font-display text-[10px] tracking-widest text-rust">
                NO ZAP RECIPIENT SET
              </span>
            )}
          </p>
          <span className="font-display text-xs text-ink/40">{expanded ? "▲" : "▼"}</span>
        </button>
        <button
          onClick={startEditing}
          className="shrink-0 font-display text-xs tracking-widest text-ink/50 hover:text-ink"
        >
          EDIT
        </button>
        <button
          onClick={() => onRemove(feed.feedUrl)}
          className="shrink-0 font-display text-xs tracking-widest text-rust hover:text-ink"
        >
          REMOVE
        </button>
      </div>

      {editing && (
        <div className="border-t border-ink/10 bg-ink/5 px-3 py-2">
          <label className="block font-display text-xs tracking-widest text-ink/60">
            ZAP RECIPIENT
          </label>
          <div className="mt-1 flex gap-2">
            <input
              value={editNpubInput}
              onChange={(e) => setEditNpubInput(e.target.value)}
              placeholder="npub or hex — leave blank to remove"
              className="flex-1 border-2 border-ink/30 px-3 py-2 font-mono text-xs focus:border-ink focus:outline-none"
            />
            <button
              onClick={handleSaveRecipient}
              disabled={saving}
              className="border-2 border-ink bg-ink px-4 py-2 font-display text-xs tracking-widest text-paper hover:bg-jade hover:border-jade disabled:opacity-50"
            >
              {saving ? "…" : "SAVE"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="font-display text-xs tracking-widest text-ink/50 hover:text-ink"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="border-t border-ink/10 px-3 py-2">
          {loading && <p className="font-serif text-xs italic text-ink/40">Loading episodes…</p>}
          {!loading && episodes?.length === 0 && (
            <p className="font-serif text-xs italic text-ink/40">No episodes found.</p>
          )}
          {!loading && visibleEpisodes.length > 0 && (
            <div className="space-y-1.5">
              {visibleEpisodes.map((ep) => (
                <div key={ep.guid} className="flex items-center justify-between gap-2 border border-ink/10 px-2 py-1.5">
                  <p className="truncate font-serif text-xs text-ink">{ep.title}</p>
                  <div className="flex shrink-0 gap-2">
                    {showPodcastAddButton && (
                      <button
                        onClick={() =>
                          onAddEpisode(ep, "podcast_episode", {
                            feedUrl: feed.feedUrl,
                            feedName: feed.name,
                            feedImage: feed.image,
                            npub: feed.recipientPubkey,
                          })
                        }
                        disabled={addingEpisodeGuid === ep.guid || !ep.audioUrl}
                        className="font-display text-[10px] tracking-widest text-jade hover:text-ink disabled:opacity-40"
                      >
                        {addingEpisodeGuid === ep.guid ? "…" : "+ ADD"}
                      </button>
                    )}
                    <button
                      onClick={() =>
                        onAddEpisode(ep, "music_track", {
                          feedUrl: feed.feedUrl,
                          feedName: feed.name,
                          feedImage: feed.image,
                          npub: feed.recipientPubkey,
                        })
                      }
                      disabled={addingEpisodeGuid === ep.guid || !ep.audioUrl}
                      className="font-display text-[10px] tracking-widest text-rust hover:text-ink disabled:opacity-40"
                    >
                      + MUSIC
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {hasMore && (
            <div className="pt-2 text-center">
              <button
                onClick={() => setVisibleCount((c) => c + 10)}
                className="font-display text-[10px] tracking-widest text-ink/50 hover:text-ink"
              >
                LOAD 10 MORE
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminRadio() {
  const { isLoggedIn, pubkey, restoring } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const isRightAccount = pubkey === SOUND_COFFEE_PUBKEY;

  const [podcasts, setPodcasts] = useState(null);
  const [musicFeeds, setMusicFeeds] = useState(null);
  const [playlist, setPlaylist] = useState(null);
  const [feedUrlInput, setFeedUrlInput] = useState("");
  const [npubInput, setNpubInput] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [adding, setAdding] = useState(false);
  const [addingEpisodeGuid, setAddingEpisodeGuid] = useState(null);
  const [musicFeedUrlInput, setMusicFeedUrlInput] = useState("");
  const [musicNpubInput, setMusicNpubInput] = useState("");
  const [musicPreview, setMusicPreview] = useState(null);
  const [musicPreviewLoading, setMusicPreviewLoading] = useState(false);
  const [musicPreviewError, setMusicPreviewError] = useState("");
  const [addingMusicFeed, setAddingMusicFeed] = useState(false);

  useEffect(() => {
    if (!isRightAccount) return;
    fetchPodcasts();
    fetchPlaylist();
    fetchMusicFeeds();
  }, [isRightAccount]);

  async function fetchMusicFeeds() {
    try {
      const res = await fetch("/api/radio-music-feeds");
      const data = await res.json();
      setMusicFeeds(data.feeds || []);
    } catch {
      setMusicFeeds([]);
    }
  }

  async function handlePreviewMusicFeed() {
    if (!musicFeedUrlInput.trim()) return;
    setMusicPreviewLoading(true);
    setMusicPreviewError("");
    setMusicPreview(null);
    try {
      const res = await fetch(`/api/radio-podcasts/preview?url=${encodeURIComponent(musicFeedUrlInput.trim())}`);
      const data = await res.json();
      if (data.error) {
        setMusicPreviewError(data.error);
      } else {
        setMusicPreview(data);
      }
    } catch {
      setMusicPreviewError("Couldn't reach that feed — check the URL and try again.");
    } finally {
      setMusicPreviewLoading(false);
    }
  }

  async function handleAddMusicFeed() {
    if (!musicPreview) return;
    setAddingMusicFeed(true);
    try {
      let recipientPubkey = null;
      if (musicNpubInput.trim()) {
        recipientPubkey = musicNpubInput.trim().startsWith("npub1")
          ? nip19.decode(musicNpubInput.trim()).data
          : musicNpubInput.trim();
      }
      await fetch("/api/radio-music-feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedUrl: musicFeedUrlInput.trim(),
          name: musicPreview.name,
          image: musicPreview.image,
          recipientPubkey,
        }),
      });
      setMusicFeedUrlInput("");
      setMusicNpubInput("");
      setMusicPreview(null);
      await fetchMusicFeeds();
    } finally {
      setAddingMusicFeed(false);
    }
  }

  async function handleRemoveMusicFeed(feedUrl) {
    await fetch("/api/radio-music-feeds/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedUrl }),
    });
    fetchMusicFeeds();
  }

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

  function toHexPubkey(npubOrHex) {
    if (!npubOrHex?.trim()) return null;
    const trimmed = npubOrHex.trim();
    return trimmed.startsWith("npub1") ? nip19.decode(trimmed).data : trimmed;
  }

  async function handleEditPodcastRecipient(podcast, npubInput) {
    await fetch("/api/radio-podcasts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feedUrl: podcast.feedUrl,
        name: podcast.name,
        image: podcast.image,
        recipientPubkey: toHexPubkey(npubInput),
      }),
    });
    fetchPodcasts();
  }

  async function handleEditMusicFeedRecipient(feed, npubInput) {
    await fetch("/api/radio-music-feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feedUrl: feed.feedUrl,
        name: feed.name,
        image: feed.image,
        recipientPubkey: toHexPubkey(npubInput),
      }),
    });
    fetchMusicFeeds();
  }

  async function handleAddEpisode(episode, trackType, feedContext) {
    setAddingEpisodeGuid(episode.guid);
    try {
      const { feedUrl, feedName, feedImage, npub } = feedContext;
      let recipientPubkey = null;
      if (npub?.trim()) {
        recipientPubkey = npub.trim().startsWith("npub1")
          ? nip19.decode(npub.trim()).data
          : npub.trim();
      }
      await fetch("/api/radio-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guid: episode.guid,
          feedUrl,
          title: episode.title,
          audioUrl: episode.audioUrl,
          image: episode.image || feedImage,
          chaptersUrl: episode.chaptersUrl,
          feedName,
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
                                  onClick={() =>
                                    handleAddEpisode(ep, "podcast_episode", {
                                      feedUrl: feedUrlInput.trim(),
                                      feedName: preview.name,
                                      feedImage: preview.image,
                                      npub: npubInput,
                                    })
                                  }
                                  disabled={addingEpisodeGuid === ep.guid || !ep.audioUrl}
                                  className="font-display text-[10px] tracking-widest text-jade hover:text-ink disabled:opacity-40"
                                >
                                  {addingEpisodeGuid === ep.guid ? "…" : "+ ADD"}
                                </button>
                                <button
                                  onClick={() =>
                                    handleAddEpisode(ep, "music_track", {
                                      feedUrl: feedUrlInput.trim(),
                                      feedName: preview.name,
                                      feedImage: preview.image,
                                      npub: npubInput,
                                    })
                                  }
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
                <p className="mt-1 font-serif text-[11px] italic text-ink/40">
                  Click a show to browse and add its own episodes directly.
                </p>
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
                    <CuratedFeedRow
                      key={p.feedUrl}
                      feed={p}
                      previewEndpoint="/api/radio-podcasts/preview"
                      addingEpisodeGuid={addingEpisodeGuid}
                      onAddEpisode={handleAddEpisode}
                      onRemove={handleRemove}
                      onEditRecipient={handleEditPodcastRecipient}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-8 border-t border-ink/10 pt-6">
                <p className="font-display text-sm text-ink">Music feeds</p>
                <p className="mt-1 font-serif text-xs text-ink/60">
                  Curated separately for repeat access — these never show
                  up in Listening Lair&rsquo;s podcast list, only the
                  featured playlist when you add a track from one.
                </p>

                <div className="mt-3 space-y-2 border border-ink/15 p-3">
                  <div className="flex gap-2">
                    <input
                      value={musicFeedUrlInput}
                      onChange={(e) => {
                        setMusicFeedUrlInput(e.target.value);
                        setMusicPreview(null);
                        setMusicPreviewError("");
                      }}
                      onKeyDown={(e) => e.key === "Enter" && handlePreviewMusicFeed()}
                      placeholder="https://example.com/music-feed.xml"
                      className="flex-1 border-2 border-ink/30 px-3 py-2 font-mono text-xs focus:border-ink focus:outline-none"
                    />
                    <button
                      onClick={handlePreviewMusicFeed}
                      disabled={musicPreviewLoading}
                      className="border-2 border-ink px-4 py-2 font-display text-xs tracking-widest text-ink hover:border-jade hover:text-jade disabled:opacity-50"
                    >
                      {musicPreviewLoading ? "…" : "PREVIEW"}
                    </button>
                  </div>

                  {musicPreviewError && (
                    <p className="font-serif text-xs text-rust">{musicPreviewError}</p>
                  )}

                  {musicPreview && (
                    <div className="border-2 border-jade/40 bg-jade/5 p-3">
                      <div className="flex items-center gap-3">
                        {musicPreview.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={musicPreview.image} alt="" className="h-12 w-12 border border-ink/20 object-cover" />
                        )}
                        <p className="font-display text-sm text-ink">{musicPreview.name}</p>
                      </div>
                      <div className="mt-3">
                        <label className="block font-display text-xs tracking-widest text-ink/60">
                          ZAP RECIPIENT (OPTIONAL)
                        </label>
                        <input
                          value={musicNpubInput}
                          onChange={(e) => setMusicNpubInput(e.target.value)}
                          placeholder="npub or hex — leave blank if this artist doesn't have one yet"
                          className="mt-1 w-full border-2 border-ink/30 px-3 py-2 font-mono text-xs focus:border-ink focus:outline-none"
                        />
                      </div>
                      <button
                        onClick={handleAddMusicFeed}
                        disabled={addingMusicFeed}
                        className="mt-3 w-full border-2 border-ink bg-ink px-4 py-2 font-display text-xs tracking-widest text-paper hover:bg-jade hover:border-jade disabled:opacity-50"
                      >
                        {addingMusicFeed ? "ADDING…" : "+ ADD TO MUSIC FEEDS"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-3 space-y-2">
                  {musicFeeds === null && (
                    <p className="font-serif text-xs italic text-ink/40">Loading…</p>
                  )}
                  {musicFeeds?.length === 0 && (
                    <p className="font-serif text-xs italic text-ink/40">
                      No music feeds added yet.
                    </p>
                  )}
                  {musicFeeds?.map((f) => (
                    <CuratedFeedRow
                      key={f.feedUrl}
                      feed={f}
                      previewEndpoint="/api/radio-podcasts/preview"
                      addingEpisodeGuid={addingEpisodeGuid}
                      onAddEpisode={handleAddEpisode}
                      onRemove={handleRemoveMusicFeed}
                      onEditRecipient={handleEditMusicFeedRecipient}
                      showPodcastAddButton={false}
                    />
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
