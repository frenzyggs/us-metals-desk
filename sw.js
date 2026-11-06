// Service worker: caches the app shell only. Desk data (d/...) is never cached.
const SHELL = "us-metals-shell-v1";
const FILES = ["./", "index.html", "app.css", "app.js", "chart.js", "manifest.json",
  "icons/apple-touch-icon.png", "icons/icon-512.png"];
self.addEventListener("install", e => e.waitUntil(
  caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.pathname.includes("/d/")) return; // always network — never cache publish data
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
