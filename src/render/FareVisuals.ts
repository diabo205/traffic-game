import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { KERB_H } from '../sim/city/cityMap';
import type { Fares } from '../sim/city/Fares';
import { paint } from './strip';

/** Shalwar kameez colours, waistcoats and caps for waiting passengers. */
const KAMEEZ = ['#f2efe6', '#7fa7c9', '#c9b38a', '#4f6d5a', '#d9c7a8', '#8a4f3d', '#2f3b52', '#e7d27a'];
const DUPATTA = ['#c2185b', '#00897b', '#f9a825', '#5e35b1'];
/** Marker colour by ride length: short, medium, long. */
const TIER = ['#3ddc84', '#ffc23d', '#ff4d4d'];

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
  return g ?? new THREE.BoxGeometry(0.4, 1.8, 0.3);
}

interface Person {
  root: THREE.Group;
  arm: THREE.Mesh;
  marker: THREE.Mesh;
  variant: number;
}

/**
 * Passengers waiting at the kerb (waving when you're close), a bobbing marker
 * over each coloured by ride length, and a tall beam over the destination.
 */
export class FareVisuals {
  readonly group = new THREE.Group();
  private people = new Map<number, Person>();
  private geos = new Map<number, THREE.BufferGeometry>();
  private personMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private markerGeo = new THREE.ConeGeometry(0.42, 0.8, 4).rotateX(Math.PI);
  private markerMats = TIER.map((c) => new THREE.MeshBasicMaterial({ color: c }));
  private beam: THREE.Mesh;
  private ring: THREE.Mesh;

  constructor() {
    const beamMat = new THREE.MeshBasicMaterial({ color: '#16c95f', transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 60, 24, 1, true).translate(0, 30, 0), beamMat);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#3ddc84', transparent: true, opacity: 0.7, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(9, 10, 40).rotateX(-Math.PI / 2), ringMat);
    this.beam.visible = this.ring.visible = false;
    this.beam.renderOrder = this.ring.renderOrder = 2;
    this.group.add(this.beam, this.ring);
  }

  private geometry(variant: number): THREE.BufferGeometry {
    let g = this.geos.get(variant);
    if (!g) this.geos.set(variant, (g = personGeometry(variant)));
    return g;
  }

  private make(variant: number, tier: number): Person {
    const root = new THREE.Group();
    const body = new THREE.Mesh(this.geometry(variant), this.personMat);
    body.castShadow = true;
    const kameez = new THREE.Color(KAMEEZ[variant % KAMEEZ.length]);
    const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.62, 5).translate(0, -0.29, 0);
    const arm = new THREE.Mesh(armGeo, new THREE.MeshLambertMaterial({ color: kameez }));
    arm.position.set(-0.27, 1.52, 0);
    const marker = new THREE.Mesh(this.markerGeo, this.markerMats[tier]);
    marker.position.y = 2.6;
    root.add(body, arm, marker);
    this.group.add(root);
    return { root, arm, marker, variant };
  }

  update(f: Fares, px: number, pz: number, time: number): void {
    const seen = new Set<number>();
    for (const w of f.waiting) {
      seen.add(w.id);
      let person = this.people.get(w.id);
      if (!person) {
        person = this.make(w.variant, w.tier);
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

    const fare = f.fare;
    this.beam.visible = this.ring.visible = !!fare;
    if (fare) {
      const pl = f.places[fare.dest];
      this.beam.position.set(pl.x, 0, -pl.z);
      this.ring.position.set(pl.x, KERB_H + 0.05, -pl.z);
      const pulse = 1 + Math.sin(time * 4) * 0.05;
      this.ring.scale.set(pulse, 1, pulse);
      (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.38 + Math.sin(time * 3) * 0.08;
    }
  }
}
