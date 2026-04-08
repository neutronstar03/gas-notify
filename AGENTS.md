# AGENTS.md

## Project summary

Gas Notify is a Windows-first Ethereum gas monitor.

Current repo shape:
- Bun CLI monitor
- experimental Tauri tray widget

## Basic commands

### Install dependencies

```bash
bun install
```

### CLI flow

```bash
gas-notify init
gas-notify notify
gas-notify
```

### CLI from repo

```bash
bun run start init
bun run start notify
bun run start
```

### Desktop tray app

```bash
bun run desktop:dev
bun run desktop:build
```

### Checks

```bash
bun run lint
bun run check
```

### RPC validation

```bash
bun run validate:rpcs
```

## Important implementation notes

- Prefer `bun run <script>` over invoking tools directly.
- Tauri CLI is pinned via local `@tauri-apps/cli` in `devDependencies`.
- Vite is pinned locally as well.
- Shared browser-safe helpers live in `src/shared/core.ts`.
- The tray experiment currently lives on branch `experiment/tray-app`.
- Tauri sources live in `src-tauri/`.
- Widget frontend files live in `src-app/`.

## Current tray behavior

- left click tray icon: toggle widget visibility
- right click tray icon: show menu
- widget is frameless, transparent, always-on-top
- widget displays recent Ethereum base fee rows

## When editing docs

- Keep README short and practical.
- Put command summaries near the top.
- Prefer shortlists over long prose for quick repo orientation.
