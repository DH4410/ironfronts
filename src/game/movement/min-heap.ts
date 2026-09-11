/** Deterministic minimum priority queue for graph searches. */
export class MinHeap {
  private entries: Array<[number, number]> = [];
  get size(): number { return this.entries.length; }
  push(cost: number, node: number): void {
    const entries = this.entries; entries.push([cost, node]);
    let i = entries.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (entries[parent][0] <= cost) break;
      [entries[parent], entries[i]] = [entries[i], entries[parent]]; i = parent;
    }
  }
  pop(): [number, number] {
    const entries = this.entries, first = entries[0], last = entries.pop()!;
    if (entries.length) {
      entries[0] = last; let i = 0;
      for (;;) {
        let child = i; const left = i * 2 + 1, right = left + 1;
        if (left < entries.length && entries[left][0] < entries[child][0]) child = left;
        if (right < entries.length && entries[right][0] < entries[child][0]) child = right;
        if (child === i) break;
        [entries[i], entries[child]] = [entries[child], entries[i]]; i = child;
      }
    }
    return first;
  }
}
