import { DT } from '../sim/types';
import type { NpcKind, NpcView } from '../sim/types';
import { NPC_ACOUSTIC_PROFILE, selectSpatialTrafficSlots } from './engineDspMath';

interface SpatialSlotNode {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  panner: StereoPannerNode | null;
}

/**
 * Pooled multi-voice spatial Doppler traffic bed + passing rush / NPC horn dispatcher.
 * Pre-allocates 2 (lowSpec) or 3 (high) persistent Web Audio voices with zero per-frame allocations.
 */
export class SpatialTrafficAudio {
  private readonly slotCount: number;
  private readonly slots: SpatialSlotNode[] = [];
  private readonly slotIds: number[];
  private readonly slotActiveFlags: Uint8Array;
  private whooshCooldown = 0;
  private npcHornCooldown = 0;

  activeCount = 0;

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
    lowSpec: boolean,
    private readonly onPassingRush: (pan: number, intensity: number) => void,
    private readonly onNpcHorn: (pan: number, kind: NpcKind, dopplerRatio: number) => void,
  ) {
    this.slotCount = lowSpec ? 2 : 3;
    this.slotIds = new Array<number>(this.slotCount).fill(-1);
    this.slotActiveFlags = new Uint8Array(this.slotCount);

    for (let i = 0; i < this.slotCount; i++) {
      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 54;

      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = 108;

      const subG = ctx.createGain();
      subG.gain.value = 0.45;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      filter.Q.value = 1.2;

      const gain = ctx.createGain();
      gain.gain.value = 0;

      osc1.connect(filter);
      osc2.connect(subG).connect(filter);
      filter.connect(gain);

      let panner: StereoPannerNode | null = null;
      if (typeof ctx.createStereoPanner === 'function') {
        panner = ctx.createStereoPanner();
        panner.pan.value = 0;
        gain.connect(panner).connect(dest);
      } else {
        gain.connect(dest);
      }

      osc1.start();
      osc2.start();
      this.slots.push({ osc1, osc2, filter, gain, panner });
    }
  }

  reset(): void {
    const t = this.ctx.currentTime;
    for (let i = 0; i < this.slotCount; i++) {
      this.slotIds[i] = -1;
      this.slotActiveFlags[i] = 0;
      this.slots[i].gain.gain.setTargetAtTime(0, t, 0.04);
    }
    this.activeCount = 0;
    this.whooshCooldown = 0;
    this.npcHornCooldown = 0;
  }

  update(
    npcs: readonly NpcView[],
    px: number,
    pz: number,
    pHeading: number,
    pvx: number,
    pvz: number,
    dt: number,
    active: boolean,
    playerHorn: boolean,
    playerSpeed: number,
  ): void {
    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(0.1, dt) : 0;
    this.whooshCooldown = Math.max(0, this.whooshCooldown - safeDt);
    this.npcHornCooldown = Math.max(0, this.npcHornCooldown - safeDt);

    const t = this.ctx.currentTime;
    if (!active) {
      if (this.activeCount > 0) {
        for (let i = 0; i < this.slotCount; i++) {
          this.slotIds[i] = -1;
          this.slots[i].gain.gain.setTargetAtTime(0, t, 0.05);
        }
        this.activeCount = 0;
      }
      return;
    }

    const assigned = selectSpatialTrafficSlots(
      npcs,
      px,
      pz,
      pHeading,
      pvx,
      pvz,
      DT,
      this.slotCount,
      this.slotIds,
    );

    this.slotActiveFlags.fill(0);
    let bestWhoosh = 0;
    let bestWhooshPan = 0;

    for (let i = 0; i < assigned.length; i++) {
      const a = assigned[i];
      const slot = this.slots[a.slot];
      const prof = NPC_ACOUSTIC_PROFILE[a.kind];
      const pitch = Math.max(25, Math.min(2200, prof.baseHz * a.doppler.dopplerRatio));
      const fFreq = Math.max(120, Math.min(3500, prof.formantHz * (0.7 + 0.3 * a.doppler.dopplerRatio)));

      slot.osc1.frequency.setTargetAtTime(pitch, t, 0.045);
      slot.osc2.frequency.setTargetAtTime(pitch * 2.02, t, 0.045);
      slot.filter.frequency.setTargetAtTime(fFreq, t, 0.05);
      slot.filter.Q.setTargetAtTime(prof.formantQ, t, 0.05);
      slot.gain.gain.setTargetAtTime(a.doppler.gain, t, 0.06);
      if (slot.panner) slot.panner.pan.setTargetAtTime(a.doppler.pan, t, 0.04);

      this.slotIds[a.slot] = a.id;
      this.slotActiveFlags[a.slot] = 1;

      if (a.doppler.whoosh > bestWhoosh) {
        bestWhoosh = a.doppler.whoosh;
        bestWhooshPan = a.doppler.pan;
      }
    }

    for (let i = 0; i < this.slotCount; i++) {
      if (this.slotActiveFlags[i] === 0 && this.slotIds[i] !== -1) {
        this.slotIds[i] = -1;
        this.slots[i].gain.gain.setTargetAtTime(0, t, 0.06);
      }
    }
    this.activeCount = assigned.length;

    if (this.whooshCooldown <= 0 && bestWhoosh > 0.25 && Math.abs(playerSpeed) > 8) {
      this.onPassingRush(bestWhooshPan, Math.min(1, bestWhoosh * 1.15));
      this.whooshCooldown = 0.38;
    }

    if (this.npcHornCooldown <= 0 && (playerHorn || Math.abs(playerSpeed) > 13)) {
      const sinH = Math.sin(pHeading);
      const cosH = Math.cos(pHeading);
      for (let i = 0; i < npcs.length; i++) {
        const n = npcs[i];
        if (!NPC_ACOUSTIC_PROFILE[n.kind].hasHorn) continue;
        const dx = n.x - px;
        const dz = n.z - pz;
        const localFwd = dx * sinH + dz * cosH;
        const localRight = dx * cosH - dz * sinH;
        if (localFwd < 1 || localFwd > 20 || Math.abs(localRight) > 5.5) continue;
        const opposing = Math.cos(n.heading - pHeading) < -0.35;
        if (playerHorn || (opposing && localFwd < 14)) {
          const pan = Math.max(-0.85, Math.min(0.85, localRight / 5.5));
          const ratio = opposing ? 1.07 : 0.98 + ((n.id % 5) - 2) * 0.025;
          this.onNpcHorn(pan, n.kind, ratio);
          this.npcHornCooldown = 2.4;
          break;
        }
      }
    }
  }

  dispose(): void {
    for (const s of this.slots) {
      try {
        s.osc1.stop();
        s.osc1.disconnect();
        s.osc2.stop();
        s.osc2.disconnect();
        s.gain.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}
