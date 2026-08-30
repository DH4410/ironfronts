# Ironfronts Documentation

This handbook documents the current repository and runtime. Implementation-specific claims are tied to source behavior rather than roadmap plans.

## Start here

- [Repository architecture](architecture.md): processes, packages, authority, data flow, and directory map.
- [Development and QA](development.md): local setup, scripts, tests, debug mode, visual/performance tooling.
- [Deployment](deployment.md): build, topology, environment, proxying, persistence, backups, and security.

## Runtime components

- [Auth server](auth-server/README.md): accounts, SQLite sessions, cookies/CORS, public API, game tickets, and operations.
- [Game server](game-server/README.md): authoritative simulation, protocol, persistence, configuration, and troubleshooting.
- [Browser client](client/README.md): bootstrap, auth/lobby flow, WebSocket replica, optimistic UI, controls, audio, and teardown.
- [WebGPU rendering](client/rendering.md): world loading, GPU pipeline, culling, quality presets, diagnostics, and performance.

## Offline pipeline

- [World generator](world-generator/README.md): inputs, deterministic stages, roads/rivers/terrain/props, promotion, and validation.
- [Generated world artifacts](world-generator/artifacts.md): manifest, raster/buffer formats, consumers, and deployment contract.

## Game-server detail

- [Architecture](game-server/architecture.md)
- [Configuration and operations](game-server/operations.md)
- [Protocol v2](game-server/protocol-v2.md)
- [Authoritative simulation](game-server/simulation.md)
- [State, world loading, and persistence](game-server/persistence.md)
- [Validation and troubleshooting](game-server/validation.md)

## Credits and licenses

- [Third-party visual/UI asset credits](ASSET_CREDITS.md)
- [Audio credits and licensing](../AUDIO_CREDITS.md)
- Vendored menu-icon-specific notices also live beside those assets in `public/menu/icons/CREDITS.md`.

Historical branch reviews, merge plans, status notes, and superseded asset-research documents have been removed. Git history remains the place to recover them if needed.
