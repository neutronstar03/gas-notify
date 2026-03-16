# Gas Notify

Windows-first Bun notifier for Ethereum `baseFeePerGas` threshold crossings.

## Features

- primary WebSocket listening with `eth_subscribe` on `newHeads`
- HTTP polling fallback when all configured WebSocket RPCs fail
- stateful threshold crossing logic with cooldown and optional hysteresis
- native Windows toast notifications through `SnoreToast.exe`
- simple JSON config, persistent state, file logging, and startup helpers
- RPC validation script for user-supplied and DefiLlama-sourced candidates

## Requirements

- Windows user session
- Bun `1.3+`
- PowerShell for helper scripts
- a local `SnoreToast.exe` copy in `vendor/SnoreToast.exe` or another configured path

## Setup

```bash
bun install
```

The tracked `config/config.json` is intentionally minimal. Use `config/example.config.json` as a fuller reference, or keep your own overrides in a file like `config/dev.local.json` and launch with `GAS_NOTIFY_CONFIG`.

`config/config.json` and `config/example.config.json` both point at `config/config.schema.json`, so editors with JSON Schema support should give you autocomplete and validation.

Threshold hysteresis defaults to `5%` of the threshold value, so you usually do not need to specify it. You can still override it with either `hysteresisPercent` or `hysteresisGwei`.

Provision SnoreToast:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\provision-snoretoast.ps1
```

If the script cannot auto-download a binary, place `SnoreToast.exe` manually in `vendor\SnoreToast.exe`. Upstream currently publishes source archives more reliably than a direct Windows binary asset.

## Configuration

Edit `config/config.json`.

Single-threshold mode is supported with `thresholdGwei`, but the default example uses multiple named thresholds because it is more useful for desktop monitoring.

Important keys:

- `thresholds`: array of named thresholds with `gwei`, `direction`, optional `hysteresisPercent` or `hysteresisGwei`, `cooldownSeconds`, and `message`
- `preferredRpcs`: WebSocket endpoints used for primary listening
- `fallbackRpcs`: HTTP endpoints used for polling fallback
- `silentNotifications`: pass `-silent` to SnoreToast
- `stateFilePath`: stores last threshold positions and last notification times
- `logFilePath`: optional rolling append-only log file location

Environment overrides are supported for the main top-level settings, including:

- `GAS_NOTIFY_CONFIG`
- `GAS_NOTIFY_THRESHOLD_GWEI`
- `GAS_NOTIFY_DIRECTION`
- `GAS_NOTIFY_COOLDOWN_SECONDS`
- `GAS_NOTIFY_HTTP_POLL_INTERVAL_MS`
- `GAS_NOTIFY_SNORETOAST_PATH`

## Run

```bash
bun run start
```

Development watch mode:

```bash
bun run dev
```

## Validate RPCs

The validator checks:

- WebSocket connect
- `eth_subscribe` support on `newHeads`
- block fetch success
- presence of `baseFeePerGas`

Run with built-in DefiLlama candidates and optional extra URLs:

```bash
bun run validate:rpcs
GAS_NOTIFY_RPC_LIST="wss://ethereum-rpc.publicnode.com,https://ethereum-rpc.publicnode.com" bun run validate:rpcs
```

Skip DefiLlama candidate ingestion:

```bash
bun run validate:rpcs --skip-defillama
```

## Startup on Login

Create a scheduled task and startup shortcut:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 -Mode Both
```

Modes:

- `TaskScheduler`
- `StartupShortcut`
- `Both`

## Logging and State

- console logs are always enabled and timestamped
- file logging is enabled when `logFilePath` is set
- state is written to `data/state.json` by default
- if SnoreToast is missing or fails, the app logs the notification attempt and keeps running

## Troubleshooting

- if WebSocket providers flap, confirm the validator still reports them in `ws_confirmed`
- if no toast appears, verify `vendor/SnoreToast.exe` exists and launch the app inside your user session
- if only polling works, keep HTTP endpoints configured and let the app retry WebSocket automatically
- if startup registration fails, run PowerShell as the same desktop user that should receive toasts
