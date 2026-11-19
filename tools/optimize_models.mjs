#!/usr/bin/env node
/**
 * Optimizes public/models/*.glb using @gltf-transform + Meshopt:
 *   - Idempotent: skips files already using EXT_meshopt_compression unless --force
 *   - Preserves all wheel_* / head_* / brake_* / hazard_* node names & material names
 *   - Selectively simplifies overly dense body shells (> 3000 verts, non-special nodes)
 *   - Quantizes attributes + applies EXT_meshopt_compression (level: medium)
 *   - Round-trip verifies node names, material names, and bounding boxes before saving
 *
 * Run: node tools/optimize_models.mjs [--force]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBounds, NodeIO, PropertyType } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, simplifyPrimitive, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelsDir = path.join(repo, 'public/models');
const force = process.argv.includes('--force');

const SPECIAL_NODE_RE = /^(wheel|head|brake|hazard)/i;
const MAX_TOTAL_BYTES = 700 * 1024;
const MAX_BBOX_DELTA = 0.025;

function readGlbJson(buf) {
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
}

function collectMeta(doc) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const bounds = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] };
  const specialNodes = root
    .listNodes()
    .map((n) => n.getName())
    .filter((name) => SPECIAL_NODE_RE.test(name))
    .sort();
  const materialNames = root
    .listMaterials()
    .map((m) => m.getName())
    .filter(Boolean)
    .sort();
  return { bounds, specialNodes, materialNames };
}

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);

const io = new NodeIO()
  .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
  .registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });

const files = fs
  .readdirSync(modelsDir)
  .filter((f) => f.endsWith('.glb'))
  .sort();

assert.ok(files.length > 0, `No .glb files found in ${modelsDir}`);

let totalBefore = 0;
let totalAfter = 0;

for (const file of files) {
  const filePath = path.join(modelsDir, file);
  const srcBytes = fs.readFileSync(filePath);
  const beforeBytes = srcBytes.byteLength;
  totalBefore += beforeBytes;

  const header = readGlbJson(srcBytes);
  const alreadyMeshopt = Array.isArray(header.extensionsUsed) && header.extensionsUsed.includes('EXT_meshopt_compression');

  if (alreadyMeshopt && !force) {
    totalAfter += beforeBytes;
    console.log(`${file.padEnd(14)} ${(beforeBytes / 1024).toFixed(1).padStart(6)} KB (already meshopt, skipped)`);
    continue;
  }

  const doc = await io.readBinary(new Uint8Array(srcBytes));
  const beforeMeta = collectMeta(doc);

  // Clean redundant accessors/meshes while keeping every leaf node and named material intact.
  await doc.transform(
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE, PropertyType.SKIN] }),
    prune({ keepLeaves: true }),
  );

  // Selectively simplify overly dense body shells (e.g. alto.glb) without touching lights/wheels.
  const specialMeshSet = new Set();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (mesh && SPECIAL_NODE_RE.test(node.getName())) {
      specialMeshSet.add(mesh);
    }
  }
  for (const mesh of doc.getRoot().listMeshes()) {
    if (specialMeshSet.has(mesh)) continue;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos || pos.getCount() <= 3000) continue;
      weldPrimitive(prim, { tolerance: 1e-4 });
      simplifyPrimitive(prim, {
        simplifier: MeshoptSimplifier,
        ratio: 0.4,
        error: 0.002,
      });
    }
  }

  await doc.transform(
    quantize({
      quantizePosition: 14,
      quantizeNormal: 8,
      quantizeTexcoord: 12,
    }),
    meshopt({
      encoder: MeshoptEncoder,
      level: 'medium',
      quantizePosition: 14,
      quantizeNormal: 8,
      quantizeTexcoord: 12,
    }),
  );

  const outBinary = await io.writeBinary(doc);

  // Round-trip validation before overwriting the source file.
  const verifyDoc = await io.readBinary(outBinary);
  const afterMeta = collectMeta(verifyDoc);
  const outHeader = readGlbJson(Buffer.from(outBinary));
  assert.ok(
    Array.isArray(outHeader.extensionsUsed) && outHeader.extensionsUsed.includes('EXT_meshopt_compression'),
    `${file}: missing EXT_meshopt_compression in output`,
  );
  assert.deepEqual(afterMeta.specialNodes, beforeMeta.specialNodes, `${file}: special nodes mismatch`);
  assert.deepEqual(afterMeta.materialNames, beforeMeta.materialNames, `${file}: material names mismatch`);
  for (let i = 0; i < 3; i++) {
    const dMin = Math.abs(afterMeta.bounds.min[i] - beforeMeta.bounds.min[i]);
    const dMax = Math.abs(afterMeta.bounds.max[i] - beforeMeta.bounds.max[i]);
    assert.ok(dMin <= MAX_BBOX_DELTA, `${file}: bbox min[${i}] shifted by ${dMin.toFixed(4)} m`);
    assert.ok(dMax <= MAX_BBOX_DELTA, `${file}: bbox max[${i}] shifted by ${dMax.toFixed(4)} m`);
  }

  fs.writeFileSync(filePath, outBinary);
  totalAfter += outBinary.byteLength;
  const pct = (((beforeBytes - outBinary.byteLength) / beforeBytes) * 100).toFixed(1);
  console.log(
    `${file.padEnd(14)} ${(beforeBytes / 1024).toFixed(1).padStart(6)} KB -> ${(outBinary.byteLength / 1024).toFixed(1).padStart(6)} KB (-${pct}%)`,
  );
}

console.log(`Total: ${(totalBefore / 1024).toFixed(1)} KB -> ${(totalAfter / 1024).toFixed(1)} KB`);
assert.ok(totalAfter < MAX_TOTAL_BYTES, `Total GLB size ${(totalAfter / 1024).toFixed(1)} KB exceeds 700 KB budget`);
