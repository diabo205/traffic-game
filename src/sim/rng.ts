/**
 * mulberry32 — tiny, fast, seedable 32-bit PRNG.
 * The ONLY source of randomness allowed in src/sim/.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }

  /** float in [0, 1) */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Pick a key from a weight table. Iterates in insertion order (deterministic). */
  weighted<K extends string>(weights: Readonly<Partial<Record<K, number>>>): K {
    let total = 0;
    for (const k in weights) total += weights[k] ?? 0;
    let r = this.next() * total;
    let last: K | null = null;
    for (const k in weights) {
      const w = weights[k] ?? 0;
      if (w <= 0) continue;
      last = k;
      r -= w;
      if (r < 0) return k;
    }
    if (last === null) throw new Error('Rng.weighted: empty table');
    return last;
  }
}
