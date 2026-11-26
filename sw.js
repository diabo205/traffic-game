/* Karachi Traffic 3D Offline Service Worker */
const CACHE = 'kt3d-v-2dcbe4a2';
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
  "./assets/CityScenery-DDDhHKwt.js",
  "./assets/CityWorld-CvRhFcea.js",
  "./assets/Environment-Dd92d0D_.js",
  "./assets/FareVisuals-CPAqgfl6.js",
  "./assets/Landmarks-BOz1407v.js",
  "./assets/PropVisuals-DOIln1WT.js",
  "./assets/Props-BPmUbl-s.js",
  "./assets/TrafficManager-BBixsH9n.js",
  "./assets/World-B-9M05jI.js",
  "./assets/barlow-condensed-latin-600-normal-BN11TKSn.woff2",
  "./assets/barlow-condensed-latin-700-normal-B9NQhHK3.woff2",
  "./assets/barlow-condensed-latin-800-italic-BaEn-VSx.woff2",
  "./assets/barlow-condensed-latin-800-normal-jAD-BpyZ.woff2",
  "./assets/barlow-condensed-latin-900-italic-CNr-ajSH.woff2",
  "./assets/cityMap-VsMGdIq4.js",
  "./assets/index-CiDwkvpO.js",
  "./assets/index-NhHux0zR.css",
  "./assets/rng-DNxfwzzg.js",
  "./assets/strip-BKYERV5u.js",
  "./assets/three-4N0R7IT-.js"
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
