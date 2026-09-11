import { describe, expect, it, vi } from 'vitest';
import type { FilteredEvent, PlayerProjection, ServerMessage } from '../../packages/protocol/src/index';
import { ProjectionPublisher } from '../../apps/game-server/src/publisher';
import type { GameplayConnection } from '../../apps/game-server/src/gameplay-gateway';
import type { GameRuntime } from '../../apps/game-server/src/runtime';

function projection(): PlayerProjection {
  return { simulationTick: 0, viewerCountryId: 1, startCamera: { x: 0, z: 0, distance: 1 },
    countries: { 1: { id: 1, name: 'A', color: '#fff', controller: 'player', alive: true } },
    provinceOwners: {}, provinceBuildings: {}, provinceActions: {}, productionQueues: {}, constructionQueues: {},
    rallyPoints: {}, armies: {}, resourceNodes: {}, ownCountry: null, relations: {} };
}
function harness(results: boolean[]) {
  const state = { countries: { 1: { id: 1 } }, nextEventId: 1 };
  const session = { state, pendingCompletions: [] as unknown[], pendingBuildings: [] as unknown[], pendingCombat: [] as unknown[], pendingCaptures: [] as unknown[] };
  const runtime = { session, world: { provinces: [{ id: 4, center: [40, 80] }] }, projection } as unknown as GameRuntime;
  const connection = { countryId: 1, revision: 0, projection: projection(), socket: {}, accountId: 'a' } as GameplayConnection;
  const messages: ServerMessage[] = [];
  const send = vi.fn((_connection: GameplayConnection, message: ServerMessage) => {
    messages.push(message); return results.shift() ?? true;
  });
  return { session, connection, messages, send, publisher: new ProjectionPublisher(runtime, () => [connection], send, () => 1) };
}

describe('delivery-aware projection publisher', () => {
  it('retries an event-only delta with the same event identity after backpressure', () => {
    const h = harness([false, true]);
    h.session.pendingCompletions.push({ ownerCountryId: 1, provinceId: 4, unitTypeId: 'infantry', armyId: 'army-9' });
    h.publisher.publish();
    expect(h.publisher.revision).toBe(0);
    h.publisher.publish();
    expect(h.publisher.revision).toBe(1);
    const events = h.messages.map((message) => message.type === 'delta' ? message.events[0] : undefined).filter(Boolean) as FilteredEvent[];
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe(events[1].id);
    expect(events[1]).toMatchObject({ kind: 'unitCompleted', ownerCountryId: 1, armyId: 'army-9', x: 40, z: 80 });
    h.publisher.publish();
    expect(h.messages).toHaveLength(2);
  });
});
