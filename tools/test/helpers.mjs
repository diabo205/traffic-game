import { createServer } from 'vite';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Loads pure TypeScript simulation & input modules through Vite's SSR loader
 * so extensionless TS imports resolve exactly as in production builds.
 */
export async function loadSimModules() {
  const server = await createServer({
    root: repoRoot,
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  });
  try {
    const [types, upgrades, playerCar, worldMod, cityWorldMod, road, cityMapMod, cityTrafficMod, faresMod, mathMod, inputMod] = await Promise.all([
      server.ssrLoadModule('/src/sim/types.ts'),
      server.ssrLoadModule('/src/sim/upgrades.ts'),
      server.ssrLoadModule('/src/sim/PlayerCar.ts'),
      server.ssrLoadModule('/src/sim/World.ts'),
      server.ssrLoadModule('/src/sim/city/CityWorld.ts'),
      server.ssrLoadModule('/src/sim/road.ts'),
      server.ssrLoadModule('/src/sim/city/cityMap.ts'),
      server.ssrLoadModule('/src/sim/city/CityTraffic.ts'),
      server.ssrLoadModule('/src/sim/city/Fares.ts'),
      server.ssrLoadModule('/src/sim/math.ts'),
      server.ssrLoadModule('/src/input/InputManager.ts'),
    ]);
    return {
      types,
      upgrades,
      playerCar,
      worldMod,
      cityWorldMod,
      road,
      cityMapMod,
      cityTrafficMod,
      faresMod,
      mathMod,
      inputMod,
      server,
      async close() {
        await server.close();
      },
    };
  } catch (err) {
    await server.close();
    throw err;
  }
}

export function makeInput(overrides = {}) {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    horn: false,
    dipper: false,
    ...overrides,
  };
}

/**
 * Creates a standard W3C Gamepad-compatible object for InputManager tests.
 */
export function createMockGamepad({ buttons = {}, axes = [0, 0, 0, 0], connected = true } = {}) {
  const btnArr = Array.from({ length: 17 }, (_, idx) => {
    const spec = buttons[idx];
    if (typeof spec === 'number') {
      return { pressed: spec > 0.1, touched: spec > 0, value: spec };
    }
    if (typeof spec === 'boolean') {
      return { pressed: spec, touched: spec, value: spec ? 1 : 0 };
    }
    if (spec && typeof spec === 'object') {
      return {
        pressed: Boolean(spec.pressed),
        touched: Boolean(spec.touched ?? spec.pressed),
        value: typeof spec.value === 'number' ? spec.value : spec.pressed ? 1 : 0,
      };
    }
    return { pressed: false, touched: false, value: 0 };
  });
  return {
    id: 'Mock Standard Gamepad',
    index: 0,
    connected,
    mapping: 'standard',
    axes: [...axes],
    buttons: btnArr,
    timestamp: 0,
  };
}

/**
 * Lightweight EventTarget + navigator.getGamepads harness that runs the REAL
 * InputManager TypeScript class without mocking InputManager itself.
 */
export function createInputHarness(InputManagerClass) {
  const target = new EventTarget();
  target.screen = { orientation: { angle: 0 } };

  let currentPads = [];
  const nav = globalThis.navigator;
  const origDesc = nav ? Object.getOwnPropertyDescriptor(nav, 'getGamepads') : undefined;
  if (nav) {
    Object.defineProperty(nav, 'getGamepads', {
      configurable: true,
      writable: true,
      value: () => currentPads,
    });
  }

  const input = new InputManagerClass(target);

  function dispatchKey(type, code, { repeat = false, key = code } = {}) {
    const ev = new Event(type);
    ev.code = code;
    ev.key = key;
    ev.repeat = repeat;
    ev.preventDefault = () => {};
    target.dispatchEvent(ev);
    return ev;
  }

  return {
    input,
    target,
    pressKey(code, opts = {}) {
      return dispatchKey('keydown', code, opts);
    },
    releaseKey(code, opts = {}) {
      return dispatchKey('keyup', code, opts);
    },
    tapKey(code, opts = {}) {
      dispatchKey('keydown', code, opts);
      if (!opts.repeat) dispatchKey('keyup', code, opts);
    },
    blur() {
      target.dispatchEvent(new Event('blur'));
    },
    setGamepad(pad) {
      currentPads = pad ? [pad] : [];
    },
    restore() {
      if (nav) {
        if (origDesc) Object.defineProperty(nav, 'getGamepads', origDesc);
        else delete nav.getGamepads;
      }
    },
  };
}

function listTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out.sort();
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/**
 * Inspects all TypeScript files in src/sim/ for CLAUDE.md purity invariants.
 */
export function scanSimPurity() {
  const simDir = path.join(repoRoot, 'src/sim');
  const files = listTsFiles(simDir);
  const violations = [];
  const patterns = [
    { name: 'three-import', re: /\bfrom\s+['"]three['"]/ },
    { name: 'dynamic-import', re: /\bimport\s*\(/ },
    { name: 'cross-layer-import', re: /\bfrom\s+['"][^'"]*\/(render|ui|input|audio)\b/ },
    { name: 'window-ref', re: /\bwindow\s*\./ },
    { name: 'globalThis-window', re: /\bglobalThis\s*\.\s*window\b/ },
    { name: 'document-ref', re: /\bdocument\s*\./ },
    { name: 'localStorage', re: /\blocalStorage\b/ },
    { name: 'sessionStorage', re: /\bsessionStorage\b/ },
    { name: 'fetch-call', re: /\bfetch\s*\(/ },
    { name: 'crypto-random', re: /\bcrypto\s*\.\s*getRandomValues\s*\(/ },
    { name: 'math-random', re: /\bMath\.random\s*\(/ },
    { name: 'date-now', re: /\bDate\.now\s*\(/ },
    { name: 'performance-now', re: /\bperformance\.now\s*\(/ },
  ];
  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const code = stripComments(raw);
    for (const p of patterns) {
      if (p.re.test(code)) {
        violations.push({ file: path.relative(repoRoot, file), rule: p.name });
      }
    }
  }
  return { files: files.map((f) => path.relative(repoRoot, f)), violations };
}
