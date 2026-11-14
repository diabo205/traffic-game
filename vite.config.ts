import { defineConfig } from 'vite';

export default defineConfig({
  // Reachable from phones on the LAN and through hosted preview links,
  // which arrive under hostnames Vite doesn't know.
  server: { host: true, allowedHosts: true },
  preview: { host: true, allowedHosts: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
  },
});
