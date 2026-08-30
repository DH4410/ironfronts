# Protocol v2

The game-facing protocol is defined in `packages/protocol/src/index.ts`. Client messages are runtime-validated with Zod. Server message types are shared TypeScript contracts and also have a schema for consumers that want runtime validation.

Constants:

```text
PROTOCOL_VERSION = 2
GAME_ID          = world-at-war-2
GAME_VERSION     = world-at-war@2
```

All bodies and frames use UTF-8 JSON.

## Internal HTTP API

The server exposes internal endpoints on the same loopback listener as the gameplay WebSocket. Every `/internal/v2/*` request must include:

```http
Authorization: Bearer <INTERNAL_SERVICE_SECRET>
```

Responses include `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`.

### `GET /health`

Unauthenticated liveness response:

```json
{ "ok": true, "service": "game-server", "gameId": "world-at-war-2", "revision": 0 }
```

### `GET /internal/v2/lobby`

Optional query parameter: `accountId`. Supplying it allows `assignedCountryId` to reflect an existing seat.

Response fields:

```ts
interface GameLobby {
  gameId: string;
  name: string;
  gameVersion: string;
  protocolVersion: 2;
  assignedCountryId: number | null;
  countries: Array<{
    id: number;
    name: string;
    color: string;
    startingCities: number;
    alive: boolean;
    claimed: boolean;
  }>;
}
```

`alive` means the country currently owns at least one province. `claimed` means a permanent account seat exists. `startingCities` is the current count of urban provinces owned when the lobby is built despite the historical field name.

### `POST /internal/v2/join`

Body:

```json
{ "accountId": "account-id", "countryId": 44 }
```

Success is HTTP `200`:

```json
{ "ok": true, "countryId": 44 }
```

Rule conflicts return HTTP `409` with `{ "ok": false, "reason": "..." }`. A join is rejected if the account already has another permanent assignment, the country is ineligible, the country owns no territory, or another account claimed it. Repeating the same account/country pairing succeeds idempotently. A successful new claim changes the country controller to `player` and is persisted before the response completes.

Malformed required fields return `400`. Missing/invalid bearer credentials return `401`; unknown paths return `404`. Unexpected parsing or runtime failures return `500` with an error string. Request bodies above 32 KiB fail.

## Gameplay WebSocket

Upgrade path: `/v2/game`

The HTTP upgrade is accepted only when:

- the URL path is exactly `/v2/game`; and
- the `Origin` header exactly equals `CLIENT_ORIGIN`.

Rejected upgrades receive HTTP `403`. Accepted connections have a 32 KiB maximum message payload.

### Authentication sequence

The first message must arrive within five seconds and be:

```json
{
  "type": "authenticate",
  "protocolVersion": 2,
  "ticket": "base64url-payload.base64url-hmac"
}
```

The ticket is an HMAC-SHA256 signed JSON claims object:

```ts
interface GameTicketClaims {
  accountId: string;
  gameId: string;
  countryId: number;
  audience: 'game-server';
  protocolVersion: 2;
  expiresAt: number; // epoch milliseconds
  nonce: string;
}
```

The server verifies signature, audience, version, expiry, game ID, single-use nonce, and the authoritative account seat. Authentication timeout sends `authentication_required`, then closes with code `4401`. A connection cannot authenticate twice.

On success, the server sends `hello`, then a full `baseline`.

### `hello`

```json
{
  "type": "hello",
  "gameId": "world-at-war-2",
  "gameVersion": "world-at-war@2",
  "protocolVersion": 2,
  "capabilities": [
    "filtered-baseline",
    "change-only-deltas",
    "resync",
    "optimistic-commands",
    "sparse-clock-sync"
  ],
  "world": {
    "version": "...",
    "hash": "sha256-of-world-json",
    "assetBaseUrl": "https://.../world"
  },
  "countryId": 44
}
```

The client should verify that it supports the versions and loads the exact described world package. The server uses its own local copy; `assetBaseUrl` is only a browser/CDN descriptor.

### `baseline`

```ts
{
  type: 'baseline';
  revision: number;
  state: PlayerProjection;
  catalogs: { units: object[]; buildings: object[] };
  clock: GameClockSync;
}
```

A baseline replaces the complete client replica. It contains the current fog-filtered state, presentation catalogs, and a civil-clock sample. It is sent after authentication and on every valid `resync` request.

### `delta`

```ts
{
  type: 'delta';
  fromRevision: number;
  revision: number;
  delta: {
    changed: object;
    upserts: Record<string, Record<string, unknown>>;
    removals: Record<string, string[]>;
    redactions: string[];
  };
  events: FilteredEvent[];
}
```

`changed` replaces scalar/top-level values. `upserts` replaces individual records in named collections. `removals` deletes records. `redactions` explicitly calls out removed `armies.<id>` or `resourceNodes.<id>` caused by loss of visibility; it is informational because the corresponding removal remains authoritative.

Apply a delta only when its `fromRevision` equals the replica's current revision. Otherwise request a resync. Revisions advance for publication changes and reset when the process restarts; never compare revisions across connections or process lifetimes.

### `clockSync`

```ts
interface GameClockSync {
  gameStartedAtEpochMs: number;
  serverEpochMs: number;
  utcOffsetMinutes: number; // currently +120
}
```

Sent every 60 seconds independently of simulation and projection updates. It is intended for local interpolation/correction of the game's civil display, not combat cooldown calculation. Gameplay cooldowns use `simulationTick`.

### Resync request

```json
{ "type": "resync", "afterRevision": 41 }
```

`afterRevision` is optional and presently advisory; the server always responds with a current full baseline.

## Commands

Envelope:

```json
{
  "type": "command",
  "commandId": "client-generated-id",
  "command": { "type": "stopArmy", "armyId": "army-12" }
}
```

`commandId` must contain 1–100 characters. The server remembers the latest 256 acknowledgements per account for the process lifetime. Repeating an ID returns the cached acknowledgement without executing the command again. IDs are not persisted; clients should not reuse them after reconnect/restart.

The acknowledgement is:

```ts
{
  type: 'commandAck';
  commandId: string;
  ok: boolean;
  reason?: string;
  requiredWarCountryIds?: number[];
}
```

An `ok` acknowledgement confirms authoritative acceptance, not that movement, construction, or combat has completed.

### `moveArmy`

```json
{
  "type": "moveArmy",
  "armyId": "army-12",
  "x": 7400,
  "z": 2100,
  "confirmedWarCountryIds": [51]
}
```

Targets a world position/nearest reachable land graph node. The coordinate must be inside world bounds. Neutral territory is not traversable until every required declaration is confirmed; see [War confirmation](#war-confirmation).

### `attackArmy`

Province target:

```json
{
  "type": "attackArmy",
  "armyId": "army-12",
  "target": { "kind": "province", "provinceId": 123 },
  "confirmedWarCountryIds": [51]
}
```

Army target:

```json
{
  "type": "attackArmy",
  "armyId": "army-12",
  "target": { "kind": "army", "armyId": "army-88" }
}
```

Mixed/non-artillery-only forces aggressively move toward a province center or detected army. Army pursuit updates while the target remains detected and otherwise continues to its last known position. Artillery-only armies cannot attack provinces or chase; an army target sets a manual bombardment target only when the firing army is stationary and the detected target is currently in range.

### `retreatArmy`

```json
{ "type": "retreatArmy", "armyId": "army-12", "firstNodeId": 987 }
```

Valid only in close combat. `firstNodeId` must match one of that army's currently projected `legalRetreatExits`. The server recalculates legality at execution time.

### `splitArmy`

```json
{
  "type": "splitArmy",
  "armyId": "army-12",
  "groups": [
    { "typeId": "infantry", "count": 3 },
    { "typeId": "artillery", "count": 1 }
  ],
  "x": 7600,
  "z": 2050,
  "confirmedWarCountryIds": []
}
```

Creates and routes a detachment atomically. Counts are combined by type and zero entries are ignored. Both parent and child must retain at least one unit. Pooled HP transfers proportionally. The parent may be idle, moving, or extracting, but not engaged or retreating. Invalid routing leaves the parent unchanged and creates no detachment.

### `stopArmy`

```json
{ "type": "stopArmy", "armyId": "army-12" }
```

Clears movement/extraction and leaves the army idle. Rejected during close combat or retreat.

### `extract`

```json
{ "type": "extract", "armyId": "army-12" }
```

Starts extraction at the current graph node. The army must be stationary, capable of extraction, not engaged/retreating, and standing on a controlled non-exhausted deposit access node.

### `produce`

```json
{ "type": "produce", "provinceId": 123, "unitTypeId": "infantry" }
```

Queues a unit in an owned province with its required building and enough stockpile. Cost is paid on acceptance.

### `build`

```json
{ "type": "build", "provinceId": 123, "buildingId": "barracks" }
```

`buildingId` is one of `barracks`, `tankPlant`, or `ordnance`. The province must be owned and urban, the building must not already exist/be queued, and resources are paid on acceptance.

### `setRally`

Set:

```json
{
  "type": "setRally",
  "provinceId": 123,
  "target": { "x": 7600, "z": 2050 }
}
```

Clear:

```json
{ "type": "setRally", "provinceId": 123, "target": null }
```

Only province ownership is validated when the command is accepted. Completed units attempt to move toward the stored point when eligible.

## War confirmation

Movement and attack order creation are two-phase and atomic:

1. Submit the desired order without confirmations.
2. If peaceful countries block the target or route, the acknowledgement returns `ok: false`, reason `War declaration required.`, and a sorted `requiredWarCountryIds` list.
3. Ask the player for confirmation and resubmit the same logical command with all listed IDs.
4. The server recalculates the route and relations. It may return a different required list if ownership changed.
5. Only after all current requirements are confirmed does the server declare the wars and install the order.

Confirmation is not a standalone declaration command and does nothing when the order itself cannot be committed.

## Projection shape and privacy

`PlayerProjection` contains:

- `simulationTick`, viewer country, and start camera;
- public countries, province ownership, and diplomatic relations;
- private buildings, production/construction queues, and rally points only for owned provinces;
- own economy only in `ownCountry`;
- fog-filtered armies and resource nodes.

Own armies include composition, orders, suspended orders, exact battle summaries, legal retreat exits, and artillery state. Fully visible foreign armies expose composition/current status but not private orders or targets. Contact-only foreign armies expose a generic identity, position, and owner with `composition: null` and `status: "unknown"`. Hidden armies are absent.

The complete top-level shape is:

```ts
interface PlayerProjection {
  simulationTick: number;
  viewerCountryId: number;
  startCamera: { x: number; z: number; distance: number };
  countries: Record<number, PublicCountry>;
  provinceOwners: Record<number, number>;
  provinceBuildings: Record<number, { barracks: number; tankPlant: number; ordnance: number }>;
  productionQueues: Record<number, unknown[]>;
  constructionQueues: Record<number, unknown[]>;
  rallyPoints: Record<number, { x: number; z: number }>;
  armies: Record<string, ProjectedArmy>;
  resourceNodes: Record<number, unknown>;
  ownCountry: Record<string, unknown> | null;
  relations: Record<string, 'peace' | 'war'>;
}
```

Projected army extensions relevant to gameplay are:

```ts
interface ProjectedArmy {
  id: string;
  name: string;
  ownerCountryId: number;
  ownerName: string;
  ownerColor: string;
  x: number;
  z: number;
  own: boolean;
  contact: 'contact' | 'visible';
  status: string;
  composition: null | {
    unitCount: number;
    health: number;
    speed: number;
    groups: Array<{ typeId: string; count: number; health: number }>;
  };
  moveOrder: { x: number; z: number } | null;
  suspendedOrder?: { x: number; z: number; intent: 'move' | 'attack' } | null;
  battleFronts?: Array<{
    id: string;
    directionNodeId: number;
    role: 'attack' | 'defense';
    friendlyHp: number;
    friendlyBaselineHp: number;
    enemyHp: number;
    enemyBaselineHp: number;
    friendlyNextVolleyTick: number;
    enemyNextVolleyTick: number;
    reinforcementCount: number;
  }>;
  legalRetreatExits?: Array<{
    firstNodeId: number;
    destinationProvinceId: number;
    x: number;
    z: number;
  }>;
  artillery?: null | {
    range: number;
    targetArmyId: string | null;
    manualTarget: boolean;
    nextVolleyTick: number;
  };
}
```

Group `health` and aggregate army `health` are fractions from `0` through `1`. Cooldown fields are absolute simulation ticks; remaining real seconds at 10 Hz are `max(0, nextVolleyTick - simulationTick) / 10`.

## Filtered events

Events are attached to delta messages and share `{ id, kind, ...fields }`. Current kinds are:

| Kind | Visibility | Fields beyond `id`/`kind` |
|---|---|---|
| `unitCompleted` | Owning country | `unitTypeId`, `provinceId` |
| `buildingCompleted` | Owning country | `buildingId`, `provinceId` |
| `capture` | All connected countries | `provinceId`, `fromCountryId`, `toCountryId` |
| `engaged` | Named combat countries | `attacker`, `defender`, `battleId`, `frontId` |
| `reinforced` | Named combat countries | `attacker`, `defender`, `battleId`, `frontId`, `armyId` |
| `volley` | Named combat countries | `attacker`, `defender`, `battleId`, `frontId` |
| `retreat` | Named combat countries | `attacker`, `defender` |
| `destroyed` | Named combat countries | `attacker`, `defender`, `armyId` |
| `bombardment` | Named combat countries | `attacker`, `defender`, `armyId`, `targetArmyId` |
| `battleEnded` | Named combat countries | `attacker`, `defender`, `battleId`, `frontId` |

Events are best-effort and process-local, not a durable stream. A baseline/delta state—not event replay—is the source of truth after reconnect.

## Errors

Malformed JSON, schema rejection, failed authentication checks, and unexpected message-handler exceptions produce:

```json
{ "type": "error", "code": "invalid_message", "message": "..." }
```

Sending any non-authentication message before authentication is also invalid. Domain-level command rejection is normally a `commandAck` with `ok: false`, not an `error` frame.
