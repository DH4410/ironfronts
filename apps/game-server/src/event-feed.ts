/** Drain authoritative domain events once and filter them per participating country. */

import type { FilteredEvent } from '@ironfronts/protocol';
import type { CombatEvent } from '@ironfronts/game-core';
import type { GameRuntime } from './runtime';

interface CountryEvent {
  readonly countryId: number;
  readonly event: FilteredEvent;
}

export interface PendingEventBatch {
  readonly countryEvents: readonly CountryEvent[];
  readonly combatEvents: readonly (CombatEvent & { readonly id: string })[];
  readonly publicEvents: readonly FilteredEvent[];
}

export function collectPendingEvents(runtime: GameRuntime, _revision: number): PendingEventBatch {
  const nextId = (): string => `event-${runtime.session.state.nextEventId++}`;
  const unitEvents = runtime.session.pendingCompletions.splice(0).map((event) => ({
    countryId: event.ownerCountryId,
    event: {
      id: nextId(),
      kind: 'unitCompleted',
      ownerCountryId: event.ownerCountryId,
      unitTypeId: event.unitTypeId,
      provinceId: event.provinceId,
      armyId: event.armyId,
      ...locationOfProvince(runtime, event.provinceId),
    } satisfies FilteredEvent,
  }));
  const buildingEvents = runtime.session.pendingBuildings.splice(0).map((event) => ({
    countryId: event.ownerCountryId,
    event: {
      id: nextId(),
      kind: 'buildingCompleted',
      ownerCountryId: event.ownerCountryId,
      buildingId: event.buildingId,
      provinceId: event.provinceId,
      ...locationOfProvince(runtime, event.provinceId),
    } satisfies FilteredEvent,
  }));
  const combatEvents = runtime.session.pendingCombat.splice(0)
    .map((event): CombatEvent & { readonly id: string } => ({ ...event, id: nextId() }));
  const publicEvents = runtime.session.pendingCaptures.splice(0).map((event) => ({
    id: nextId(), kind: 'capture', ...event, ...locationOfProvince(runtime, event.provinceId),
  } satisfies FilteredEvent));
  return {
    countryEvents: [...unitEvents, ...buildingEvents],
    combatEvents,
    publicEvents,
  };
}

function locationOfProvince(runtime: GameRuntime, provinceId: number): { x: number; z: number } {
  const province = runtime.world.provinces.find((candidate) => candidate.id === provinceId);
  if (!province) throw new Error(`Event refers to unknown province ${provinceId}.`);
  return { x: province.center[0], z: province.center[1] };
}

export function eventsForCountry(
  batch: PendingEventBatch, countryId: number, _revision: number,
): FilteredEvent[] {
  return [
    ...batch.countryEvents
      .filter((entry) => entry.countryId === countryId)
      .map((entry) => entry.event),
    ...batch.combatEvents
      .filter((event) => event.attacker === countryId || event.defender === countryId)
      .map((event) => ({ ...event })),
    ...batch.publicEvents,
  ];
}
