const CACHE_NAME = "ekichika-gohan-shell-personal-1";
const APP_SHELL = ["./", "./index.html", "./luxury-dark.css?v=personal-1", "./app.js?v=personal-1"];
const OPTIONAL = ["./manifest.webmanifest", "./icon.svg"];
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async path => {
      const request = new Request(new URL(path, self.registration.scope), { cache: "reload" });
      const response = await fetch(request);
      if (!response.ok) throw new Error(`App shell fetch failed: ${path}`);
      await cache.put(request, response);
    }));
    await Promise.all(OPTIONAL.map(path => cache.add(path).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME &&
      (key === "ekichika-gohan-v1" || key.startsWith("ekichika-gohan-shell-")))
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  // 外部APIの通信は横取りしません。
  if (request.method !== "GET" || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const file = url.pathname.slice(scope.pathname.length);
  const allowed = ["", "index.html", "luxury-dark.css", "app.js", "manifest.webmanifest", "icon.svg"];
  if (!allowed.includes(file)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request, { cache: "no-cache" });
      if (response.ok) {
        try { await cache.put(request, response.clone()); } catch (error) { console.warn("Cache write failed", error); }
      }
      return response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        const fallback = await cache.match(new URL("./index.html", self.registration.scope));
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});
