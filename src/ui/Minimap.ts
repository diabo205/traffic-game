import type { CityMap } from '../sim/city/cityMap';
import type { Fares } from '../sim/city/Fares';

const TIER = ['#3ddc84', '#ffc23d', '#ff4d4d', '#ff2d6f'];
/** Pixels per metre in the pre-drawn street layer. */
const RES = 0.6;

/** Heading-up minimap: streets, route line, passengers and destination. */
export class Minimap {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private layer: HTMLCanvasElement;
  private size = 150;
  private zoom = 0.7;

  constructor(private readonly map: CityMap) {
    this.el = document.createElement('canvas');
    this.el.className = 'minimap';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.el.width = this.el.height = Math.round(this.size * dpr);
    this.ctx = this.el.getContext('2d');
    this.ctx?.scale(dpr, dpr);

    // Streets drawn once: x right = east, y down = south.
    const b = map.bounds;
    this.layer = document.createElement('canvas');
    this.layer.width = Math.ceil((b.x1 - b.x0) * RES);
    this.layer.height = Math.ceil((b.z1 - b.z0) * RES);
    const g = this.layer.getContext('2d');
    if (g) {
      g.fillStyle = '#5b5143';
      g.fillRect(0, 0, this.layer.width, this.layer.height);

      // Jehangir Park
      g.fillStyle = '#738f4e';
      for (const slab of map.slabs) {
        if (slab.kind !== 1 || slab.pts.length < 6) continue;
        g.beginPath();
        g.moveTo((slab.pts[0] - b.x0) * RES, (b.z1 - slab.pts[1]) * RES);
        for (let i = 2; i < slab.pts.length; i += 2) {
          g.lineTo((slab.pts[i] - b.x0) * RES, (b.z1 - slab.pts[i + 1]) * RES);
        }
        g.closePath();
        g.fill();
      }

      // Roads stroked with round caps so intersections fuse cleanly.
      g.strokeStyle = '#d9d4c8';
      g.lineCap = 'round';
      for (const s of map.roadSegs) {
        g.lineWidth = s.hw * 2 * RES;
        g.beginPath();
        g.moveTo((s.ax - b.x0) * RES, (b.z1 - s.az) * RES);
        g.lineTo((s.bx - b.x0) * RES, (b.z1 - s.bz) * RES);
        g.stroke();
      }

      g.fillStyle = '#d9d4c8';
      for (const loop of map.roundaboutLoops) {
        const pts = loop.pts;
        if (pts.length < 6) continue;
        g.beginPath();
        g.moveTo((pts[0] - b.x0) * RES, (b.z1 - pts[1]) * RES);
        for (let i = 2; i < pts.length; i += 2) g.lineTo((pts[i] - b.x0) * RES, (b.z1 - pts[i + 1]) * RES);
        g.closePath();
        g.fill();
      }

      g.fillStyle = '#7f9a55';
      for (const s of map.islands) {
        g.beginPath();
        g.arc((s.x - b.x0) * RES, (b.z1 - s.z) * RES, s.r * RES, 0, Math.PI * 2);
        g.fill();
      }

      g.fillStyle = '#c9a25a';
      for (const l of map.landmarks) {
        const o = l.obb;
        g.save();
        g.translate((o.x - b.x0) * RES, (b.z1 - o.z) * RES);
        g.rotate(o.heading);
        g.fillRect(-o.hw * RES, -o.hl * RES, o.hw * 2 * RES, o.hl * 2 * RES);
        g.restore();
      }
    }
  }

  draw(px: number, pz: number, heading: number, fares: Fares): void {
    const c = this.ctx;
    if (!c) return;
    const S = this.size, k = this.zoom;
    const b = this.map.bounds;
    c.save();
    c.clearRect(0, 0, S, S);
    c.beginPath();
    c.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#3f382f';
    c.fillRect(0, 0, S, S);
    // World -> canvas, heading up, player in the middle (slightly low).
    c.translate(S / 2, S * 0.58);
    c.rotate(-heading);
    c.scale(k, k);
    c.translate(-px, pz);
    c.drawImage(this.layer, b.x0, -b.z1, this.layer.width / RES, this.layer.height / RES);

    const path = fares.navPath;
    if (path.length >= 4) {
      c.strokeStyle = '#2f9bff';
      c.lineWidth = 5 / k;
      c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(px, -pz);
      for (let i = 2; i < path.length; i += 2) c.lineTo(path[i], -path[i + 1]);
      c.stroke();
    }
    if (fares.onShift && !fares.fare) {
      for (const w of fares.waiting) {
        c.fillStyle = TIER[w.tier];
        c.beginPath();
        c.arc(w.x, -w.z, 6 / k, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#111';
        c.lineWidth = 1.5 / k;
        c.stroke();
      }
    }
    if (fares.fare) {
      const pl = fares.places[fares.fare.dest];
      c.fillStyle = '#3ddc84';
      c.strokeStyle = '#ffffff';
      c.lineWidth = 2 / k;
      c.beginPath();
      c.arc(pl.x, -pl.z, 9 / k, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    c.restore();

    // Player arrow (always pointing up).
    c.save();
    c.translate(S / 2, S * 0.58);
    c.fillStyle = '#ffc23d';
    c.strokeStyle = '#1b1b1b';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -8);
    c.lineTo(6, 6);
    c.lineTo(0, 3);
    c.lineTo(-6, 6);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
    // Rim and north tick.
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
    c.stroke();
    const nx = S / 2 + Math.sin(-heading) * (S / 2 - 9), ny = S / 2 - Math.cos(-heading) * (S / 2 - 9);
    c.fillStyle = '#ffffff';
    c.font = 'bold 10px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', nx, ny);
  }
}
