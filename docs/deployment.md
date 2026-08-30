# Deployment

The repository does not currently ship a container, reverse-proxy, or process-manager definition. Deployment consists of a static client/world host plus two long-running Node processes and two persistence locations.

## Components

| Component | Public? | Persistent data |
|---|---|---|
| Static Vite build | Yes | Immutable build only |
| World package/CDN | Yes, readable by browser | Immutable generated package |
| Auth server | Through HTTPS proxy | SQLite database/WAL |
| Game server WebSocket | Through WSS proxy | JSON game snapshot |
| Game internal HTTP | No | Same process as WebSocket |

Both Node services bind to `127.0.0.1`; a reverse proxy or same-host service boundary is required for remote access.

## Build order

```sh
npm ci
npm run build
```

The root build regenerates `public/world`, checks workspace/root TypeScript, and builds the two Vite HTML entries/static copies into `dist`.

For reproducible releases, generate once and deploy the exact same `public/world` bytes to:

- the game server's local `WORLD_DIRECTORY`; and
- the browser-facing `WORLD_PUBLIC_URL`.

Prefer a versioned immutable CDN path. Cross-origin world hosts must allow the client origin to fetch JSON and binary files with CORS.

## Required production configuration

```dotenv
NODE_ENV=production
CLIENT_ORIGIN=https://play.example.com

AUTH_PORT=3001
GAME_INTERNAL_URL=http://127.0.0.1:3002
GAME_PUBLIC_WS_URL=wss://play.example.com/v2/game
SESSION_TTL_SECONDS=86400
AUTH_DATABASE_PATH=/var/lib/ironfronts/auth.sqlite

GAME_PORT=3002
WORLD_DIRECTORY=/srv/ironfronts/world-at-war-2
WORLD_PUBLIC_URL=https://cdn.example.com/world-at-war-2
GAME_DATA_PATH=/var/lib/ironfronts/game.json

TICKET_SECRET=<long random value shared only by both services>
INTERNAL_SERVICE_SECRET=<different long random value shared only by both services>
```

Build the client with `VITE_AUTH_URL` set to the public auth API origin/base. If the auth API is reverse-proxied under the same public origin, that same-origin URL simplifies cookies and CORS.

The Node entrypoints do not themselves load `.env`; inject variables through the supervisor/environment or explicitly start Node with an environment-file mechanism.

## Proxy routing

A typical single-origin layout is:

| Public route | Backend |
|---|---|
| `/`, `/login.html`, compiled assets | Static `dist` |
| `/world/*` or versioned CDN URL | Generated world package |
| `/v1/auth/*`, `/v2/game` HTTP, `/v2/game/join`, `/v2/game/connect` | Auth server |
| WebSocket upgrade `/v2/game` | Game server |

HTTP and WebSocket use the same public path in this example but are distinguished by upgrade handling. Ensure ordinary `GET /v2/game` reaches auth while WebSocket upgrade `/v2/game` reaches the game process.

Do not publish `/internal/v2/*`. Preserve the browser `Origin` header on WebSocket upgrade; the game server requires an exact `CLIENT_ORIGIN` match.

TLS should terminate at the proxy. The auth server marks its cookie Secure only in production, so players must use HTTPS.

## Startup and readiness

Recommended order:

1. Deploy immutable static/world assets.
2. Mount writable persistence paths with correct ownership.
3. Start game server and wait for `GET /health` success.
4. Start auth server and wait for its `GET /health` success.
5. Enable proxy traffic/static release.

The auth health endpoint does not probe the game server; perform both checks. The game health endpoint is not a deep filesystem/timer check, so monitoring may additionally establish a baseline and observe advancing `simulationTick`.

## Persistence and backups

Back up:

- auth SQLite database consistently with WAL state or SQLite online backup;
- game `game.json` and adjacent compatibility archives;
- deployed world package associated with each recoverable game snapshot;
- release configuration/secrets through a secure secret-management system.

A game snapshot is compatible only with its game/save versions and the `world.json` hash. Keep the matching server build and whole world package for reliable rollback.

The game server saves every five seconds, after successful commands, after country claims, and at graceful shutdown. Command acknowledgement does not synchronously guarantee disk durability. The auth store commits directly through SQLite.

## Rolling updates and downtime

There is one authoritative game process and no clustering/leader election. Stop accepting upgrades, terminate it gracefully, wait for exit/final save, deploy, and restart. Simulation/cooldowns pause while offline; there is no catch-up.

Protocol/game/world compatibility changes may intentionally archive the old snapshot and create a fresh world. Announce/reset seats accordingly. Ordinary client releases should remain compatible with the active protocol or be deployed together with services.

The auth service is also single-instance with an in-memory rate limiter, though SQLite persists accounts/sessions. Multiple instances would need deliberate shared-database and distributed-rate-limit design.

## Security checklist

- Unique, high-entropy production secrets; never expose them to Vite/browser variables.
- Exact `CLIENT_ORIGIN` and restrictive proxy routes.
- HTTPS/WSS with Secure cookies.
- Private internal game API.
- Persistence paths readable only by service users/operators.
- Static/CDN CORS restricted as operationally appropriate.
- Request/body/proxy size limits compatible with server limits (16 KiB auth JSON, 32 KiB game internal/WebSocket).
- Log collection without leaking cookies, tickets, passwords, or secrets.
- Backups tested through restore, including matching world artifacts.

## Current operational limitations

- No horizontal scaling, high availability, or distributed coordination.
- No metrics endpoint or tracing; health and JSON logs are the primary signals.
- No automated database/schema migration framework beyond create-if-missing auth tables and game incompatibility archive/reset.
- No supplied container/service/proxy manifests.
- Non-graceful failure may lose recent unpersisted simulation progress.
