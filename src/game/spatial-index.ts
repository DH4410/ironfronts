/** Position buckets scoped to a simulation phase. X wraps; Z does not. */
export class SpatialIndex<T extends { x: number; z: number }> {
  private readonly buckets = new Map<string, T[]>();
  private readonly columns: number;
  private readonly keys = new Map<T,string>();
  constructor(values: Iterable<T>, private readonly width: number, private readonly cellSize = 128) {
    this.columns = Math.max(1, Math.ceil(width / cellSize));
    for (const value of values) {
      const key = `${Math.floor(this.wrap(value.x) / cellSize)}:${Math.floor(value.z / cellSize)}`;
      const bucket = this.buckets.get(key) ?? []; bucket.push(value); this.buckets.set(key, bucket); this.keys.set(value,key);
    }
  }
  update(value: T): void {
    const key = `${Math.floor(this.wrap(value.x) / this.cellSize)}:${Math.floor(value.z / this.cellSize)}`;
    const old = this.keys.get(value);
    if (old === key) return;
    if (old) {
      const bucket = this.buckets.get(old)!;
      const index = bucket.indexOf(value); if (index >= 0) bucket.splice(index,1);
      if (!bucket.length) this.buckets.delete(old);
    }
    const bucket = this.buckets.get(key) ?? []; bucket.push(value);
    this.buckets.set(key,bucket); this.keys.set(value,key);
  }
  private wrap(x: number): number { return ((x % this.width) + this.width) % this.width; }
  query(x: number, z: number, radius: number): T[] {
    const centerX = Math.floor(this.wrap(x) / this.cellSize), centerZ = Math.floor(z / this.cellSize);
    const cells = Math.ceil(radius / this.cellSize) + 1;
    const found = new Set<T>();
    for (let dx = -cells; dx <= cells; dx++) for (let dz = -cells; dz <= cells; dz++) {
      const column = ((centerX + dx) % this.columns + this.columns) % this.columns;
      for (const value of this.buckets.get(`${column}:${centerZ + dz}`) ?? []) {
        let offsetX = value.x - x;
        if (offsetX > this.width / 2) offsetX -= this.width;
        else if (offsetX < -this.width / 2) offsetX += this.width;
        const offsetZ = value.z - z;
        if (offsetX * offsetX + offsetZ * offsetZ <= radius * radius) found.add(value);
      }
    }
    return [...found];
  }
}
