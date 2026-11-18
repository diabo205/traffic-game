import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Shared geometry helpers for hand-built landmark models. Render-only. */

/** Pointed (Gothic) arch outline, springing at y = h - hw, apex at y = h. */
export function pointedArchShape(hw: number, h: number, shape: THREE.Shape | THREE.Path = new THREE.Shape()): THREE.Shape | THREE.Path {
  const spring = Math.max(0, h - hw * 1.25);
  shape.moveTo(-hw, 0);
  shape.lineTo(-hw, spring);
  shape.quadraticCurveTo(-hw, h - hw * 0.25, 0, h);
  shape.quadraticCurveTo(hw, h - hw * 0.25, hw, spring);
  shape.lineTo(hw, 0);
  shape.lineTo(-hw, 0);
  return shape;
}

/** Moulded stone frame around a pointed opening, `depth` deep, front face at z = 0. */
export function archFrameGeo(hw: number, h: number, band: number, depth: number): THREE.BufferGeometry {
  const outer = pointedArchShape(hw + band, h + band) as THREE.Shape;
  outer.holes.push(pointedArchShape(hw, h, new THREE.Path()) as THREE.Path);
  const geo = new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: false, curveSegments: 6 });
  geo.translate(0, 0, -depth);
  return geo;
}

/** Symmetric gable roof prism: ridge along z, eaves at y = 0, total width `w`. */
export function gableRoofGeo(w: number, rise: number, len: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, rise);
  s.lineTo(-w / 2, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  geo.translate(0, 0, -len / 2);
  return geo;
}

/** Merge every direct child mesh of `g` that shares a material into one mesh (draw-call budget). */
export function mergeByMaterial(g: THREE.Group, shadow: boolean): void {
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const keep: THREE.Object3D[] = [];
  // Flatten plain sub-groups (e.g. a face built in its own tilted frame).
  const flat: Array<[THREE.Mesh, THREE.Material, THREE.Matrix4]> = [];
  const visit = (o: THREE.Object3D, parent: THREE.Matrix4) => {
    o.updateMatrix();
    const m = parent.clone().multiply(o.matrix);
    if (o instanceof THREE.Mesh && !Array.isArray(o.material)) flat.push([o, o.material, m]);
    else if (o.type === 'Group') for (const c of o.children) visit(c, m);
    else keep.push(o);
  };
  for (const child of g.children) visit(child, new THREE.Matrix4());
  for (const [child, mat, matrix] of flat) {
    let geo = child.geometry.clone().applyMatrix4(matrix);
    if (geo.index) geo = geo.toNonIndexed();
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    geo.clearGroups();
    const list = buckets.get(mat) ?? [];
    list.push(geo);
    buckets.set(mat, list);
  }
  g.clear();
  for (const k of keep) g.add(k);
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    for (const geo of geos) geo.dispose();
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = shadow;
    m.receiveShadow = true;
    g.add(m);
  }
}

