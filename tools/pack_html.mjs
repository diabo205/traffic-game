#!/usr/bin/env node
/**
 * Builds a self-contained single-file HTML bundle for mobile & offline playback.
 * Run with: node tools/pack_html.mjs --build [--out PATH]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outPath = path.resolve(outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : path.join(repo, 'dist/Karachi Traffic 3D.html'));

if (args.includes('--build')) {
  const viteBin = path.join(repo, 'node_modules/vite/bin/vite.js');
  execFileSync(process.execPath, [viteBin, 'build'], {
    cwd: repo,
    stdio: 'inherit',
    env: { ...process.env, SINGLE_FILE: '1' },
  });
}

const assetsDir = path.join(repo, 'dist/assets');
const files = readdirSync(assetsDir);
const cssFile = files.find((f) => f.startsWith('index-') && f.endsWith('.css'));
const jsFiles = files.filter((f) => f.endsWith('.js'));
const jsFile = jsFiles.find((f) => f.startsWith('index-'));
if (!cssFile || !jsFile) throw new Error('Missing dist bundle; run SINGLE_FILE=1 npm run build first');
if (jsFiles.length !== 1) {
  throw new Error(`Expected single unsplit JS bundle under SINGLE_FILE=1, found ${jsFiles.length}: ${jsFiles.join(', ')}`);
}

let css = readFileSync(path.join(assetsDir, cssFile), 'utf8');
css = css.replace(/@font-face\{[^}]+\}/g, (block) => {
  const woff2Match = block.match(/url\((?:\/|\.\/)?assets\/(barlow-condensed-latin-\d+-(?:normal|italic)-[^)]+\.woff2)\)/);
  if (!woff2Match) return '';
  const fontBytes = readFileSync(path.join(assetsDir, woff2Match[1]));
  const dataUri = 'data:font/woff2;base64,' + fontBytes.toString('base64');
  return block.replace(/src:[^;}]+/, `src:url("${dataUri}") format("woff2")`);
});

const MODEL_NAMES = ['alto', 'coupe', 'rickshaw', 'suv', 'minibus', 'bike', 'cart', 'car', 'truck'];
const models = {};
for (const m of MODEL_NAMES) {
  models[m] = readFileSync(path.join(repo, 'public/models', `${m}.glb`)).toString('base64');
}

const js = readFileSync(path.join(assetsDir, jsFile), 'utf8').replaceAll('</script', '<\\/script');

const fetchShim = `(function(){
  var M = ${JSON.stringify(models)};
  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var match = url.match(/models\\/(${MODEL_NAMES.join('|')})\\.glb(?:\\?.*)?$/);
    if (match && M[match[1]]) {
      var bin = atob(M[match[1]]);
      var buf = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return Promise.resolve(new Response(buf, { status: 200, headers: { 'Content-Type': 'model/gltf-binary' } }));
    }
    if (!origFetch) return Promise.reject(new Error('Offline fetch blocked: ' + url));
    return origFetch(input, init);
  };
})();`;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
    <meta name="theme-color" content="#d9d3c4" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230b1530'/%3E%3Cpath d='M4 22l5-12h5l-5 12zm11 0l5-12h8l-1.5 3.5h-3.2L19.8 22z' fill='%23c6f432'/%3E%3C/svg%3E" />
    <title>Karachi Traffic 3D</title>
    <style>#loading{color:#5a3d12;z-index:10;text-align:center;background:#d9d3c4;justify-content:center;align-items:center;padding:16px;font:700 16px system-ui,sans-serif;display:flex;position:fixed;inset:0}</style>
    <style>${css}</style>
  </head>
  <body>
    <div id="app"></div>
    <div id="ui"></div>
    <div id="loading">Loading Karachi…</div>
    <script>${fetchShim}</script>
    <script type="module">${js}</script>
  </body>
</html>
`;

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');
console.log('Wrote standalone HTML:', outPath, (html.length / 1024 / 1024).toFixed(2), 'MB');
