import { SOUND_COFFEE_SHOW_GUID } from "./identities";

// Podcasting 2.0 / Nostr boost tagging, per NIP-73 (External Content
// IDs) — the actual convention used across the ecosystem (Fountain,
// BoostMeBitch, indexers like OnlyBoosts), not something invented for
// this site. Each reference is a matched i/k tag pair. Using the real
// convention means our boosts are visible to that wider tooling, and —
// just as important — we can find *their* boosts to this show too,
// instead of only ever seeing zaps sent through our own site.

export function showTags(showGuid = SOUND_COFFEE_SHOW_GUID) {
  return [
    ["i", `podcast:guid:${showGuid}`],
    ["k", "podcast:guid"],
  ];
}

export function episodeTags(episodeGuid, showGuid = SOUND_COFFEE_SHOW_GUID) {
  return [
    ...showTags(showGuid),
    ["i", `podcast:item:guid:${episodeGuid}`],
    ["k", "podcast:item:guid"],
  ];
}

export const EPISODE_I_PREFIX = "podcast:item:guid:";

export function episodeGuidFromTags(tags) {
  const iTag = tags.find((t) => t[0] === "i" && t[1]?.startsWith(EPISODE_I_PREFIX));
  return iTag ? iTag[1].slice(EPISODE_I_PREFIX.length) : null;
}
