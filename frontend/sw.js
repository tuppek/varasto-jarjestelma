const CACHE = "varasto-v20";
const SHELL_PATHS = new Set([
  "/",
  "/static/css/style.css",
  "/static/js/i18n.js",
  "/static/js/app.js",
  "/manifest.webmanifest",
]);

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll([
        "/static/icons/icon-192.png",
        "/static/icons/icon-512.png",
      ])
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isShellRequest(url) {
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (path === "/") return true;
  if (SHELL_PATHS.has(path)) return true;
  if (path.startsWith("/static/js/") || path.startsWith("/static/css/")) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (isShellRequest(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request);
    })
  );
});
