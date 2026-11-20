import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const MANIFEST = {
  name: 'Karachi Traffic 3D',
  short_name: 'Karachi 3D',
  description: 'Low-poly 3D arcade driving through real Saddar & Lyari Expressway to Clifton.',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'any',
  background_color: '#0b1530',
  theme_color: '#d9d3c4',
  icons: [
    { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
};

function fnv1aHex(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function fnv1aBytes(buf: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function readPublicAsset(relPath: string): Uint8Array | null {
  const proc = (globalThis as {
    process?: { getBuiltinModule?: (id: string) => { readFileSync?: (u: URL) => Uint8Array } | undefined };
  }).process;
  const fsMod = proc?.getBuiltinModule?.('node:fs');
  if (!fsMod?.readFileSync) return null;
  return fsMod.readFileSync(new URL(`./public/${relPath}`, import.meta.url));
}

function isSingleFile(): boolean {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.SINGLE_FILE === '1';
}

function karachiPwaPlugin(): Plugin {
  const single = isSingleFile();
  return {
    name: 'karachi-pwa',
    configureServer(server) {
      if (single) return;
      server.middlewares.use('/manifest.webmanifest', (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        res.end(JSON.stringify(MANIFEST, null, 2));
      });
    },
    transformIndexHtml(html) {
      if (!single) return html;
      return html
        .replace(/<link[^>]*rel="manifest"[^>]*>\s*/gi, '')
        .replace(/<link[^>]*rel="apple-touch-icon"[^>]*>\s*/gi, '');
    },
    generateBundle(_options, bundle) {
      if (single) return;
      const emitted = Object.keys(bundle)
        .filter((f) => f.endsWith('.js') || f.endsWith('.css') || f.endsWith('.html') || (/latin-\d+-.*\.woff2$/.test(f)))
        .sort();
      const staticAssets = [
        './',
        './index.html',
        './manifest.webmanifest',
        './icon.svg',
        './icon-192.png',
        './icon-512.png',
        './models/alto.glb',
        './models/coupe.glb',
        './models/rickshaw.glb',
        './models/suv.glb',
        './models/minibus.glb',
        './models/bike.glb',
        './models/cart.glb',
        './models/car.glb',
        './models/truck.glb',
      ];
      const precache = Array.from(new Set([...staticAssets, ...emitted.map((f) => `./${f}`)]));
      const modelFingerprints = staticAssets
        .filter((asset) => asset.startsWith('./models/') && asset.endsWith('.glb'))
        .map((asset) => {
          const bytes = readPublicAsset(asset.slice(2));
          return bytes ? `${asset}:${fnv1aBytes(bytes)}` : asset;
        });
      const version = fnv1aHex([...precache, ...modelFingerprints].join('|'));

      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: JSON.stringify(MANIFEST, null, 2) + '\n',
      });

      const swSource = `/* Karachi Traffic 3D Offline Service Worker */
const CACHE = 'kt3d-v-${version}';
const PRECACHE = ${JSON.stringify(precache, null, 2)};

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
`;
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: swSource,
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [karachiPwaPlugin()],
  // Reachable from phones on the LAN and through hosted preview links,
  // which arrive under hostnames Vite doesn't know.
  server: { host: true, allowedHosts: true },
  preview: { host: true, allowedHosts: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: isSingleFile() ? 2000 : 800,
    rolldownOptions: {
      output: isSingleFile()
        ? { codeSplitting: false }
        : {
            manualChunks(id: string) {
              if (id.includes('node_modules/three/')) return 'three';
              return undefined;
            },
          },
    },
  },
});
