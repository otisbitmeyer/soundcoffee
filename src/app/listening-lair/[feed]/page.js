import { PODCAST_FEEDS } from "@/lib/podcastFeeds";
import ShowPage from "@/components/ShowPage";

export function generateStaticParams() {
  return PODCAST_FEEDS.map((feed) => ({ feed: feed.slug }));
}

export default async function Page({ params }) {
  const { feed: slug } = await params;
  const feed = PODCAST_FEEDS.find((f) => f.slug === slug);

  if (!feed) {
    return (
      <main className="flex-1 bg-ink px-6 py-24 text-center text-paper">
        <p className="font-display text-2xl">Show not found.</p>
      </main>
    );
  }

  return <ShowPage feed={feed} />;
}
