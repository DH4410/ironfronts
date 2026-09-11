import { z } from 'zod';
import { parseGameState } from '@ironfronts/game-core';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GameRuntimeSnapshot } from './runtime';

export interface PersistedGame {
  formatVersion: 2;
  gameId: string;
  gameVersion: string;
  worldHash: string;
  savedAtEpochMs: number;
  gameStartedAtEpochMs: number;
  runtime: GameRuntimeSnapshot;
}

/** Serialized queue plus same-directory rename keeps every JSON snapshot whole. */
export class GamePersistence {
  private queue: Promise<void> = Promise.resolve();

  constructor(readonly filePath: string) {}

  async load(): Promise<PersistedGame | null> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8'));
      const envelope = z.object({ formatVersion: z.literal(2), gameId: z.string(), gameVersion: z.string(), worldHash: z.string(),
        savedAtEpochMs: z.number().finite(), gameStartedAtEpochMs: z.number().finite(),
        runtime: z.object({ version: z.literal(2), state: z.unknown(), seats: z.array(z.tuple([z.string().min(1), z.number().int().positive()])) }) }).parse(raw);
      return { ...envelope, runtime: { ...envelope.runtime, state: parseGameState(envelope.runtime.state, envelope.gameStartedAtEpochMs) } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  save(snapshot: PersistedGame): Promise<void> {
    const serialized = `${JSON.stringify(snapshot)}\n`;
    const operation = this.queue.then(async () => {
      const directory = path.dirname(this.filePath);
      const temporaryPath = `${this.filePath}.tmp`;
      await mkdir(directory, { recursive: true });
      try {
        await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
        await rename(temporaryPath, this.filePath);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async flush(): Promise<void> { await this.queue; }

  /** Move an incompatible save aside before starting a fresh world. */
  async archiveExisting(): Promise<string | null> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = `${this.filePath}.incompatible-backup-${stamp}`;
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await rename(this.filePath, archivePath);
      return archivePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}
