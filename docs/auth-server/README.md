# Auth Server

The auth server is a loopback-bound Node.js HTTP service. It owns credentials and browser sessions, presents the public lobby API, coordinates permanent country claims with the game server, and issues short-lived gameplay tickets. It does not run simulation or store country assignments itself.

## Start and configuration

```sh
npm run auth:dev
```

| Variable | Default | Meaning |
|---|---|---|
| `AUTH_PORT` | `3001` | Positive listener port. The process binds `127.0.0.1`. |
| `CLIENT_ORIGIN` | `http://127.0.0.1:5173` | Exact allowed browser origin for CORS and unsafe methods. |
| `GAME_INTERNAL_URL` | `http://127.0.0.1:3002` | Private game-server HTTP base URL. |
| `GAME_PUBLIC_WS_URL` | `ws://127.0.0.1:3002/v2/game` | Browser-visible gameplay WebSocket URL returned by connect. |
| `SESSION_TTL_SECONDS` | `86400` | Positive browser-session lifetime in seconds. |
| `AUTH_DATABASE_PATH` | `${DATA_DIRECTORY}/auth.sqlite` | SQLite path, resolved from the process working directory. |
| `DATA_DIRECTORY` | `data` | Shared default persistence directory. |
| `TICKET_SECRET` | insecure local fallback | HMAC ticket secret shared with the game server. Must be changed in production. |
| `INTERNAL_SERVICE_SECRET` | insecure local fallback | Bearer secret shared with the game server. Must be changed in production. |
| `NODE_ENV` | unset | `production` enables secure cookies and rejects fallback secrets. |

The database directory is created before opening SQLite. Start from the repository root or use an absolute database path.

## Browser session model

The cookie is named `ironfronts_session` and has:

- `HttpOnly`
- `Path=/`
- `SameSite=Lax`
- `Max-Age=<SESSION_TTL_SECONDS>`
- `Secure` only when `NODE_ENV=production`

The random 32-byte session token is returned only in the cookie. SQLite stores its SHA-256 hash, account ID, creation epoch, and expiry epoch. Logout deletes the hashed token and expires the cookie. Expired sessions are removed when read and by the minute cleanup timer.

The browser client must use `credentials: include`; the included client API does so for every request.

## Accounts and passwords

Usernames are trimmed and normalized with `toLocaleLowerCase('en-US')`. Accepted display usernames contain 3–32 Unicode letters/numbers plus underscore, space, period, or hyphen. Normalized usernames are unique.

Passwords contain 8–256 characters. Each account receives a random 16-byte salt and a 64-byte Node `scrypt` hash. Authentication uses a timing-safe comparison. Unknown-account authentication still performs a dummy scrypt operation to reduce username timing leakage.

SQLite uses strict tables, foreign keys, a five-second busy timeout, WAL journaling, and `synchronous = FULL` for file-backed databases. Deleting an account cascades to sessions, though no account-deletion endpoint currently exists.

## HTTP conventions

All responses are JSON with `Cache-Control: no-store`. Browser responses include:

```http
Access-Control-Allow-Origin: <CLIENT_ORIGIN>
Access-Control-Allow-Credentials: true
Vary: Origin
```

`OPTIONS` accepts only the configured exact origin and advertises `GET, POST, OPTIONS` plus the `content-type` header. Non-GET/HEAD requests also require the exact `Origin`. GET/HEAD requests are allowed without an Origin so health checks and service tooling work.

JSON request bodies are limited to 16 KiB. Unhandled validation/service errors are returned as `{ "error": "..." }`; messages containing `already`, `permanently`, or `claimed` map to HTTP 409, while other caught errors currently map to HTTP 400.

## Public API

### `GET /health`

No authentication required.

```json
{ "ok": true, "service": "auth-server" }
```

### `POST /v1/auth/register`

Body:

```json
{ "username": "Commander", "password": "at-least-eight" }
```

Creates an account, creates a browser session, sets the cookie, and returns HTTP 201 with a session response. Duplicate normalized usernames return 409.

### `POST /v1/auth/login`

Uses the same body. On success returns HTTP 200, sets a fresh session cookie, and returns a session response. Invalid credentials return 401 with a generic error.

Both registration and login are rate-limited independently by remote socket address and endpoint: 20 attempts in a fixed 15-minute window. Limits are in-memory and process-local. The implementation does not interpret proxy forwarding headers, so configure the network boundary deliberately.

### `POST /v1/auth/logout`

Revokes the current token if present and expires the cookie. The endpoint is idempotent and returns:

```json
{ "ok": true }
```

### `GET /v1/auth/session`

Unauthenticated:

```json
{ "authenticated": false }
```

Authenticated:

```json
{
  "authenticated": true,
  "account": { "id": "...", "username": "Commander" },
  "assignment": { "gameId": "world-at-war-2", "countryId": 44 }
}
```

`assignment` is `null` before the account claims a country. The auth server asks the game server on every authenticated session response; it does not cache assignments.

### `GET /v2/game`

Requires an authenticated browser session. Proxies the current game lobby, including playable countries, alive/claimed state, and the caller's permanent assignment.

### `POST /v2/game/join`

Requires authentication. Body:

```json
{ "countryId": 44 }
```

The auth server forwards `{ accountId, countryId }` to the game server. Success returns:

```json
{ "assignment": { "gameId": "world-at-war-2", "countryId": 44 } }
```

The game server is authoritative for eligibility, existing assignments, claims, and persistence.

### `POST /v2/game/connect`

Requires authentication and an existing assignment. The body may be `{}`. Success returns:

```json
{
  "ticket": "<signed single-use token>",
  "websocketUrl": "ws://127.0.0.1:3002/v2/game",
  "protocolVersion": 2
}
```

The ticket expires 30 seconds after issue and includes a random nonce, account ID, game/country assignment, `game-server` audience, and protocol version. It is signed with HMAC-SHA256. The game server validates the seat and consumes the nonce; the auth server never sends its session cookie to the game server.

## Game-server dependency

Internal calls add JSON content type and:

```http
Authorization: Bearer <INTERNAL_SERVICE_SECRET>
```

They use a five-second timeout. The game server should be running before players request sessions/lobbies; an unavailable game server makes assignment-dependent auth responses fail.

## Persistence and backup

Back up the SQLite database and its WAL state consistently. The simplest safe procedure is to stop the auth service and copy `auth.sqlite` plus any adjacent `-wal`/`-shm` files, or use SQLite's online backup facilities. Copying only the main database during active WAL writes is not a complete backup strategy.

Country seats are not in this database. A full player recovery/reset must consider both the auth database and the game server snapshot.

## Operations and security

- Keep the listener behind a reverse proxy or trusted same-host boundary; it binds loopback only.
- Terminate HTTPS at the proxy in production so Secure cookies can be used.
- Use independent high-entropy ticket and internal-service secrets.
- Keep `CLIENT_ORIGIN` exact, including scheme and port.
- Do not expose the game server's `/internal/v2/*` routes through the public proxy.
- Treat structured logs as operational metadata; current events include `listening`, `registered`, `logged_in`, `request_failed`, and `shutdown`.
- `SIGINT`/`SIGTERM` stop cleanup, close the HTTP server, close SQLite, and exit. A five-second hard timeout exits with failure.

## Current limitations

- No email verification, password reset, MFA, account deletion, or session-list UI.
- No distributed rate limiter or trusted-proxy IP extraction.
- No CSRF token; unsafe requests rely on exact Origin validation plus SameSite cookies.
- Session and API version remain v1 while game/lobby endpoints are v2.
- A game-server outage is surfaced through the generic caught-error response rather than a distinct 502/503 class.
