const CACHE = "lumina-shell-v2";
const STATIC = ["/", "/manifest.json", "/lumina.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(STATIC))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("lumina-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "lumina-shell-version") event.ports[0]?.postMessage(CACHE);
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // The worker only handles the public application shell. Supabase and
  // requests with query parameters (including recovery links) bypass it.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.search ||
    request.headers.has("Authorization")
  )
    return;
  const shell =
    request.mode === "navigate" && ["/", "/index.html"].includes(url.pathname);
  const hashedAsset =
    /^\/assets\/[a-zA-Z0-9._-]+$/.test(url.pathname) &&
    ["script", "style", "font", "image"].includes(request.destination);
  if (!shell && !hashedAsset && !STATIC.includes(url.pathname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const key = shell ? "/" : request;
      if (hashedAsset) {
        const saved = await cache.match(key);
        if (saved) return saved;
      }
      try {
        const response = await fetch(request);
        if (response.ok && !response.redirected)
          await cache.put(key, response.clone());
        return response;
      } catch {
        return (await cache.match(key)) || Response.error();
      }
    })(),
  );
});
