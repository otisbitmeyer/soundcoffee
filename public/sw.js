// Sound Coffee service worker. Deliberately simple: cache the static
// site shell for offline/repeat-visit speed, but NEVER cache anything
// under /api/* — orders, payments, and inventory must always hit the
// network live. Serving stale data there would be actively wrong, not
// just slow.

const CACHE_NAME = "sound-coffee-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never touch API calls or non-GET requests — always live, never cached.
  if (url.pathname.startsWith("/api/") || event.request.method !== "GET") {
    return;
  }

  // Only handle our own origin — never intercept requests to relays,
  // Stripe, rss2json fallbacks, or anywhere else.
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cached);

      // Stale-while-revalidate: serve the cached version instantly if we
      // have one (fast repeat visits), while quietly updating the cache
      // in the background for next time. Falls through to the network
      // on a true first visit.
      return cached || networkFetch;
    })
  );
});
