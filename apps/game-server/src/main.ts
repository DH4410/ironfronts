import {
  GAME_ID, GAME_VERSION,
} from '@ironfronts/protocol';
import { config } from './config';
import { loadWorld } from './world-loader';
import { GameRuntime } from './runtime';
import { ProjectionPublisher } from './publisher';
import { SimulationScheduler } from './scheduler';
import { AuthoritativeGameClock } from './game-clock';
import {
  CLOCK_SYNC_INTERVAL_MS, SIMULATION_INTERVAL_MS, clampSimSpeed,
} from './timing';
import { GamePersistence, type PersistedGame } from './persistence';
import { createInternalApiServer } from './internal-api';
import { GameplayGateway } from './gameplay-gateway';

function log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, service: 'game-server', event, ...fields }));
}

const loaded = await loadWorld(config.worldDirectory);
const gamePersistence = new GamePersistence(config.gameDataPath);
let persisted = await gamePersistence.load();
const currentWorld = persisted?.gameVersion === GAME_VERSION && persisted.worldHash === loaded.hash;
const migratableV2World = persisted?.gameVersion === 'world-at-war@2' && persisted.worldHash === loaded.legacyHash;
if (persisted && (
  persisted.formatVersion !== 2 || persisted.runtime?.version !== 2
  || persisted.gameId !== GAME_ID || !currentWorld && !migratableV2World
)) {
  const archivePath = await gamePersistence.archiveExisting();
  log('warn', 'incompatible_save_archived', { archivePath, previousGameId: persisted.gameId });
  persisted = null;
}
const runtime = new GameRuntime(loaded.world, persisted?.runtime);
const gameClock = new AuthoritativeGameClock(() => runtime.session.state, () => simSpeedMultiplier);
const scheduler = new SimulationScheduler((hours) => runtime.tick(hours));

function persistedGame(): PersistedGame {
  return {
    formatVersion: 2,
    gameId: GAME_ID,
    gameVersion: GAME_VERSION,
    worldHash: loaded.hash,
    savedAtEpochMs: Date.now(),
    gameStartedAtEpochMs: gameClock.gameStartedAtEpochMs,
    runtime: runtime.snapshot(),
  };
}

async function saveGame(): Promise<void> { await gamePersistence.save(persistedGame()); }
function saveGameInBackground(): void {
  void saveGame().catch((error) => log('error', 'game_save_failed', {
    message: error instanceof Error ? error.message : String(error),
  }));
}
if (!persisted) await saveGame();

const server = createInternalApiServer({
  runtime,
  internalSecret: config.internalSecret,
  revision: () => publisher.revision,
  afterJoin: saveGame,
  log,
});
// devSimSpeed is 1 in production; a local tester can set IRONFRONTS_DEV_SIM_SPEED
// (startup default) or the in-session debug-panel control to fast-forward the
// simulation (movement/production/combat) without touching any balance
// constant. The multiplier is a single live value shared by the whole server
// process — every connected player sees the same pace, which is expected for
// a one-tester dev/QA lever, not a per-player setting.
const devControlsEnabled = process.env.NODE_ENV !== 'production';
let simSpeedMultiplier = config.devSimSpeed;
if (simSpeedMultiplier !== 1) log('warn', 'dev_sim_speed_active', { multiplier: simSpeedMultiplier });
/** Clamped (see clampSimSpeed; 0 = paused). No-op outside dev, no matter who calls it. */
function setDevSimSpeed(multiplier: number): void {
  if (!devControlsEnabled) return;
  simSpeedMultiplier = clampSimSpeed(multiplier);
  log('info', 'dev_sim_speed_changed', { multiplier: simSpeedMultiplier });
}

// Same one-value-for-the-whole-process model as devSimSpeed above: a debug
// weather/time change from any connected player is visible to all of them,
// not a per-player preference.
let devTimeOfDayHours: number | null = null;
let devRaining = false;
function setDevEnvironment(next: { timeOfDayHours?: number; raining?: boolean }): void {
  if (!devControlsEnabled) return;
  if (next.timeOfDayHours !== undefined) {
    devTimeOfDayHours = Math.max(0, Math.min(24, next.timeOfDayHours));
  }
  if (next.raining !== undefined) devRaining = next.raining;
  log('info', 'dev_environment_changed', { timeOfDayHours: devTimeOfDayHours, raining: devRaining });
}

const gateway: GameplayGateway = new GameplayGateway({
  server,
  runtime,
  clientOrigin: config.clientOrigin,
  ticketSecret: config.ticketSecret,
  world: { version: loaded.version, hash: loaded.hash, artifactHashes: loaded.artifactHashes, assetBaseUrl: config.worldPublicUrl },
  clock: gameClock,
  revision: () => publisher.revision,
  saveGameInBackground,
  publishNow: () => publisher.publish(),
  beforeDebugChange: () => scheduler.pump(simSpeedMultiplier),
  devSimSpeed: { get: () => simSpeedMultiplier, set: setDevSimSpeed, enabled: devControlsEnabled },
  devEnvironment: {
    get: () => ({ timeOfDayHours: devTimeOfDayHours, raining: devRaining }),
    set: setDevEnvironment,
    enabled: devControlsEnabled,
  },
  log,
});

const publisher: ProjectionPublisher = new ProjectionPublisher(runtime, () => gateway.connections,
  (connection, message) => gateway.send(connection, message), () => simSpeedMultiplier);
const simulationTimer = setInterval(
  () => scheduler.pump(simSpeedMultiplier),
  SIMULATION_INTERVAL_MS,
);
const persistenceTimer = setInterval(saveGameInBackground, 5_000);
// Civil time is derived from simulation state. This sparse sample corrects
// client interpolation drift between authoritative projection updates.
const clockSyncTimer = setInterval(() => {
  const clock = gameClock.snapshot();
  gateway.broadcast({ type: 'clockSync', clock });
}, CLOCK_SYNC_INTERVAL_MS);
const publishTimer = setInterval(() => publisher.publish(), 250);

server.listen(config.port, '127.0.0.1', () => log('info', 'listening', { port: config.port, gameId: GAME_ID }));

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'shutdown', { signal });
  clearInterval(simulationTimer);
  clearInterval(persistenceTimer);
  clearInterval(clockSyncTimer);
  clearInterval(publishTimer);
  gateway.closeAll();
  void saveGame().then(() => gamePersistence.flush()).then(() => {
    server.close(() => process.exit(0));
  }).catch((error) => {
    log('error', 'final_game_save_failed', { message: error instanceof Error ? error.message : String(error) });
    server.close(() => process.exit(1));
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
