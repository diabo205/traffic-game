import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paint } from './strip';

/** Vibrant Honda CD-70 tank palette (no near-black paints that disappear into kerbside shadows). */
export const PARKED_BIKE_COLORS = ['#c62828', '#c62828', '#1565c0', '#2e7d32', '#4a525e', '#d97706'] as const;

/**
 * Builds a single vertex-colored parked Honda CD-70 geometry in local space
 * (front facing -Z, grounded at y = 0) with visible silver rim hubs,
 * chrome forks/fenders/muffler, metallic engine case, headlamp/taillight,
 * and a striped petrol tank.
 */
export function buildParkedBikeGeometry(tankColor: string): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, col: string) => {
    const ni = g.index ? g.toNonIndexed() : g;
    if (ni !== g) g.dispose();
    if (!ni.getAttribute('normal')) ni.computeVertexNormals();
    if (ni.getAttribute('uv')) ni.deleteAttribute('uv');
    paint(ni, col);
    parts.push(ni);
  };

  for (const z of [-0.58, 0.58]) {
    add(new THREE.CylinderGeometry(0.28, 0.28, 0.085, 10).rotateZ(Math.PI / 2).translate(0, 0.28, z), '#25282c');
    add(new THREE.CylinderGeometry(0.155, 0.155, 0.098, 8).rotateZ(Math.PI / 2).translate(0, 0.28, z), '#d0d5dc');
  }

  add(new THREE.BoxGeometry(0.12, 0.045, 0.34).rotateX(0.18).translate(0, 0.56, -0.57), '#d6dbe0');
  add(new THREE.BoxGeometry(0.13, 0.045, 0.36).rotateX(-0.22).translate(0, 0.56, 0.59), '#d6dbe0');

  add(new THREE.BoxGeometry(0.08, 0.075, 0.78).translate(0, 0.63, 0.05), '#3c4248');
  add(new THREE.BoxGeometry(0.24, 0.25, 0.3).translate(0, 0.35, -0.04), '#9aa2ab');
  add(new THREE.CylinderGeometry(0.038, 0.042, 0.72, 6).rotateX(Math.PI / 2).translate(0.145, 0.27, 0.26), '#d8dde3');

  for (const sx of [-0.08, 0.08]) {
    add(new THREE.CylinderGeometry(0.022, 0.024, 0.62, 5).rotateX(0.32).translate(sx, 0.57, -0.485), '#dfe4ea');
  }
  add(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 6).rotateZ(Math.PI / 2).translate(0, 0.94, -0.39), '#d4d8dd');
  for (const sx of [-0.26, 0.26]) {
    add(new THREE.BoxGeometry(0.12, 0.04, 0.04).translate(sx, 0.94, -0.39), '#25282c');
  }

  add(new THREE.CylinderGeometry(0.08, 0.08, 0.11, 8).rotateX(Math.PI / 2).translate(0, 0.81, -0.46), '#25282c');
  add(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 8).rotateX(Math.PI / 2).translate(0, 0.81, -0.52), '#f7f4e4');
  add(new THREE.BoxGeometry(0.12, 0.075, 0.05).translate(0, 0.72, 0.72), '#d32f2f');

  add(new THREE.BoxGeometry(0.27, 0.2, 0.44).translate(0, 0.74, -0.17), tankColor);
  add(new THREE.BoxGeometry(0.285, 0.045, 0.34).translate(0, 0.75, -0.17), '#f4f1e8');
  add(new THREE.BoxGeometry(0.23, 0.16, 0.22).translate(0, 0.55, 0.15), tankColor);
  add(new THREE.BoxGeometry(0.23, 0.105, 0.56).translate(0, 0.75, 0.33), '#2a2625');
  add(new THREE.BoxGeometry(0.24, 0.03, 0.09).translate(0, 0.76, 0.64), '#d6dbe0');

  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged ?? new THREE.BoxGeometry(0.4, 0.9, 1.5);
}
