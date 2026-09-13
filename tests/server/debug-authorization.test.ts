import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { GAME_ID, PROTOCOL_VERSION } from '../../packages/protocol/src/index';
import { signGameTicket } from '../../packages/protocol/src/ticket';
import { isDebugEntitledUsername } from '../../apps/auth-server/src/debug-entitlement';
import { GameplayGateway } from '../../apps/game-server/src/gameplay-gateway';

const secret = 'a sufficiently long debug authorization secret';
const openGateways: Array<{ gateway: GameplayGateway; server: ReturnType<typeof createServer> }> = [];

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  bufferedAmount = 0;
  readonly sent: Array<Record<string, unknown>> = [];
  readonly close = vi.fn((code?: number, reason?: string) => {
    this.readyState = WebSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason ?? ''));
  });
  send(text: string): void { this.sent.push(JSON.parse(text) as Record<string, unknown>); }
  message(value: unknown): void { this.emit('message', Buffer.from(JSON.stringify(value))); }
}

function projection() {
  return {
    simulationTick: 0, viewerCountryId: 7, startCamera: { x: 0, z: 0, distance: 1 },
    countries: {}, provinceOwners: {}, provinceBuildings: {}, provinceActions: {},
    productionQueues: {}, constructionQueues: {}, rallyPoints: {}, armies: {}, resourceNodes: {},
    ownCountry: null, relations: {},
  } as never;
}

function setup(deploymentEnabled = true) {
  const server = createServer();
  const setSpeed = vi.fn();
  const setEnvironment = vi.fn();
  const gateway = new GameplayGateway({
    server,
    runtime: {
      seat: () => 7, projection, catalogs: { units: [], buildings: [] },
      command: vi.fn(), session: { movementSpeedMultiplier: 1 },
    } as never,
    clientOrigin: 'http://client', ticketSecret: secret,
    world: { version: '1', hash: 'a'.repeat(64), assetBaseUrl: 'http://world', artifactHashes: {} },
    clock: { snapshot: () => ({ gameStartedAtEpochMs: 0, gameEpochMs: 0, serverEpochMs: 0, speed: 1, generation: 0, utcOffsetMinutes: 0 }) } as never,
    revision: () => 0, publishNow: vi.fn(), beforeDebugChange: vi.fn(), saveGameInBackground: vi.fn(),
    debugControlsEnabled: deploymentEnabled,
    devSimSpeed: { get: () => 1, set: setSpeed, enabled: deploymentEnabled },
    devEnvironment: {
      get: () => ({ timeOfDayHours: null, raining: false }), set: setEnvironment,
      enabled: deploymentEnabled,
    },
    log: vi.fn(),
  } as never);
  openGateways.push({ gateway, server });
  const connect = (debugEntitled: boolean, nonce: string) => {
    const socket = new FakeSocket();
    (gateway as unknown as { handleConnection(socket: WebSocket): void })
      .handleConnection(socket as unknown as WebSocket);
    socket.message({
      type: 'authenticate', protocolVersion: PROTOCOL_VERSION,
      ticket: signGameTicket({
        accountId: `account-${nonce}`, gameId: GAME_ID, countryId: 7,
        audience: 'game-server', protocolVersion: PROTOCOL_VERSION,
        expiresAt: Date.now() + 30_000, nonce, debugEntitled,
      }, secret),
    });
    return socket;
  };
  return { gateway, setSpeed, setEnvironment, connect };
}

afterEach(() => {
  for (const { gateway, server } of openGateways.splice(0)) {
    gateway.closeAll();
    server.close();
  }
});

describe('account-derived debug authorization', () => {
  it('recognizes only DimaTest1 with case-insensitive matching', () => {
    expect(isDebugEntitledUsername('DimaTest1')).toBe(true);
    expect(isDebugEntitledUsername('dImAtEsT1')).toBe(true);
    expect(isDebugEntitledUsername('normal-account')).toBe(false);
  });

  it('requires the deployment gate even for an entitled ticket', () => {
    const { connect } = setup(false);
    const socket = connect(true, 'disabled-deployment');
    expect(socket.sent.find((message) => message.type === 'hello')).toMatchObject({ debugEnabled: false });
    socket.close();
  });

  it('authorizes Dima per connection without authorizing a normal account', () => {
    const { connect } = setup();
    const dima = connect(true, 'dima');
    const normal = connect(false, 'normal');
    expect(dima.sent.find((message) => message.type === 'hello')).toMatchObject({ debugEnabled: true });
    expect(normal.sent.find((message) => message.type === 'hello')).toMatchObject({ debugEnabled: false });
    expect(dima.sent.find((message) => message.type === 'devSimSpeed')).toMatchObject({ devControlsEnabled: true });
    expect(normal.sent.find((message) => message.type === 'devSimSpeed')).toMatchObject({ devControlsEnabled: false });
    dima.close(); normal.close();
  });

  it('rejects a debug operation before authentication with a specific error', () => {
    const { gateway } = setup();
    const socket = new FakeSocket();
    (gateway as unknown as { handleConnection(socket: WebSocket): void })
      .handleConnection(socket as unknown as WebSocket);
    socket.message({ type: 'devSetSimSpeed', multiplier: 4 });
    expect(socket.sent.at(-1)).toMatchObject({ type: 'error', code: 'authentication_required' });
    socket.close();
  });

  it('rejects every forged debug operation from an authenticated normal account', () => {
    const { connect, setSpeed, setEnvironment } = setup();
    const socket = connect(false, 'forged');
    for (const request of [
      { type: 'devSetSimSpeed', multiplier: 4, debugEntitled: true },
      { type: 'devSetClock', epochMs: 0 },
      { type: 'devSetEnvironment', timeOfDayHours: 12 },
      { type: 'devSetEnvironment', raining: true },
      { type: 'devSetRelation', countryId: 2, relation: 'war' },
      { type: 'devInspectState' },
    ]) {
      socket.message(request);
      expect(socket.sent.at(-1), request.type).toMatchObject({
        type: 'error', code: 'unauthorized_debug',
      });
    }
    expect(setSpeed).not.toHaveBeenCalled();
    expect(setEnvironment).not.toHaveBeenCalled();
    socket.close();
  });
});
