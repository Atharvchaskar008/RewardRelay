// SAKER PWA Service Worker
const CACHE_NAME = "saker-pwa-v1";
const STATIC_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Strictly ignore internal Next.js server actions, API routes, Web3 RPCs, Firebase auth
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/__") ||
    url.hostname.includes("rpc") ||
    url.hostname.includes("firebase") ||
    url.hostname.includes("identitytoolkit") ||
    url.protocol.startsWith("chrome-extension")
  ) {
    return;
  }

  // Navigation requests: Network-first with cache fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const indexCached = await caches.match("/");
        return indexCached || new Response("Offline", { status: 503, statusText: "Offline" });
      }),
    );
    return;
  }

  // Static assets (CSS, JS, fonts, icons): Stale-while-revalidate or Cache-first
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".svg")
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      }),
    );
    return;
  }

  // Default network fetch with cache fallback
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
