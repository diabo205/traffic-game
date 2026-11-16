/* Karachi Traffic 3D Offline Service Worker */
const CACHE = 'kt3d-v-0bdab8fd';
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./models/alto.glb",
  "./models/rickshaw.glb",
  "./models/minibus.glb",
  "./models/bike.glb",
  "./models/cart.glb",
  "./models/car.glb",
  "./models/truck.glb",
  "./assets/CityScenery-CKXop521.js",
  "./assets/CityWorld-CMEFer2M.js",
  "./assets/Environment-ByzJ-C62.js",
  "./assets/FareVisuals-DdD9K94f.js",
  "./assets/Landmarks-DtjTdkOs.js",
  "./assets/PropVisuals-B9zxhF5M.js",
  "./assets/Props-C0hBFWgW.js",
  "./assets/TrafficManager-BTQbPZpD.js",
  "./assets/World-Bcw-FSwb.js",
  "./assets/barlow-condensed-latin-600-normal-BN11TKSn.woff2",
  "./assets/barlow-condensed-latin-700-normal-B9NQhHK3.woff2",
  "./assets/barlow-condensed-latin-800-italic-BaEn-VSx.woff2",
  "./assets/barlow-condensed-latin-800-normal-jAD-BpyZ.woff2",
  "./assets/barlow-condensed-latin-900-italic-CNr-ajSH.woff2",
  "./assets/cityMap-ZjVbJdhZ.js",
  "./assets/index-D24cu38Y.css",
  "./assets/index-nxPweLEk.js",
  "./assets/rng-DNxfwzzg.js",
  "./assets/strip-Co5lGTIp.js",
  "./assets/three-IYqxmJ37.js"
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
