/* Karachi Traffic 3D Offline Service Worker */
const CACHE = 'kt3d-v-844f8c5b';
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./models/alto.glb",
  "./models/coupe.glb",
  "./models/rickshaw.glb",
  "./models/suv.glb",
  "./models/minibus.glb",
  "./models/bike.glb",
  "./models/cart.glb",
  "./models/car.glb",
  "./models/truck.glb",
  "./assets/CityScenery-RQI5BBYW.js",
  "./assets/CityWorld-DMgorUws.js",
  "./assets/Environment-BJ6j1lGy.js",
  "./assets/FareVisuals-Cr4IL83U.js",
  "./assets/Landmarks-CSi3vBBW.js",
  "./assets/PropVisuals-D9Vp0K9O.js",
  "./assets/Props-BPmUbl-s.js",
  "./assets/TrafficManager-CFucsUY4.js",
  "./assets/World-ntj_mEtJ.js",
  "./assets/barlow-condensed-latin-600-normal-BN11TKSn.woff2",
  "./assets/barlow-condensed-latin-700-normal-B9NQhHK3.woff2",
  "./assets/barlow-condensed-latin-800-italic-BaEn-VSx.woff2",
  "./assets/barlow-condensed-latin-800-normal-jAD-BpyZ.woff2",
  "./assets/barlow-condensed-latin-900-italic-CNr-ajSH.woff2",
  "./assets/cityMap-VsMGdIq4.js",
  "./assets/index-C3WvimIe.css",
  "./assets/index-DoBRZ4ym.js",
  "./assets/rng-DNxfwzzg.js",
  "./assets/strip-BSPJRlp_.js",
  "./assets/three-G_PbA-BZ.js"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kt3d-v-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    }),
  );
});
