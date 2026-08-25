// Podcast episodes come from RSS, not Nostr events, so there's no
// natural event id to zap "to". Per NIP-73 (external content ids), we
// tag episode zaps with an "i" tag using this stable convention, built
// from the episode's RSS guid — that's what lets us later query "all
// zaps for this exact episode" regardless of which show it's from.
export function episodeExternalId(guid) {
  return `podcast:episode:${guid}`;
}
