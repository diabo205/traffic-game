import * as THREE from 'three';

/** Sample spacing (m) along the route for road geometry. */
export const STEP = 4;

export type XFn = (z: number) => number;

/** Builds a strip of quads along z. */
export class StripBuilder {
  private pos: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  /** Flat horizontal ribbon between two x functions. */
  flat(xa: XFn, xb: XFn, y: XFn, z0: number, z1: number, color: (z: number) => THREE.Color, uScale = 0.25, vScale = 0.125, step = STEP, swapUV = false): void {
    let first = true;
    for (let z = z0; z <= z1 + 1e-6; z += step) {
      const a = xa(z), b = xb(z), h = y(z);
      const c = color(z);
      const base = this.pos.length / 3;
      this.pos.push(a, h, -z, b, h, -z);
      if (swapUV) this.uv.push(z * vScale, a * uScale, z * vScale, b * uScale);
      else this.uv.push(a * uScale, z * vScale, b * uScale, z * vScale);
      this.col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (!first) this.idx.push(base - 2, base - 1, base, base - 1, base + 1, base);
      first = false;
    }
  }

  /** Vertical wall following x(z) between y0(z) and y1(z). `facing` = +1 faces +x. */
  wall(x: XFn, y0: XFn, y1: XFn, z0: number, z1: number, color: THREE.Color, facing: 1 | -1, step = STEP, uScale = 0.1): void {
    let first = true;
    for (let z = z0; z <= z1 + 1e-6; z += step) {
      const xx = x(z);
      const base = this.pos.length / 3;
      this.pos.push(xx, y0(z), -z, xx, y1(z), -z);
      this.uv.push(z * uScale, 0, z * uScale, 1);
      this.col.push(color.r, color.g, color.b, color.r, color.g, color.b);
      if (!first) {
        if (facing > 0) this.idx.push(base - 2, base, base - 1, base - 1, base, base + 1);
        else this.idx.push(base - 2, base - 1, base, base - 1, base + 1, base);
      }
      first = false;
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/** Bake a flat vertex colour into a geometry (for merged, vertex-coloured meshes). */
export function paint(g: THREE.BufferGeometry, color: string): void {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}
