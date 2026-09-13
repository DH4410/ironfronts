export interface OrderFailureFeedback {
  readonly title: string;
  readonly body?: string;
}

/** Stable player-facing copy for authoritative order rejection reasons. */
export function describeOrderFailure(reason: string): OrderFailureFeedback {
  const r = reason.toLowerCase();
  if (r.includes('target is not reachable')) return { title: 'Target is not reachable', body: reason };
  if (r.includes('no valid hostile force') || r.includes('target is no longer detected')) {
    return { title: 'No valid hostile force', body: 'The hostile force is missing or no longer detected.' };
  }
  if (r.includes('attack route unavailable')) return { title: 'Attack route unavailable', body: reason };
  if (r.includes('not your army')) return { title: 'Not your army', body: 'You can only order armies you command.' };
  if (r.includes('not your province')) return { title: 'Not your province', body: reason };
  if (r.includes('own force') || r.includes('own territory') || r.includes('already hold that province')) {
    return { title: 'Invalid target', body: 'You cannot attack your own forces or territory.' };
  }
  if (r.includes('close combat') || r.includes('is engaged')) {
    return { title: 'Army is fighting', body: 'It cannot take new orders until the battle ends.' };
  }
  if (r.includes('retreating')) {
    return { title: 'Army is retreating', body: 'Wait for it to disengage before giving new orders.' };
  }
  if (r.includes('war declaration')) {
    return { title: 'War not declared', body: 'That route crosses a country you are not at war with.' };
  }
  if (r.includes('separate landmass')) return { title: 'Unreachable', body: reason };
  if (r.includes('off the road network') || r.includes('not on land')) return { title: 'No path there', body: reason };
  if (r.includes('no legal route') || r.includes('no land route')) return { title: 'No route', body: reason };
  if (r.includes('already there')) return { title: 'Already there', body: 'The army is already at that location.' };
  if (r.includes('retreat direction')) return { title: 'Bad retreat', body: reason };
  if (r.includes('not in close combat')) {
    return { title: 'Not in combat', body: 'Only an engaged army can be ordered to retreat.' };
  }
  return { title: 'Order rejected', body: reason };
}
