/** Gameplay WebSocket transport: upgrades, authentication, commands, and connections. */

import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  GAME_ID, GAME_VERSION, PROTOCOL_VERSION, clientMessageSchema,
  type PlayerProjection, type ServerMessage, type WorldDescriptor,
} from '@ironfronts/protocol';
import { verifyGameTicket } from '@ironfronts/protocol/ticket';
import type { GameRuntime } from './runtime';
import type { AuthoritativeGameClock } from './game-clock';
import { TicketNonceStore } from './ticket-nonces';

const DEBUG_MESSAGE_TYPES = new Set([
  'devSetSimSpeed', 'devSetClock', 'devSetMovementSpeed', 'devSetEnvironment',
  'devSetRelation', 'devInspectState', 'devGetFullState',
]);

function requestedMessageType(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('type' in value)) return null;
  return typeof value.type === 'string' ? value.type : null;
}

export interface GameplayConnection {
  readonly socket: WebSocket;
  readonly accountId: string;
  readonly countryId: number;
  readonly debugEnabled: boolean;
  projection: PlayerProjection;
  revision: number;
}

export interface GameplayGatewayOptions {
  readonly server: HttpServer;
  readonly runtime: GameRuntime;
  readonly clientOrigin: string;
  readonly ticketSecret: string;
  /** Explicit deployment gate; a signed account claim is still required. */
  readonly debugControlsEnabled: boolean;
  readonly world: WorldDescriptor;
  readonly clock: AuthoritativeGameClock;
  readonly revision: () => number;
  readonly publishNow: () => void;
  readonly beforeDebugChange: () => void;
  readonly saveGameInBackground: () => void;
  readonly devSimSpeed: { get(): number; set(multiplier: number): void; enabled: boolean };
  readonly devEnvironment: {
    get(): { timeOfDayHours: number | null; raining: boolean };
    set(next: { timeOfDayHours?: number; raining?: boolean }): void;
    enabled: boolean;
  };
  readonly log: (
    level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>,
  ) => void;
}

export class GameplayGateway {
  readonly connections = new Set<GameplayConnection>();

  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 32_768 });
  private readonly usedNonces = new TicketNonceStore();
  private readonly recentCommands = new Map<string, Map<string, ServerMessage>>();

  constructor(private readonly options: GameplayGatewayOptions) {
    options.server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      if (url.pathname !== '/v2/game' || request.headers.origin !== options.clientOrigin) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.sockets.handleUpgrade(
        request, socket, head,
        (webSocket) => this.sockets.emit('connection', webSocket, request),
      );
    });
    this.sockets.on('connection', (socket) => this.handleConnection(socket));
  }

  send(connection: GameplayConnection, message: ServerMessage): boolean {
    return this.sendSocket(connection.socket, message);
  }

  broadcast(message: ServerMessage): void {
    for (const connection of this.connections) this.send(connection, message);
  }

  private sendDebugState(connection: GameplayConnection): void {
    this.send(connection, {
      type: 'devSimSpeed', multiplier: this.options.devSimSpeed.get(),
      devControlsEnabled: connection.debugEnabled,
      movementMultiplier: this.options.runtime.session.movementSpeedMultiplier,
    });
    this.send(connection, {
      type: 'devEnvironment', ...this.options.devEnvironment.get(),
      devControlsEnabled: connection.debugEnabled,
    });
  }

  private broadcastDebugState(): void {
    for (const connection of this.connections) this.sendDebugState(connection);
  }

  closeAll(code = 1001, reason = 'Server shutting down'): void {
    for (const socket of this.sockets.clients) socket.close(code, reason);
    this.sockets.close();
  }

  private sendSocket(socket: WebSocket, message: ServerMessage): boolean {
    if (socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > 2_000_000) { socket.close(1013, 'Resynchronize slow connection'); return false; }
    socket.send(JSON.stringify(message));
    return true;
  }

  private handleConnection(socket: WebSocket): void {
    let connection: GameplayConnection | null = null;
    const authenticationTimeout = setTimeout(() => {
      if (!connection) {
        this.sendSocket(socket, {
          type: 'error', code: 'authentication_required',
          message: 'Authenticate before using the game connection.',
        });
        socket.close(4401, 'Authentication required');
      }
    }, 5_000);

    socket.on('message', (data) => {
      try {
        const raw: unknown = JSON.parse(data.toString());
        const requestedType = requestedMessageType(raw);
        if (!connection && requestedType && DEBUG_MESSAGE_TYPES.has(requestedType)) {
          this.sendSocket(socket, {
            type: 'error', code: 'authentication_required',
            message: 'Authenticate before using the game connection.',
          });
          return;
        }
        if (connection && requestedType && DEBUG_MESSAGE_TYPES.has(requestedType)
          && !connection.debugEnabled) {
          this.sendSocket(socket, {
            type: 'error', code: 'unauthorized_debug',
            message: 'This account is not authorized to use debug controls.',
          });
          return;
        }
        const message = clientMessageSchema.parse(raw);
        if (message.type === 'authenticate') {
          if (connection) throw new Error('Connection is already authenticated.');
          const claims = verifyGameTicket(message.ticket, this.options.ticketSecret);
          if (claims.gameId !== GAME_ID) throw new Error('Ticket is for a different game.');
          if (!this.usedNonces.consume(claims.nonce, claims.expiresAt)) {
            throw new Error('Game ticket has already been used.');
          }
          if (this.options.runtime.seat(claims.accountId) !== claims.countryId) {
            throw new Error('Ticket does not match the authoritative seat.');
          }
          clearTimeout(authenticationTimeout);
          const revision = this.options.revision();
          const projection = this.options.runtime.projection(claims.countryId, this.options.devSimSpeed.get());
          const debugEnabled = claims.debugEntitled && this.options.debugControlsEnabled;
          connection = {
            socket, accountId: claims.accountId, countryId: claims.countryId, debugEnabled,
            projection, revision,
          };
          this.connections.add(connection);
          this.sendSocket(socket, {
            type: 'hello', gameId: GAME_ID, gameVersion: GAME_VERSION,
            protocolVersion: PROTOCOL_VERSION,
            capabilities: [
              'filtered-baseline', 'change-only-deltas', 'resync',
              'pending-commands', 'authoritative-timeline',
            ],
            world: this.options.world,
            countryId: claims.countryId,
            debugEnabled,
          });
          this.sendSocket(socket, {
            type: 'baseline', revision, state: projection,
            catalogs: this.options.runtime.catalogs, clock: this.options.clock.snapshot(),
          });
          this.sendDebugState(connection);
          this.options.log('info', 'client_connected', { countryId: claims.countryId });
          return;
        }
        if (!connection) {
          this.sendSocket(socket, {
            type: 'error', code: 'authentication_required',
            message: 'Authenticate before using the game connection.',
          });
          return;
        }
        if (message.type === 'ping') {
          this.sendSocket(socket, { type: 'pong', sentAt: message.sentAt, serverEpochMs: Date.now() }); return;
        }
        if (message.type === 'devSetSimSpeed' || message.type === 'devSetClock' || message.type === 'devSetMovementSpeed') {
          if (!connection.debugEnabled) {
            this.sendSocket(socket, {
              type: 'error', code: 'unauthorized_debug',
              message: 'This account is not authorized to use debug controls.',
            });
            return;
          }
          this.options.beforeDebugChange();
          if (message.type === 'devSetSimSpeed') this.options.devSimSpeed.set(message.multiplier);
          else if (message.type === 'devSetClock') this.options.clock.setEpoch(message.epochMs);
          else this.options.runtime.session.movementSpeedMultiplier = message.multiplier;
          this.options.publishNow();
          this.broadcast({ type: 'clockSync', clock: this.options.clock.snapshot() });
          this.options.saveGameInBackground();
          this.broadcastDebugState();
          return;
        }
        if (message.type === 'devSetEnvironment') {
          if (!connection.debugEnabled) {
            this.sendSocket(socket, {
              type: 'error', code: 'unauthorized_debug',
              message: 'This account is not authorized to use debug controls.',
            });
            return;
          }
          this.options.devEnvironment.set(message);
          this.broadcastDebugState();
          return;
        }
        if (message.type === 'resync') {
          const projection = this.options.runtime.projection(connection.countryId, this.options.devSimSpeed.get());
          connection.projection = projection;
          connection.revision = this.options.revision();
          this.sendSocket(socket, {
            type: 'baseline', revision: connection.revision, state: projection,
            catalogs: this.options.runtime.catalogs, clock: this.options.clock.snapshot(),
          });
          return;
        }

        const accountCommands = this.recentCommands.get(connection.accountId)
          ?? new Map<string, ServerMessage>();
        this.recentCommands.set(connection.accountId, accountCommands);
        const existing = accountCommands.get(message.commandId);
        if (existing) {
          this.sendSocket(socket, existing);
          return;
        }
        const result = this.options.runtime.command(connection.countryId, message.command);
        if (result.ok) { this.options.publishNow(); this.options.saveGameInBackground(); }
        const acknowledgement: ServerMessage = {
          type: 'commandAck', commandId: message.commandId, ok: result.ok,
          ...(result.ok ? { appliedRevision: connection.revision } : {}),
          ...(result.reason ? { reason: result.reason } : {}),
          ...(result.requiredWarCountryIds?.length
            ? { requiredWarCountryIds: result.requiredWarCountryIds } : {}),
        };
        accountCommands.set(message.commandId, acknowledgement);
        if (accountCommands.size > 256) accountCommands.delete(accountCommands.keys().next().value!);
        this.sendSocket(socket, acknowledgement);
      } catch (error) {
        this.sendSocket(socket, {
          type: 'error', code: 'invalid_message',
          message: error instanceof Error ? error.message : 'Invalid message.',
        });
      }
    });
    socket.on('error', (error) => this.options.log('warn', 'socket_error', { message: error.message }));
    socket.on('close', () => {
      clearTimeout(authenticationTimeout);
      if (connection) this.connections.delete(connection);
    });
  }
}
