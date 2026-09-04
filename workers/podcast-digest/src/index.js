import { XMLParser } from "fast-xml-parser";
import { finalizeEvent, nip19 } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";

// --- Configuration -----------------------------------------------------

const FEEDS = [
  { name: "Chad and Reeds Podcast", url: "https://serve.podhome.fm/rss/7c6f7875-2b73-491e-b32c-e2c8d6e91d53" },
  { name: "Open Markets Podcast", url: "https://feeds.fountain.fm/iKaquCnTj0q5Bg2VfGRD" },
  { name: "Local Bitcoiners", url: "https://feeds.fountain.fm/uv4pyDVtNAiiCCx5emOU" },
  { name: "Podhome Show (cb8c973f)", url: "https://serve.podhome.fm/rss/cb8c973f-ed99-4658-b0d8-51524529a31d" },
];

const RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "item" || name === "podcast:transcript",
});

// --- Feed parsing --------------------------------------------------------

async function fetchLatestEpisode(feed) {
  const res = await fetch(feed.url, {
    headers: { "User-Agent": "sound-coffee-digest-bot/1.0" },
  });
  if (!res.ok) {
    throw new Error(`Fetch failed for ${feed.name}: ${res.status}`);
  }
  const xml = await res.text();
  const data = xmlParser.parse(xml);
  const channel = data?.rss?.channel;
  const items = channel?.item;
  if (!items || items.length === 0) return null;

  const item = items[0];
  const guid = typeof item.guid === "object" ? item.guid["#text"] : item.guid;

  let transcripts = item["podcast:transcript"];
  if (transcripts && !Array.isArray(transcripts)) transcripts = [transcripts];
  const transcriptUrl =
    transcripts?.find((t) => t["@_type"]?.includes("text"))?.["@_url"] ||
    transcripts?.[0]?.["@_url"] ||
    null;

  return {
    feedName: feed.name,
    guid: String(guid),
    title: item.title,
    link: item.link || item["podcast:contentLink"]?.["@_href"] || feed.url,
    description: stripHtml(
      typeof item.description === "object" ? item.description["#text"] : item.description || ""
    ),
    pubDate: item.pubDate,
    transcriptUrl,
  };
}

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Summarization ---------------------------------------------------

async function summarizeEpisode(episode, env) {
  let sourceText = episode.description;

  if (episode.transcriptUrl) {
    try {
      const tRes = await fetch(episode.transcriptUrl);
      if (tRes.ok) {
        const raw = await tRes.text();
        sourceText = raw
          .replace(/<[^>]+>/g, " ")
          .replace(/\d{2}:\d{2}:\d{2}[,.]\d{3}.*-->.*\n?/g, "")
          .replace(/^\d+$/gm, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60000);
      }
    } catch (err) {
      console.error(`Transcript fetch failed for ${episode.title}:`, err);
    }
  }

  const prompt = `You're writing one short digest entry for a Nostr note about Bitcoin/Nostr/V4V podcast news.

Podcast: ${episode.feedName}
Episode: ${episode.title}

Source material (transcript or show notes):
"""
${sourceText}
"""

Write 1-2 sentences (under 240 characters total) highlighting anything relevant to Nostr protocol developments, NIPs, Lightning/V4V, or Bitcoin commerce tooling. Skip generic pleasantries. If nothing notably relevant appears, summarize the episode's main topic briefly instead. Return only the summary text, no preamble.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    console.error("Claude API error:", await res.text());
    return episode.description.slice(0, 200);
  }

  const data = await res.json();
  const text = data.content?.find((b) => b.type === "text")?.text?.trim();
  return text || episode.description.slice(0, 200);
}

// --- Nostr publishing --------------------------------------------------
//
// Uses SimplePool (nostr-tools) rather than a hand-rolled WebSocket
// connection — this is the same approach the main Sound Coffee Worker
// already uses successfully throughout that project. Cloudflare's own
// docs and third-party sources genuinely disagree on whether a raw
// `new WebSocket(url)` reliably works for *outbound* connections in
// Workers specifically (their own protocols support table lists
// outbound TCP explicitly but leaves outbound WebSocket blank) — rather
// than trust an unproven implementation against conflicting
// documentation, this uses the exact mechanism already confirmed
// working in production elsewhere in this codebase.

function resolveSecretKey(nsecOrHex) {
  if (nsecOrHex.startsWith("nsec")) {
    const decoded = nip19.decode(nsecOrHex);
    return decoded.data;
  }
  const bytes = new Uint8Array(nsecOrHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(nsecOrHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

let pool;
function getPool() {
  if (!pool) pool = new SimplePool();
  return pool;
}

async function publishDigest(summaryLines, env) {
  const sk = resolveSecretKey(env.BOT_NSEC);
  const date = new Date().toISOString().slice(0, 10);

  const content = [
    `📻 Nostr/V4V podcast digest — ${date}`,
    "",
    ...summaryLines,
  ].join("\n");

  const event = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["t", "nostr"], ["t", "v4v"], ["t", "bitcoin"]],
      content,
    },
    sk
  );

  const results = await Promise.allSettled(getPool().publish(RELAYS, event));
  const okCount = results.filter((r) => r.status === "fulfilled").length;
  console.log(`Published to ${okCount}/${RELAYS.length} relays. Event id: ${event.id}`);
  return { event, okCount };
}

// --- Main cron flow ------------------------------------------------------

async function runDigest(env) {
  const summaryLines = [];

  for (const feed of FEEDS) {
    try {
      const episode = await fetchLatestEpisode(feed);
      if (!episode) continue;

      const kvKey = `lastseen:${feed.url}`;
      const lastSeenGuid = await env.DIGEST_KV.get(kvKey);

      if (lastSeenGuid === episode.guid) {
        continue;
      }

      const summary = await summarizeEpisode(episode, env);
      summaryLines.push(`• ${episode.feedName} — ${episode.title}\n  ${summary}\n  ${episode.link}`);

      await env.DIGEST_KV.put(kvKey, episode.guid);
    } catch (err) {
      console.error(`Error processing feed ${feed.name}:`, err);
    }
  }

  if (summaryLines.length === 0) {
    console.log("No new episodes today. Staying silent.");
    return { published: false, reason: "no new episodes" };
  }

  const { event, okCount } = await publishDigest(summaryLines, env);
  return { published: true, eventId: event.id, relaysOk: okCount, episodeCount: summaryLines.length };
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runDigest(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/run") {
      const result = await runDigest(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("Nostr podcast digest bot is running. POST/GET /run to trigger manually.");
  },
};
