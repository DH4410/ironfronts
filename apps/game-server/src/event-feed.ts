/** Drain authoritative domain events once and filter them per participating country. */

import type { FilteredEvent } from '@ironfronts/protocol';
import type { GameRuntime } from './runtime';

interface CountryEvent {
  readonly countryId: number;
  readonly event: FilteredEvent;
}

export interface PendingEventBatch {
  readonly countryEvents: readonly CountryEvent[];
  readonly combatEvents: readonly {
    readonly attacker: number;
    readonly defender: number;
    readonly kind: string;
    readonly battleId?: string;
    readonly frontId?: string;
    readonly armyId?: string;
    readonly targetArmyId?: string;
  }[];
  readonly publicEvents: readonly FilteredEvent[];
}

export function collectPendingEvents(runtime: GameRuntime, revision: number): PendingEventBatch {
  const unitEvents = runtime.session.pendingCompletions.splice(0).map((event) => ({
    countryId: runtime.session.state.armies[event.armyId]?.ownerCountryId
      ?? runtime.session.state.provinceOwners[event.provinceId],
    event: {
      id: `unit-${revision}-${event.armyId}`,
      kind: 'unitCompleted',
      unitTypeId: event.unitTypeId,
      provinceId: event.provinceId,
    } satisfies FilteredEvent,
  }));
  const buildingEvents = runtime.session.pendingBuildings.splice(0).map((event) => ({
    countryId: runtime.session.state.provinceOwners[event.provinceId],
    event: {
      id: `building-${revision}-${event.provinceId}-${event.buildingId}`,
      kind: 'buildingCompleted',
      buildingId: event.buildingId,
      provinceId: event.provinceId,
    } satisfies FilteredEvent,
  }));
  const combatEvents = runtime.session.pendingCombat.splice(0);
  const publicEvents = runtime.session.pendingCaptures.splice(0).map((event) => ({
    id: `capture-${revision}-${event.provinceId}`, kind: 'capture', ...event,
  } satisfies FilteredEvent));
  return {
    countryEvents: [...unitEvents, ...buildingEvents],
    combatEvents,
    publicEvents,
  };
}

export function eventsForCountry(
  batch: PendingEventBatch, countryId: number, revision: number,
): FilteredEvent[] {
  return [
    ...batch.countryEvents
      .filter((entry) => entry.countryId === countryId)
      .map((entry) => entry.event),
    ...batch.combatEvents
      .filter((event) => event.attacker === countryId || event.defender === countryId)
      .map((event, index) => ({ id: `combat-${revision}-${index}`, ...event })),
    ...batch.publicEvents,
  ];
}
