# State, world loading, and persistence

`GAME_DATA_PATH` stores an atomically replaced JSON envelope with format version 2 and runtime version 2. The contained `GameState` is version 3. It includes the authoritative epoch, elapsed game hours, fractional fixed-step remainder, simulation tick, gameplay records, permanent account seats, and ID counters. Sockets, transport revisions, command deduplication, and presentation event backlogs are process-local.

The server serializes writes, writes a same-directory temporary file with restrictive permissions, then renames it over the destination. It snapshots after creation, country claims, accepted commands, every five seconds, and graceful shutdown. A crash can lose work since the last completed snapshot.

State version 2 is migrated once: prototype game/work hours are divided by 1800 and income rates are converted to the real-time scale. Missing v3 runtime fields receive deterministic defaults. The restore path then validates world and graph cross-references. Invalid nested data fails startup rather than being partially accepted.

Compatibility requires the current game ID, game version, envelope/runtime versions, and world identity. The current world identity is SHA-256 over a sorted map of SHA-256 hashes for `world.json`, province details, owners, province IDs, surface, height, and movement connections. The loader checks that the manifest refers to those identified canonical files. The browser receives the same map, verifies its aggregate identity, and verifies each gameplay artifact when downloaded.

The raw-manifest hash is accepted only to migrate a compatible v2 save. Other incompatible saves are moved to the adjacent timestamped backup path before a fresh game is created. Restore rebuilds immutable world lookups and graph caches, recomputes income, and validates seat uniqueness. Process downtime does not advance the game.

For manual recovery, stop the process, preserve the save and adjacent backups, deploy the matching complete world package, put the compatible snapshot at `GAME_DATA_PATH`, restart, and inspect structured startup logs and `/health`. Never edit a live save while queued snapshots can overwrite it.
