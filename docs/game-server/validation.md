# Validation and Troubleshooting

## Validation commands

Game-server workspace type check:

```sh
npm run check --workspace @ironfronts/game-server
```

Shared protocol and game-core checks:

```sh
npm run check --workspace @ironfronts/protocol
npm run check --workspace @ironfronts/game-core
```

Repository-wide validation:

```sh
npm run check
```

The root command runs workspace TypeScript checks, the root strict/no-unused TypeScript check, script linting, architecture tests, and Vitest. The root `pretest`/test workflow builds the world first and can be substantially heavier than a workspace-only type check.

Server-focused coverage currently lives in:

- `tests/server/game-runtime.test.ts`: seats, lobby, projections, delta behavior, snapshot save/restore.
- `tests/server/ticket-protocol.test.ts`: ticket signing/verification, nonce replay, and v2 command schemas.
- `tests/client/game-clock.test.ts`: shared server timing and clock constants.
- `tests/game/*`: authoritative state, commands, movement, visibility, combat, retreat, capture, production, construction, resources, and scenario initialization.
- `tests/architecture.test.ts`: dependency and ownership boundaries.

## Important invariants

When changing the server, preserve these properties:

- The authenticated seat supplies command country identity.
- Every army/province mutation passes an authoritative ownership check.
- `GameState` remains JSON-serializable plain data.
- A player projection never contains another country's private economy, queues, orders, hidden armies, or hidden resource nodes.
- Projection deltas are calculated from the exact last projection stored for that connection.
- Save operations remain serialized and use same-directory atomic rename.
- World/save compatibility is checked before restore.
- Simulation systems retain deterministic ordering.
- All due close-combat damage is computed before any due damage is applied.
- Friendly/peaceful overlap does not merge armies, start a battle, or declare war.
- Order confirmation and all required war declarations commit atomically.
- A split either creates and routes the complete detachment or changes nothing.

## Common startup failures

### Secret required in production

Symptom: startup throws that `TICKET_SECRET` or `INTERNAL_SERVICE_SECRET` is required.

Cause: `NODE_ENV=production` with the built-in local fallback.

Resolution: configure independent shared secrets. Ensure ticket issuer/caller configuration matches.

### Missing world file

Symptom: `ENOENT` for `world.json`, a sidecar, or binary field.

Cause: wrong working directory/`WORLD_DIRECTORY`, or incomplete world deployment.

Resolution: generate or deploy the whole package, then use an absolute `WORLD_DIRECTORY` when process working directory is uncertain.

### Incompatible save archived

Symptom: `incompatible_save_archived` warning followed by a fresh lobby/seat reset.

Cause: version/game/world hash mismatch.

Resolution: this is expected for an intentional v2/world reset. Otherwise stop the process, verify deployed artifacts and compatibility constants, then restore the archived file with its matching server/world version.

### Persisted country assignments are invalid

Symptom: runtime construction fails before listening.

Cause: duplicate country claims, empty account IDs, or country IDs absent from restored state.

Resolution: restore a known-good snapshot. Treat manual JSON repair as a last resort and preserve the original.

### Address already in use

Symptom: listen error on port 3002 (or configured port).

Cause: another process owns the port.

Resolution: stop the stale process or set a different `GAME_PORT`, then update the trusted caller/proxy.

## Common connection failures

### Upgrade returns 403

Check both the exact path `/v2/game` and the exact `Origin` versus `CLIENT_ORIGIN`. Scheme, host, port, and trailing form matter.

### Authentication required / socket closes 4401

The connection did not authenticate within five seconds. Obtain a fresh ticket and send `authenticate` immediately after open.

### Invalid ticket, expired ticket, or reused ticket

Check shared secret, audience, protocol `2`, game ID, expiry in epoch milliseconds, nonce uniqueness, and whether the account still maps to the claimed authoritative seat. Tickets are intentionally single-use within a process.

### Client replica revision gap

Send `{ "type": "resync", "afterRevision": <local revision> }` and replace the replica with the returned baseline. Do not try to apply a delta whose `fromRevision` differs.

### Command asks for war declaration

Use `requiredWarCountryIds` from the rejection to show confirmation, then resubmit with those IDs in `confirmedWarCountryIds`. Do not assume the second attempt must succeed: ownership/routes are revalidated and the required list can change.

## Runtime diagnostics

Useful read-only checks:

- `GET /health` for listener/runtime liveness and current transport revision.
- `GET /internal/v2/lobby?accountId=...` with service credentials for seat/liveness state.
- A fresh authenticated baseline for the exact per-country authoritative projection.
- Structured logs for save failures and incompatible archive paths.
- File timestamps/sizes for `game.json`, `.tmp`, and adjacent `.v1-backup-*` files.

If simulation appears frozen while health responds, compare `simulationTick` across two baselines/deltas. The civil clock can continue to display interpolated wall time independently and is not proof that simulation ticks are executing.

## Adding or changing a command

1. Define and validate its client payload in `packages/protocol/src/index.ts`.
2. Define the country-stamped domain command in `src/game/commands/types.ts`.
3. Put complex validation/mutation in a focused `src/game/commands/*` module.
4. Add only ownership gating/dispatch to `src/game/commands.ts`.
5. Adapt the protocol payload in `GameRuntime.command` without accepting client country identity.
6. Project any required authoritative result without leaking unrelated state.
7. Update [Protocol v2](protocol-v2.md), relevant simulation documentation, and focused coverage.

## Adding a simulation system

Keep its state plain, make the tick ordering explicit in `GameSession`, and decide deliberately:

- which clock drives it;
- how it persists/restarts;
- what is private/public/contact-visible;
- whether it emits durable state, transient events, or both;
- how commands are validated atomically;
- which deterministic tie-breakers it uses;
- what happens when ownership or diplomacy changes mid-action.
