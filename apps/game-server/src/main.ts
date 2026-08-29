import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import {
  GAME_ID, GAME_VERSION, PROTOCOL_VERSION, clientMessageSchema,
  type FilteredEvent, type PlayerProjection, type ServerMessage,
} from '@ironfronts/protocol';
import { verifyGameTicket } from '@ironfronts/protocol/ticket';
import { config } from './config';
import { loadWorld } from './world-loader';
import { GameRuntime } from './runtime';
import { diffProjection } from './projection';
import { TicketNonceStore } from './ticket-nonces';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, service: 'game-server', event, ...fields }));
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_768) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
}

const mimeTypes: Record<string, string> = {
  '.json': 'application/json', '.f32': 'application/octet-stream', '.u32': 'application/octet-stream',
  '.u16': 'application/octet-stream', '.rgba8': 'application/octet-stream', '.rg8': 'application/octet-stream',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

interface ClientConnection {
  socket: WebSocket;
  accountId: string;
  countryId: number;
  projection: PlayerProjection;
  revision: number;
}

const loaded = await loadWorld(config.worldDirectory);
const runtime = new GameRuntime(loaded.world);
const connections = new Set<ClientConnection>();
const usedNonces = new TicketNonceStore();
const recentCommands = new Map<string, Map<string, ServerMessage>>();
let revision = 0;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname === '/health') {
      sendJson(response, 200, { ok: true, service: 'game-server', gameId: GAME_ID, revision });
      return;
    }
    if (url.pathname.startsWith('/world/')) {
      const relative = decodeURIComponent(url.pathname.replace(/^\/world\/(?:v\d+\/)?/, ''));
      const filePath = path.resolve(config.worldDirectory, relative);
      if (!filePath.startsWith(`${config.worldDirectory}${path.sep}`)) {
        sendJson(response, 403, { error: 'Invalid asset path.' });
        return;
      }
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error('Asset not found.');
      const bytes = await readFile(filePath);
      response.writeHead(200, {
        'content-type': mimeTypes[path.extname(filePath)] ?? 'application/octet-stream',
        'cache-control': 'public, max-age=31536000, immutable',
        'access-control-allow-origin': config.clientOrigin,
      });
      response.end(bytes);
      return;
    }
    if (!url.pathname.startsWith('/internal/v1/')) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }
    if (request.headers.authorization !== `Bearer ${config.internalSecret}`) {
      sendJson(response, 401, { error: 'Invalid service credentials.' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/internal/v1/lobby') {
      sendJson(response, 200, runtime.lobby(url.searchParams.get('accountId') ?? undefined));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/internal/v1/join') {
      const input = await body(request);
      if (typeof input.accountId !== 'string' || !Number.isInteger(input.countryId)) {
        sendJson(response, 400, { error: 'accountId and countryId are required.' });
        return;
      }
      const result = runtime.join(input.accountId, Number(input.countryId));
      sendJson(response, result.ok ? 200 : 409, result);
      if (result.ok) log('info', 'country_claimed', { countryId: result.countryId });
      return;
    }
    sendJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    sendJson(response, message === 'Asset not found.' ? 404 : 500, { error: message });
  }
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: 32_768 });
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/v1/game' || request.headers.origin !== config.clientOrigin) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (ws) => sockets.emit('connection', ws, request));
});

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

sockets.on('connection', (socket) => {
  let connection: ClientConnection | null = null;
  const authenticationTimeout = setTimeout(() => {
    if (!connection) {
      send(socket, { type: 'error', code: 'authentication_required', message: 'Authenticate before using the game connection.' });
      socket.close(4401, 'Authentication required');
    }
  }, 5_000);

  socket.on('message', (data) => {
    try {
      const message = clientMessageSchema.parse(JSON.parse(data.toString()));
      if (message.type === 'authenticate') {
        if (connection) throw new Error('Connection is already authenticated.');
        const claims = verifyGameTicket(message.ticket, config.ticketSecret);
        if (claims.gameId !== GAME_ID) throw new Error('Ticket is for a different game.');
        if (!usedNonces.consume(claims.nonce, claims.expiresAt)) throw new Error('Game ticket has already been used.');
        if (runtime.seat(claims.accountId) !== claims.countryId) throw new Error('Ticket does not match the authoritative seat.');
        clearTimeout(authenticationTimeout);
        const projection = runtime.projection(claims.countryId);
        connection = { socket, accountId: claims.accountId, countryId: claims.countryId, projection, revision };
        connections.add(connection);
        send(socket, {
          type: 'hello', gameId: GAME_ID, gameVersion: GAME_VERSION, protocolVersion: PROTOCOL_VERSION,
          capabilities: ['filtered-baseline', 'change-only-deltas', 'resync', 'optimistic-commands'],
          world: {
            version: loaded.version,
            hash: loaded.hash,
            assetBaseUrl: `${config.publicHttpUrl}/world/v${loaded.version}`,
          },
          countryId: claims.countryId,
        });
        send(socket, { type: 'baseline', revision, state: projection, catalogs: runtime.catalogs });
        log('info', 'client_connected', { countryId: claims.countryId });
        return;
      }
      if (!connection) throw new Error('Authentication required.');
      if (message.type === 'resync') {
        const projection = runtime.projection(connection.countryId);
        connection.projection = projection;
        connection.revision = revision;
        send(socket, { type: 'baseline', revision, state: projection, catalogs: runtime.catalogs });
        return;
      }
      const accountCommands = recentCommands.get(connection.accountId) ?? new Map<string, ServerMessage>();
      recentCommands.set(connection.accountId, accountCommands);
      const existing = accountCommands.get(message.commandId);
      if (existing) { send(socket, existing); return; }
      const result = runtime.command(connection.countryId, message.command);
      const ack: ServerMessage = {
        type: 'commandAck', commandId: message.commandId, ok: result.ok,
        ...(result.reason ? { reason: result.reason } : {}),
      };
      accountCommands.set(message.commandId, ack);
      if (accountCommands.size > 256) accountCommands.delete(accountCommands.keys().next().value!);
      send(socket, ack);
    } catch (error) {
      send(socket, { type: 'error', code: 'invalid_message', message: error instanceof Error ? error.message : 'Invalid message.' });
    }
  });
  socket.on('close', () => {
    clearTimeout(authenticationTimeout);
    if (connection) connections.delete(connection);
  });
});

const simulationTimer = setInterval(() => runtime.tick(0.5 / 10), 100);
const publishTimer = setInterval(() => {
  const unitEvents = runtime.session.pendingCompletions.splice(0).map((event) => ({
    countryId: runtime.session.state.armies[event.armyId]?.ownerCountryId ?? runtime.session.state.provinceOwners[event.provinceId],
    event: { id: `unit-${revision}-${event.armyId}`, kind: 'unitCompleted', unitTypeId: event.unitTypeId, provinceId: event.provinceId } satisfies FilteredEvent,
  }));
  const buildingEvents = runtime.session.pendingBuildings.splice(0).map((event) => ({
    countryId: runtime.session.state.provinceOwners[event.provinceId],
    event: { id: `building-${revision}-${event.provinceId}-${event.buildingId}`, kind: 'buildingCompleted', buildingId: event.buildingId, provinceId: event.provinceId } satisfies FilteredEvent,
  }));
  const combatEvents = runtime.session.pendingCombat.splice(0);
  const captureEvents = runtime.session.pendingCaptures.splice(0).map((event) => ({
    id: `capture-${revision}-${event.provinceId}`, kind: 'capture', ...event,
  } satisfies FilteredEvent));
  if (!connections.size) return;
  const byCountry = new Map<number, PlayerProjection>();
  for (const connection of connections) {
    if (!byCountry.has(connection.countryId)) byCountry.set(connection.countryId, runtime.projection(connection.countryId));
  }
  const changes = [...connections].map((connection) => ({
    connection,
    next: byCountry.get(connection.countryId)!,
    delta: diffProjection(connection.projection, byCountry.get(connection.countryId)!),
  }));
  if (!changes.some((entry) => entry.delta)) return;
  revision += 1;
  for (const { connection, next, delta } of changes) {
    const events: FilteredEvent[] = [
      ...unitEvents.filter((entry) => entry.countryId === connection.countryId).map((entry) => entry.event),
      ...buildingEvents.filter((entry) => entry.countryId === connection.countryId).map((entry) => entry.event),
      ...combatEvents.filter((event) => event.attacker === connection.countryId || event.defender === connection.countryId)
        .map((event, index) => ({ id: `combat-${revision}-${index}`, kind: event.kind, attacker: event.attacker, defender: event.defender })),
      ...captureEvents,
    ];
    if (delta) send(connection.socket, { type: 'delta', fromRevision: connection.revision, revision, delta, events });
    connection.projection = next;
    connection.revision = revision;
  }
}, 250);

server.listen(config.port, '127.0.0.1', () => log('info', 'listening', { port: config.port, gameId: GAME_ID }));

function shutdown(signal: string): void {
  log('info', 'shutdown', { signal });
  clearInterval(simulationTimer);
  clearInterval(publishTimer);
  for (const connection of connections) connection.socket.close(1001, 'Server shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
