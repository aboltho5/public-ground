/* Public Ground service worker: keeps the app working offline and serves downloaded map tiles. */
var VERSION = "v2.0.0";
var SHELL = "pg-shell-" + VERSION;
var TILES = "pg-tiles-v1";
var FONTS = "pg-fonts-v1";
var SHELL_FILES = [
  "./", "index.html", "css/app.css",
  "js/core.js", "js/layers.js", "js/items.js", "js/field.js", "js/offline.js", "js/sync.js", "js/app.js",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"
];
var TILE_HOSTS = ["basemap.nationalmap.gov", "elevation.nationalmap.gov"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(SHELL_FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("pg-shell-") === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  // the app itself: network first so updates arrive, cached copy when offline
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res.ok) { var copy = res.clone(); caches.open(SHELL).then(function (c) { c.put(req, copy); }); }
        return res;
      }).catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (hit) {
          return hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error());
        });
      })
    );
    return;
  }

  // downloaded USGS map tiles: serve from the offline cache first
  if (TILE_HOSTS.indexOf(url.hostname) >= 0) {
    e.respondWith(
      caches.open(TILES).then(function (c) { return c.match(req.url); }).then(function (hit) { return hit || fetch(req); })
    );
    return;
  }

  // fonts: use the saved copy, refresh in the background
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(FONTS).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(function () { return hit; });
        return hit || net;
      });
    }));
  }
});
