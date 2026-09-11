/** Derived map labels, isolated from GPU resource ownership. */
export function generateRoadJunctions(graph: Float32Array | undefined, cities: ReadonlyArray<readonly [number, number]>, sampleHeight: (x:number,z:number)=>number): Array<{ x: number; z: number; town: boolean }> {
    if (!graph || graph.length < 4) return [];
    const CELL = 26;                 // world units — merges shared vertices
    const MIN_SPACING = 150;         // between kept junction markers
    const MIN_CITY_DISTANCE = 170;   // from one of the 250 largest settlements
    const degree = new Map<number, { x: number; z: number; n: number }>();
    const key = (x: number, z: number): number =>
      Math.round(x / CELL) * 100_000 + Math.round(z / CELL);
    for (let i = 0; i + 3 < graph.length; i += 4) {
      for (const [x, z] of [[graph[i], graph[i + 1]], [graph[i + 2], graph[i + 3]]] as const) {
        const k = key(x, z);
        const entry = degree.get(k);
        if (entry) entry.n += 1;
        else degree.set(k, { x, z, n: 1 });
      }
    }
    const kept: Array<{ x: number; z: number; town: boolean }> = [];
    const candidates = [...degree.values()]
      .filter((v) => v.n >= 3)
      .sort((a, b) => b.n - a.n);
    for (const v of candidates) {
      if (kept.length >= 500) break;
      if (sampleHeight(v.x, v.z) <= 0.05) continue; // land only
      if (cities.some((c) => Math.hypot(c[0] - v.x, c[1] - v.z) < MIN_CITY_DISTANCE)) continue;
      if (kept.some((m) => Math.hypot(m.x - v.x, m.z - v.z) < MIN_SPACING)) continue;
      const town = v.n >= 4 && (Math.round(v.x * 7 + v.z * 13) & 7) === 0;
      kept.push({ x: v.x, z: v.z, town });
    }
    return kept;
  }

