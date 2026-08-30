import {
  PROTOCOL_VERSION, serverMessageSchema, type CommandPayload, type PlayerProjection,
  type PresentationCatalogs, type ServerMessage, type WorldDescriptor,
} from '@ironfronts/protocol';
import { connectGame } from './auth-api';
import { applyDelta } from './replica-store';
import { InterpolatedGameClock, type GameClockReading } from './game-clock';

interface PendingCommand {
  timer: number;
  settle: (ok: boolean, reason?: string, requiredWarCountryIds?: readonly number[]) => void;
}

export class GameConnection extends EventTarget {
  state!: PlayerProjection;
  catalogs!: PresentationCatalogs;
  world!: WorldDescriptor;
  revision = 0;
  private readonly gameClock = new InterpolatedGameClock();
  private socket: WebSocket | null = null;
  private closed = false;
  private commandSequence = 0;
  private readonly pending = new Map<string, PendingCommand>();

  static async open(): Promise<GameConnection> {
    const connection = new GameConnection();
    await connection.connect();
    return connection;
  }

  private async connect(): Promise<void> {
    const descriptor = await connectGame();
    if (descriptor.protocolVersion !== PROTOCOL_VERSION) throw new Error('The game uses an unsupported protocol version.');
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(descriptor.websocketUrl);
      this.socket = socket;
      let ready = false;
      const timeout = window.setTimeout(() => reject(new Error('Game connection timed out.')), 10_000);
      socket.addEventListener('open', () => socket.send(JSON.stringify({
        type: 'authenticate', protocolVersion: PROTOCOL_VERSION, ticket: descriptor.ticket,
      })));
      socket.addEventListener('message', (event) => {
        const message: ServerMessage = serverMessageSchema.parse(JSON.parse(String(event.data)));
        if (message.type === 'hello') {
          if (message.protocolVersion !== PROTOCOL_VERSION) { reject(new Error('Protocol mismatch.')); socket.close(); return; }
          this.world = message.world;
        } else if (message.type === 'baseline') {
          this.state = message.state;
          this.catalogs = message.catalogs;
          this.revision = message.revision;
          this.gameClock.synchronize(message.clock);
          this.dispatchEvent(new Event('state'));
          if (!ready) { ready = true; clearTimeout(timeout); resolve(); }
        } else if (message.type === 'delta') {
          if (message.fromRevision !== this.revision) {
            socket.send(JSON.stringify({ type: 'resync', afterRevision: this.revision }));
            return;
          }
          this.state = applyDelta(this.state, message.delta);
          this.revision = message.revision;
          this.dispatchEvent(new Event('state'));
          for (const filteredEvent of message.events) this.dispatchEvent(new CustomEvent('game-event', { detail: filteredEvent }));
        } else if (message.type === 'commandAck') {
          const pending = this.pending.get(message.commandId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(message.commandId);
            pending.settle(message.ok, message.reason, message.requiredWarCountryIds);
          }
        } else if (message.type === 'clockSync') {
          this.gameClock.synchronize(message.clock);
          this.dispatchEvent(new Event('clock-sync'));
        } else if (message.type === 'error') {
          this.dispatchEvent(new CustomEvent('connection-error', { detail: message.message }));
        }
      });
      socket.addEventListener('error', () => { if (!ready) reject(new Error('Unable to connect to game server.')); });
      socket.addEventListener('close', () => {
        clearTimeout(timeout);
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.settle(false, 'Connection lost.'); }
        this.pending.clear();
        if (!this.closed && ready) window.setTimeout(() => void this.reconnect(), 1_000);
      });
    });
  }

  private async reconnect(): Promise<void> {
    try { await this.connect(); }
    catch { if (!this.closed) window.setTimeout(() => void this.reconnect(), 2_500); }
  }

  command(
    command: CommandPayload,
    onResult: (ok: boolean, reason?: string, requiredWarCountryIds?: readonly number[]) => void,
  ): string {
    const commandId = `${Date.now().toString(36)}-${(++this.commandSequence).toString(36)}`;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      queueMicrotask(() => onResult(false, 'Connection unavailable.'));
      return commandId;
    }
    const timer = window.setTimeout(() => {
      this.pending.delete(commandId);
      onResult(false, 'Command timed out.');
    }, 5_000);
    this.pending.set(commandId, { timer, settle: onResult });
    this.socket.send(JSON.stringify({ type: 'command', commandId, command }));
    return commandId;
  }

  readClock(): GameClockReading { return this.gameClock.read(); }

  close(): void { this.closed = true; this.socket?.close(1000, 'Client closed'); }
}
