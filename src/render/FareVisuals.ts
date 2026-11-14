import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { KERB_H } from '../sim/city/cityMap';
import type { Fares } from '../sim/city/Fares';
import type { Pedestrian } from '../sim/city/Pedestrians';
import { paint } from './strip';

/** Shalwar kameez colours, waistcoats and caps for waiting passengers. */
const KAMEEZ = ['#f2efe6', '#7fa7c9', '#c9b38a', '#4f6d5a', '#d9c7a8', '#8a4f3d', '#2f3b52', '#e7d27a'];
const DUPATTA = ['#c2185b', '#00897b', '#f9a825', '#5e35b1'];
/** Marker colour by ride length / type: short, medium, long, VIP. */
const TIER = ['#3ddc84', '#ffc23d', '#ff4d4d', '#ff2d6f'];

function personGeometry(variant: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: string) => {
    paint(g, color);
    parts.push(g.toNonIndexed());
  };
  const kameez = KAMEEZ[variant % KAMEEZ.length];
  const woman = variant % 3 === 1;
  // Shalwar legs, long kameez, head, hair / cap, arms (left arm separate: it waves).
  add(new THREE.CylinderGeometry(0.11, 0.13, 0.8, 6).translate(-0.1, 0.4, 0), '#e9e4d8');
  add(new THREE.CylinderGeometry(0.11, 0.13, 0.8, 6).translate(0.1, 0.4, 0), '#e9e4d8');
  add(new THREE.CylinderGeometry(0.21, 0.3, 0.85, 8).translate(0, 1.15, 0), kameez);
  add(new THREE.SphereGeometry(0.13, 10, 8).translate(0, 1.72, 0), '#a8775a');
  if (woman) add(new THREE.CylinderGeometry(0.17, 0.25, 0.55, 8, 1, true).translate(0, 1.6, 0), DUPATTA[variant % DUPATTA.length]);
  else add(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 10).translate(0, 1.84, 0), variant % 2 ? '#f5f5f5' : '#2b2b2b');
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.62, 5).translate(0.27, 1.22, 0), kameez);
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g ?? new THREE.BoxGeometry(0.4, 1.8, 0.3);
}

interface Person {
  root: THREE.Group;
  body: THREE.Mesh;
  arm: THREE.Mesh;
  marker: THREE.Mesh;
  variant: number;
}

interface AmbientPerson {
  root: THREE.Group;
  body: THREE.Mesh;
  arm: THREE.Mesh;
}

/**
 * Passengers waiting at the kerb (waving when you're close), a bobbing marker
 * over each coloured by ride length, a tall beam + bouncing arrow over the
 * destination, and ambient kerbside pedestrians who leap away cleanly.
 */
export class FareVisuals {
  readonly group = new THREE.Group();
  private people = new Map<number, Person>();
  private peds = new Map<number, AmbientPerson>();
  private geos = new Map<number, THREE.BufferGeometry>();
  private personMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private armGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.62, 5).translate(0, -0.29, 0);
  private armMats = KAMEEZ.map((c) => new THREE.MeshLambertMaterial({ color: c }));
  private markerGeo = new THREE.ConeGeometry(0.42, 0.8, 4).rotateX(Math.PI);
  private markerMats = TIER.map((c) => new THREE.MeshBasicMaterial({ color: c }));
  private beam: THREE.Mesh;
  private ring: THREE.Mesh;
  private destArrow: THREE.Mesh;

  constructor() {
    const beamMat = new THREE.MeshBasicMaterial({ color: '#16c95f', transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 60, 24, 1, true).translate(0, 30, 0), beamMat);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#3ddc84', transparent: true, opacity: 0.7, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(9, 10, 40).rotateX(-Math.PI / 2), ringMat);
    const arrowGeo = mergeGeometries([
      new THREE.ConeGeometry(1.7, 2.4, 4).rotateX(Math.PI).translate(0, 0, 0),
      new THREE.BoxGeometry(0.85, 2.2, 0.85).translate(0, 2.1, 0),
    ]) ?? new THREE.ConeGeometry(1.7, 2.4, 4).rotateX(Math.PI);
    const arrowMat = new THREE.MeshBasicMaterial({ color: '#c6f432', fog: false });
    this.destArrow = new THREE.Mesh(arrowGeo, arrowMat);
    this.beam.visible = this.ring.visible = this.destArrow.visible = false;
    this.beam.renderOrder = this.ring.renderOrder = this.destArrow.renderOrder = 2;
    this.group.add(this.beam, this.ring, this.destArrow);
  }

  private geometry(variant: number): THREE.BufferGeometry {
    let g = this.geos.get(variant);
    if (!g) this.geos.set(variant, (g = personGeometry(variant)));
    return g;
  }

  private make(variant: number, tier: number, party: boolean): Person {
    const root = new THREE.Group();
    const body = new THREE.Mesh(this.geometry(variant), this.personMat);
    body.castShadow = true;
    const arm = new THREE.Mesh(this.armGeo, this.armMats[variant % this.armMats.length]);
    arm.position.set(-0.27, 1.52, 0);
    const marker = new THREE.Mesh(this.markerGeo, this.markerMats[tier] ?? this.markerMats[0]);
    marker.position.y = 2.6;
    root.add(body, arm, marker);
    if (party) {
      const friend = new THREE.Mesh(this.geometry((variant + 3) % KAMEEZ.length), this.personMat);
      friend.position.set(0.58, 0, -0.14);
      friend.castShadow = true;
      root.add(friend);
    }
    this.group.add(root);
    return { root, body, arm, marker, variant };
  }

  private makeAmbient(variant: number): AmbientPerson {
    const root = new THREE.Group();
    const body = new THREE.Mesh(this.geometry(variant), this.personMat);
    body.castShadow = false;
    const arm = new THREE.Mesh(this.armGeo, this.armMats[variant % this.armMats.length]);
    arm.position.set(-0.27, 1.52, 0);
    root.add(body, arm);
    this.group.add(root);
    return { root, body, arm };
  }

  update(f: Fares, px: number, pz: number, time: number, peds: readonly Pedestrian[] = []): void {
    const seen = new Set<number>();
    for (const w of f.waiting) {
      seen.add(w.id);
      let person = this.people.get(w.id);
      if (!person) {
        person = this.make(w.variant, w.tier, w.kind === 'party');
        this.people.set(w.id, person);
      }
      const r = person.root;
      r.position.set(w.x, KERB_H, -w.z);
      // Face the car; wave and hop when it's near.
      const dx = px - w.x, dz = pz - w.z;
      const d = Math.hypot(dx, dz);
      r.rotation.y = Math.atan2(dx, -dz) + Math.PI;
      const near = d < 35 && f.onShift && !f.fare;
      person.arm.rotation.z = near ? -2.6 + Math.sin(time * 9) * 0.45 : 0;
      r.position.y = KERB_H + (near ? Math.abs(Math.sin(time * 5)) * 0.06 : 0);
      person.marker.visible = f.onShift && !f.fare;
      person.marker.position.y = 2.6 + Math.sin(time * 3 + w.id) * 0.18;
      person.marker.rotation.y = time * 2;
      // Being picked up: shrink toward the car.
      const s = 1 - Math.min(1, w.board / 0.7) * 0.25;
      r.scale.setScalar(s);
    }
    for (const [id, person] of this.people) {
      if (!seen.has(id)) {
        this.group.remove(person.root);
        this.people.delete(id);
      }
    }

    // Ambient sidewalk pedestrians who dive away if car rushes close.
    const seenPed = new Set<number>();
    for (const pd of peds) {
      seenPed.add(pd.id);
      let ap = this.peds.get(pd.id);
      if (!ap) {
        ap = this.makeAmbient(pd.variant);
        this.peds.set(pd.id, ap);
      }
      ap.root.position.set(pd.x, KERB_H + pd.y, -pd.z);
      ap.root.rotation.order = 'YXZ';
      if (pd.state === 'dive') {
        ap.root.rotation.y = pd.facing;
        ap.root.rotation.x = 0.65;
        ap.arm.rotation.z = -2.4;
      } else {
        ap.root.rotation.y = pd.facing + Math.sin(pd.phase * 0.5) * 0.08;
        ap.root.rotation.x = 0;
        ap.arm.rotation.z = Math.sin(pd.phase) * 0.12;
      }
    }
    for (const [id, ap] of this.peds) {
      if (!seenPed.has(id)) {
        this.group.remove(ap.root);
        this.peds.delete(id);
      }
    }

    const fare = f.fare;
    this.beam.visible = this.ring.visible = this.destArrow.visible = !!fare;
    if (fare) {
      const pl = f.places[fare.dest];
      const dist = Math.hypot(pl.x - px, pl.z - pz);
      const hot = dist < 45;
      this.beam.position.set(pl.x, 0, -pl.z);
      this.ring.position.set(pl.x, KERB_H + 0.05, -pl.z);
      const pulse = 1 + Math.sin(time * (hot ? 8 : 4)) * 0.07;
      this.ring.scale.set(pulse, 1, pulse);
      const beamMat = this.beam.material as THREE.MeshBasicMaterial;
      const ringMat = this.ring.material as THREE.MeshBasicMaterial;
      const arrowMat = this.destArrow.material as THREE.MeshBasicMaterial;
      beamMat.color.set(hot ? '#ffc61a' : '#16c95f');
      beamMat.opacity = (hot ? 0.5 : 0.38) + Math.sin(time * 3) * 0.08;
      ringMat.color.set(hot ? '#ffc61a' : '#3ddc84');
      arrowMat.color.set(hot ? '#ff2d6f' : '#c6f432');
      this.destArrow.position.set(pl.x, 7.5 + Math.sin(time * 5.2) * 1.1, -pl.z);
      this.destArrow.rotation.y = time * 2.2;
    }
  }

  dispose(): void {
    for (const g of this.geos.values()) g.dispose();
    this.geos.clear();
    this.personMat.dispose();
    this.armGeo.dispose();
    for (const m of this.armMats) m.dispose();
    this.markerGeo.dispose();
    for (const m of this.markerMats) m.dispose();
    this.beam.geometry.dispose();
    (this.beam.material as THREE.Material).dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.destArrow.geometry.dispose();
    (this.destArrow.material as THREE.Material).dispose();
    this.people.clear();
    this.peds.clear();
  }
}
