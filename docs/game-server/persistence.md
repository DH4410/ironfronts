# State, World Loading, and Persistence

## World inputs

The game server requires a local generated world package for authoritative simulation. `WORLD_DIRECTORY` must contain:

- `world.json`
- `province-details.json`
- `province-owners.u32`
- `province-ids.u16`
- `surface.rgba8`
- `height.f32`
- `connections.f32`

At startup the loader parses the manifest and province sidecar, reads the binary fields, derives resource nodes from surface/height data, and builds `WorldData` including province lookup and the land movement graph inputs.

The server calculates `worldHash` as SHA-256 of the raw `world.json` bytes. This hash identifies save compatibility and is sent to clients in `hello`. It does not currently cover the sidecar or binary artifact bytes individually, so world packages must be deployed as one immutable/versioned unit.

`WORLD_PUBLIC_URL` is not read by the loader. It is the browser-visible location announced for the corresponding static package.

## Save envelope

The JSON at `GAME_DATA_PATH` has this top-level shape:

```ts
interface PersistedGame {
  formatVersion: 2;
  gameId: string;
  gameVersion: string;
  worldHash: string;
  savedAtEpochMs: number;
  gameStartedAtEpochMs: number;
  runtime: {
    version: 2;
    state: GameState;
    seats: Array<[accountId: string, countryId: number]>;
  };
}
```

`GameState` is entirely plain JSON data. The movement graph, world lookup functions, and other derived caches are rebuilt from the deployed world package when the snapshot is restored.

The save contains permanent account seats. It does not contain active sockets, transport revisions, recent command-ID acknowledgements, used ticket nonces, queued presentation events, timer handles, or `GameSession`'s periodic income/AI accumulators.

## Compatibility and reset behavior

A loaded save is accepted only when all of the following match:

- `formatVersion === 2`
- `runtime.version === 2`
- `gameId === world-at-war-2`
- `gameVersion === world-at-war@2`
- `worldHash` equals the current local `world.json` hash

If any check fails, the server moves the file to:

```text
<GAME_DATA_PATH>.v1-backup-<ISO timestamp with colon/dot replaced by hyphen>
```

It then initializes a fresh `OP-1939-01` campaign and immediately saves it. Despite the historical `.v1-backup-` label, this archive path is used for any incompatible envelope.

There is no migration pipeline. Changing a compatibility constant or the manifest bytes deliberately starts a fresh game while retaining the old file as a recoverable archive.

After envelope checks, runtime construction also rejects invalid seats—for example an empty account ID, a nonexistent country, or two accounts assigned to one country. Other malformed nested state can fail during restore. Such errors are startup failures, not automatic resets.

## Snapshot schedule

Snapshots are requested:

- immediately after creating a fresh game;
- synchronously after a successful new country claim;
- in the background after every successful gameplay command;
- every five seconds;
- once during graceful shutdown, followed by a queue flush.

The simulation itself can change between these points. A crash can therefore lose up to roughly the regular five-second interval of uncommanded simulation progress, plus event-loop/write latency. Successful command acknowledgement schedules rather than awaits the background write, so an immediate hard crash can also lose a just-acknowledged command.

## Atomic serialized writes

`GamePersistence` serializes save operations through one promise queue. Each operation:

1. Creates the destination directory recursively.
2. Writes complete JSON plus a trailing newline to `<GAME_DATA_PATH>.tmp` with mode `0600` where supported.
3. Renames the temporary file onto `GAME_DATA_PATH` in the same directory.
4. Removes the temporary file if writing/rename fails.

Same-directory rename prevents readers from observing a partly written JSON document. Serialized operations prevent concurrent timer/command/shutdown snapshots from racing each other. A failed operation is surfaced to its caller, but the internal queue is recovered so later saves can still run.

## Seats

The runtime maintains two maps reconstructed from the persisted `seats` tuples:

- account ID to country ID;
- country ID to account ID.

An account assignment is permanent for the lifetime of that save. A claimed country cannot be selected by another account. Rejoining the same country with the same account is idempotent. The seat remains even if the country later loses all territory; `alive` and `claimed` are separate lobby properties.

Resetting the game by starting from a fresh save also resets every seat. Archiving only the auth database does not change authoritative country assignment; archiving only `game.json` does.

## Restart semantics

Restored:

- authoritative `GameState`, including `simulationTick`, game hours, armies/orders, battles/fronts and cooldown ticks;
- stockpiles, territory, queues, diplomacy, and ID counters;
- account seats;
- original civil `gameStartedAtEpochMs`.

Reinitialized:

- transport revision starts at `0`;
- socket set is empty;
- ticket nonce replay cache is empty;
- command deduplication cache is empty;
- transient event queues are empty;
- one-game-hour income and two-game-hour AI internal accumulators start at zero (income values themselves are recomputed during session construction).

Because gameplay does not advance offline, a persisted combat timer at tick `T + n` still has `n` simulation steps remaining after restart.

## Manual recovery procedure

1. Stop the process cleanly if possible.
2. Preserve the current `game.json` and every adjacent backup before changing them.
3. Confirm the intended world package and calculate whether its `world.json` is the one used by the save.
4. Place a compatible snapshot at exactly `GAME_DATA_PATH`.
5. Start the server and inspect structured logs for `incompatible_save_archived` or startup errors.
6. Call `/health`, inspect the lobby, and connect a client to obtain an authoritative baseline.

Do not hand-edit live state while the process is running; a queued snapshot can overwrite the edit, and cross-record invariants are not repaired by the persistence layer.
