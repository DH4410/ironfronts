import type { QueueItem } from './ui-state';

/** A visual queue slot. Consecutive identical orders collapse into one batch. */
export interface QueueGroup extends QueueItem {
  /** Stable within the visible queue while earlier orders complete. */
  readonly key: string;
  /** Number of consecutive orders represented by this slot. */
  readonly count: number;
}

/**
 * 0 A.D. presents repeated training orders as a batch count on one portrait.
 * Ironfronts still executes each order serially; this grouping changes only
 * the presentation and leaves the authoritative queue untouched.
 */
export function groupQueueItems(items: readonly QueueItem[]): QueueGroup[] {
  const groups: Array<Omit<QueueGroup, 'count'> & { count: number }> = [];
  const occurrences = new Map<string, number>();

  for (const item of items) {
    const previous = groups.at(-1);
    if (previous?.id === item.id) {
      previous.count += 1;
      continue;
    }

    const occurrence = occurrences.get(item.id) ?? 0;
    occurrences.set(item.id, occurrence + 1);
    groups.push({ ...item, key: `${item.id}:${occurrence}`, count: 1 });
  }

  return groups;
}
