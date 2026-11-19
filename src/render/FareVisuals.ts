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

const MAX_BODIES = 96;
const MAX_MARKERS = 24;
const WHITE = new THREE.Color('#ffffff');

function personGeometry(variant: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: string) => {
    paint(g, color);
    const nonIdx = g.index ? g.toNonIndexed() : g;
    if (!nonIdx.getAttribute('normal')) nonIdx.computeVertexNormals();
    for (const k of Object.keys(nonIdx.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'color') nonIdx.deleteAttribute(k);
    }
    parts.push(nonIdx);
  };
  const kameez = KAMEEZ[variant % KAMEEZ.length];
  const woman = variant % 3 === 1;
  // Shalwar legs, long kameez, head, hair / cap, right arm (left arm is instanced so it waves).
  add(new THREE.CylinderGeometry(0.11, 0.13, 0.8, 6).translate(-0.1, 0.4, 0), '#e9e4d8');
  add(new THREE.CylinderGeometry(0.11, 0.13, 0.8, 6).translate(0.1, 0.4, 0), '#e9e4d8');
  add(new THREE.CylinderGeometry(0.21, 0.3, 0.85, 8).translate(0, 1.15, 0), kameez);
  add(new THREE.SphereGeometry(0.13, 10, 8).translate(0, 1.72, 0), '#a8775a');
  if (woman) add(new THREE.CylinderGeometry(0.17, 0.25, 0.55, 8, 1, true).translate(0, 1.6, 0), DUPATTA[variant % DUPATTA.length]);
  else add(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 10).translate(0, 1.84, 0), variant % 2 ? '#f5f5f5' : '#2b2b2b');
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.62, 5).translate(0.27, 1.22, 0), kameez);
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g ?? new THREE.BoxGeometry(0.4, 1.8, 0.3).toNonIndexed();
}

/**
 * Passengers waiting at the kerb (waving when you're close), bobbing markers
 * coloured by ride length, a tall beam + bouncing arrow over the destination,
 * and ambient kerbside pedestrians — batched into 2–3 draw calls with zero per-frame allocations.
 */
export class FareVisuals {
  readonly group = new THREE.Group();

  private readonly bodyBatch: THREE.BatchedMesh;
  private readonly armMesh: THREE.InstancedMesh;
  private readonly markerMesh: THREE.InstancedMesh;

  private readonly personMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly armGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.62, 5).translate(0, -0.29, 0);
  private readonly armMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  private readonly markerGeo = new THREE.ConeGeometry(0.42, 0.8, 4).rotateX(Math.PI);
  private readonly markerMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });

  private readonly kamezColors = KAMEEZ.map((c) => new THREE.Color(c));
  private readonly tierColors = TIER.map((c) => new THREE.Color(c));
  private readonly bodyIids: number[] = [];

  private readonly beam: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly destArrow: THREE.Mesh;

  // Reusable zero-allocation scratch transforms
  private readonly dummy = new THREE.Object3D();
  private readonly localArm = new THREE.Object3D();
  private readonly localFriend = new THREE.Object3D();
  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpFriendMat = new THREE.Matrix4();
  private readonly zeroMat = new THREE.Matrix4().compose(
    new THREE.Vector3(0, -500, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(0, 0, 0),
  );

  constructor() {
    this.dummy.rotation.order = 'YXZ';
    this.localArm.rotation.order = 'YXZ';
    this.localFriend.rotation.order = 'YXZ';

    const geos: THREE.BufferGeometry[] = [];
    let totalVerts = 0;
    for (let v = 0; v < KAMEEZ.length; v++) {
      const g = personGeometry(v);
      geos.push(g);
      totalVerts += g.getAttribute('position').count;
    }

    this.bodyBatch = new THREE.BatchedMesh(MAX_BODIES, totalVerts, 0, this.personMat);
    this.bodyBatch.sortObjects = false;
    this.bodyBatch.frustumCulled = false;
    this.bodyBatch.perObjectFrustumCulled = true;
    this.bodyBatch.castShadow = false;
    for (let v = 0; v < geos.length; v++) {
      this.bodyBatch.addGeometry(geos[v]);
      geos[v].dispose();
    }
    for (let i = 0; i < MAX_BODIES; i++) {
      const iid = this.bodyBatch.addInstance(0);
      this.bodyBatch.setVisibleAt(iid, false);
      this.bodyBatch.setColorAt(iid, WHITE);
      this.bodyIids.push(iid);
    }

    this.armMesh = new THREE.InstancedMesh(this.armGeo, this.armMat, MAX_BODIES);
    this.armMesh.frustumCulled = false;
    this.armMesh.castShadow = false;
    this.armMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_BODIES; i++) {
      this.armMesh.setMatrixAt(i, this.zeroMat);
      this.armMesh.setColorAt(i, WHITE);
    }
    this.armMesh.instanceMatrix.needsUpdate = true;
    if (this.armMesh.instanceColor) this.armMesh.instanceColor.needsUpdate = true;

    this.markerMesh = new THREE.InstancedMesh(this.markerGeo, this.markerMat, MAX_MARKERS);
    this.markerMesh.frustumCulled = false;
    this.markerMesh.castShadow = false;
    this.markerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_MARKERS; i++) {
      this.markerMesh.setMatrixAt(i, this.zeroMat);
      this.markerMesh.setColorAt(i, this.tierColors[0]);
    }
    this.markerMesh.instanceMatrix.needsUpdate = true;
    if (this.markerMesh.instanceColor) this.markerMesh.instanceColor.needsUpdate = true;

    const beamMat = new THREE.MeshBasicMaterial({
      color: '#16c95f',
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 60, 24, 1, true).translate(0, 30, 0), beamMat);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#3ddc84', transparent: true, opacity: 0.7, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(9, 10, 40).rotateX(-Math.PI / 2), ringMat);
    const arrowGeo =
      mergeGeometries([
        new THREE.ConeGeometry(1.7, 2.4, 4).rotateX(Math.PI).translate(0, 0, 0),
        new THREE.BoxGeometry(0.85, 2.2, 0.85).translate(0, 2.1, 0),
      ]) ?? new THREE.ConeGeometry(1.7, 2.4, 4).rotateX(Math.PI);
    const arrowMat = new THREE.MeshBasicMaterial({ color: '#c6f432', fog: false });
    this.destArrow = new THREE.Mesh(arrowGeo, arrowMat);
    this.beam.visible = this.ring.visible = this.destArrow.visible = false;
    this.beam.renderOrder = this.ring.renderOrder = this.destArrow.renderOrder = 2;

    this.group.add(this.bodyBatch, this.armMesh, this.markerMesh, this.beam, this.ring, this.destArrow);
  }

  update(f: Fares, px: number, pz: number, time: number, peds: readonly Pedestrian[] = []): void {
    let bodyIdx = 0;
    let armIdx = 0;
    let markerIdx = 0;
    const showMarkers = f.onShift && !f.fare;

    for (let i = 0; i < f.waiting.length; i++) {
      if (bodyIdx >= MAX_BODIES) break;
      const w = f.waiting[i];
      const dx = px - w.x;
      const dz = pz - w.z;
      const d = Math.hypot(dx, dz);
      const ry = Math.atan2(dx, -dz) + Math.PI;
      const near = d < 35 && showMarkers;
      const hopY = KERB_H + (near ? Math.abs(Math.sin(time * 5)) * 0.06 : 0);
      const s = 1 - Math.min(1, w.board / 0.7) * 0.25;

      this.dummy.position.set(w.x, hopY, -w.z);
      this.dummy.rotation.set(0, ry, 0);
      this.dummy.scale.set(s, s, s);
      this.dummy.updateMatrix();

      const varIdx = w.variant % KAMEEZ.length;
      const bIid = this.bodyIids[bodyIdx++];
      this.bodyBatch.setGeometryIdAt(bIid, varIdx);
      this.bodyBatch.setMatrixAt(bIid, this.dummy.matrix);
      this.bodyBatch.setVisibleAt(bIid, true);

      // Left waving arm
      this.localArm.position.set(-0.27, 1.52, 0);
      this.localArm.rotation.set(0, 0, near ? -2.6 + Math.sin(time * 9) * 0.45 : 0);
      this.localArm.scale.set(1, 1, 1);
      this.localArm.updateMatrix();
      this.tmpMat.multiplyMatrices(this.dummy.matrix, this.localArm.matrix);
      this.armMesh.setMatrixAt(armIdx, this.tmpMat);
      this.armMesh.setColorAt(armIdx, this.kamezColors[varIdx]);
      armIdx++;

      // Party companion standing beside main fare
      if (w.kind === 'party' && bodyIdx < MAX_BODIES) {
        this.localFriend.position.set(0.58, 0, -0.14);
        this.localFriend.rotation.set(0, 0, 0);
        this.localFriend.scale.set(1, 1, 1);
        this.localFriend.updateMatrix();
        this.tmpFriendMat.multiplyMatrices(this.dummy.matrix, this.localFriend.matrix);
        const fIid = this.bodyIids[bodyIdx++];
        this.bodyBatch.setGeometryIdAt(fIid, (w.variant + 3) % KAMEEZ.length);
        this.bodyBatch.setMatrixAt(fIid, this.tmpFriendMat);
        this.bodyBatch.setVisibleAt(fIid, true);
      }

      if (showMarkers && markerIdx < MAX_MARKERS) {
        this.dummy.position.set(w.x, hopY + 2.6 * s + Math.sin(time * 3 + w.id) * 0.18, -w.z);
        this.dummy.rotation.set(0, time * 2, 0);
        this.dummy.scale.set(s, s, s);
        this.dummy.updateMatrix();
        this.markerMesh.setMatrixAt(markerIdx, this.dummy.matrix);
        this.markerMesh.setColorAt(markerIdx, this.tierColors[w.tier] ?? this.tierColors[0]);
        markerIdx++;
      }
    }

    // Ambient sidewalk pedestrians
    for (let i = 0; i < peds.length; i++) {
      if (bodyIdx >= MAX_BODIES || armIdx >= MAX_BODIES) break;
      const pd = peds[i];
      this.dummy.position.set(pd.x, KERB_H + pd.y, -pd.z);
      if (pd.state === 'dive') {
        this.dummy.rotation.set(0.65, pd.facing, 0);
      } else {
        this.dummy.rotation.set(0, pd.facing + Math.sin(pd.phase * 0.5) * 0.08, 0);
      }
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();

      const varIdx = pd.variant % KAMEEZ.length;
      const bIid = this.bodyIids[bodyIdx++];
      this.bodyBatch.setGeometryIdAt(bIid, varIdx);
      this.bodyBatch.setMatrixAt(bIid, this.dummy.matrix);
      this.bodyBatch.setVisibleAt(bIid, true);

      this.localArm.position.set(-0.27, 1.52, 0);
      this.localArm.rotation.set(0, 0, pd.state === 'dive' ? -2.4 : Math.sin(pd.phase) * 0.12);
      this.localArm.scale.set(1, 1, 1);
      this.localArm.updateMatrix();
      this.tmpMat.multiplyMatrices(this.dummy.matrix, this.localArm.matrix);
      this.armMesh.setMatrixAt(armIdx, this.tmpMat);
      this.armMesh.setColorAt(armIdx, this.kamezColors[varIdx]);
      armIdx++;
    }

    for (let i = bodyIdx; i < MAX_BODIES; i++) {
      this.bodyBatch.setVisibleAt(this.bodyIids[i], false);
    }
    for (let i = armIdx; i < MAX_BODIES; i++) {
      this.armMesh.setMatrixAt(i, this.zeroMat);
    }
    this.armMesh.instanceMatrix.needsUpdate = true;
    if (this.armMesh.instanceColor) this.armMesh.instanceColor.needsUpdate = true;

    this.markerMesh.visible = markerIdx > 0;
    if (markerIdx > 0) {
      for (let i = markerIdx; i < MAX_MARKERS; i++) {
        this.markerMesh.setMatrixAt(i, this.zeroMat);
      }
      this.markerMesh.instanceMatrix.needsUpdate = true;
      if (this.markerMesh.instanceColor) this.markerMesh.instanceColor.needsUpdate = true;
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
    this.bodyBatch.dispose();
    this.armMesh.dispose();
    this.markerMesh.dispose();
    this.personMat.dispose();
    this.armGeo.dispose();
    this.armMat.dispose();
    this.markerGeo.dispose();
    this.markerMat.dispose();
    this.beam.geometry.dispose();
    (this.beam.material as THREE.Material).dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.destArrow.geometry.dispose();
    (this.destArrow.material as THREE.Material).dispose();
  }
}
