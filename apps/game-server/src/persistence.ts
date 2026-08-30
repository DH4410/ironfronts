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
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as PersistedGame;
      return parsed;
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

  /** Move an incompatible save aside before starting a fresh v2 world. */
  async archiveExisting(): Promise<string | null> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = `${this.filePath}.v1-backup-${stamp}`;
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
