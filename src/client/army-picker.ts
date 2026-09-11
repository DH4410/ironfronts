import { presentedArmyPosition, type ArmyPickEntry } from '../army-motion';

/** CPU picking owns the same bounded trajectory uploaded to the marker shader. */
export class ArmyPicker {
  private entries: ReadonlyArray<ArmyPickEntry> = [];
  private sampledAtSeconds = 0;

  update(entries: ReadonlyArray<ArmyPickEntry>, sampledAtSeconds: number): void {
    this.entries = entries.map((entry) => ({ ...entry }));
    this.sampledAtSeconds = sampledAtSeconds;
  }

  pick(x: number, z: number, radius: number, worldWidth: number, nowSeconds: number): string | null {
    let best: string | null = null;
    let bestSq = radius * radius;
    const elapsedMs = Math.max(0, nowSeconds - this.sampledAtSeconds) * 1_000;
    for (const entry of this.entries) {
      const point = presentedArmyPosition(entry, elapsedMs);
      let dx = point.x - x;
      if (dx > worldWidth / 2) dx -= worldWidth;
      else if (dx < -worldWidth / 2) dx += worldWidth;
      const dz = point.z - z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestSq) { bestSq = distanceSq; best = entry.id; }
    }
    return best;
  }

  clear(): void { this.entries = []; }
}
