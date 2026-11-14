import { FINISH_Z, ZONES, zoneIndexAt } from './road';
import type { GameOverReason, GamePhase, SimEvent } from './types';

export interface CheckpointDef {
  z: number;
  label: string;
  bonus: number;
}

export const START_TIME = 100;

export const CHECKPOINTS: readonly CheckpointDef[] = [
  { z: 1100, label: 'LYARI EXPRESSWAY ON-RAMP', bonus: 35 },
  { z: 2000, label: 'EXPRESSWAY · MAURIPUR EXIT', bonus: 20 },
  { z: 2900, label: 'SHAHRAH-E-FAISAL', bonus: 34 },
  { z: 3600, label: 'FTC FLYOVER', bonus: 26 },
];

export interface RunStats {
  elapsed: number;
  crashes: number;
  potholes: number;
  manholes: number;
  topSpeed: number;
  damageTaken: number;
}

/** Checkpoint timer, zone progression and win/lose state. */
export class LevelManager {
  phase: GamePhase = 'ready';
  reason: GameOverReason = null;
  timeLeft = START_TIME;
  zoneIndex = 0;
  nextCheckpoint = 0;
  stats: RunStats = LevelManager.emptyStats();

  static emptyStats(): RunStats {
    return { elapsed: 0, crashes: 0, potholes: 0, manholes: 0, topSpeed: 0, damageTaken: 0 };
  }

  reset(): void {
    this.phase = 'ready';
    this.reason = null;
    this.timeLeft = START_TIME;
    this.zoneIndex = 0;
    this.nextCheckpoint = 0;
    this.stats = LevelManager.emptyStats();
  }

  /** Debug: mark checkpoints before z as already passed. */
  skipTo(z: number): void {
    while (this.nextCheckpoint < CHECKPOINTS.length && CHECKPOINTS[this.nextCheckpoint].z <= z) this.nextCheckpoint++;
    this.lastZ = z;
  }

  get progress(): number {
    return Math.min(1, Math.max(0, this.lastZ / FINISH_Z));
  }

  private lastZ = 0;

  update(dt: number, playerZ: number, playerSpeed: number, integrity: number, events: SimEvent[]): void {
    this.lastZ = playerZ;
    if (this.phase !== 'running') return;

    this.stats.elapsed += dt;
    this.stats.topSpeed = Math.max(this.stats.topSpeed, playerSpeed);
    this.timeLeft = Math.max(0, this.timeLeft - dt);

    const zi = zoneIndexAt(playerZ);
    if (zi !== this.zoneIndex) {
      this.zoneIndex = zi;
      events.push({ type: 'zone', zoneIndex: zi, name: ZONES[zi].name, banner: ZONES[zi].banner });
    }

    while (this.nextCheckpoint < CHECKPOINTS.length && playerZ >= CHECKPOINTS[this.nextCheckpoint].z) {
      const cp = CHECKPOINTS[this.nextCheckpoint++];
      this.timeLeft += cp.bonus;
      events.push({ type: 'checkpoint', label: cp.label, bonus: cp.bonus });
    }

    if (playerZ >= FINISH_Z) {
      this.phase = 'complete';
      events.push({ type: 'complete' });
    } else if (integrity <= 0) {
      this.phase = 'gameover';
      this.reason = 'wrecked';
      events.push({ type: 'gameover', reason: 'wrecked' });
    } else if (this.timeLeft <= 0) {
      this.phase = 'gameover';
      this.reason = 'time';
      events.push({ type: 'gameover', reason: 'time' });
    }
  }
}
