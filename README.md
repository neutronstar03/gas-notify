# Gas Notify

Windows-first Bun CLI for Ethereum `baseFeePerGas` threshold notifications.

## Status

- local Bun CLI with `gas-notify`, `gas-notify init`, and `gas-notify notify`
- WebSocket-first monitoring with HTTP fallback
- native Windows toasts via `toasted-notifier`
- user-local runtime files under `~/.local/share/gas-notify`
- linted with ESLint and checked with TypeScript

## Commands

```bash
gas-notify
gas-notify init
gas-notify notify
```

- `gas-notify`: run the monitor
- `gas-notify init`: create default config and schema in the user-local app directory
- `gas-notify notify`: send a demo toast to verify native toast support

## Local Linking

This project is aimed at local personal use.

Register the CLI locally:

```bash
bun install
bun link
```

Then use it from anywhere:

```bash
gas-notify init
gas-notify notify
gas-notify
```

## Where Files Live

By default, runtime files live in `~/.local/share/gas-notify`.

- config: `~/.local/share/gas-notify/config.json`
- schema: `~/.local/share/gas-notify/config.schema.json`
- state: `~/.local/share/gas-notify/state.json`
- logs: `~/.local/share/gas-notify/logs/gas-notify.log`
- You can override the root with `GAS_NOTIFY_HOME`, or override the config file directly with `GAS_NOTIFY_CONFIG`.

## Notifications

Notifications use `toasted-notifier` for the visible Windows toast.

There is no separate install step for a notification helper binary.

The project bundles `assets/notification-ping.mp3` and plays it separately by default, since toast sound behavior is more reliable this way.
It also bundles `assets/ethereum-icon.png` and uses it as the Windows toast icon by default.

## Init Behavior

`gas-notify init` creates a default config with:

- one default threshold
- Ethereum mainnet WS and HTTP RPC defaults
- a schema file next to the generated config

Default threshold:

```json
{
  "name": "default",
  "gwei": 0.06,
  "direction": "below",
  "message": "Transact on mainnet is now cheap"
}
```

Hysteresis defaults to `5%` of the threshold value, so you usually do not need to specify it.

Notifications are silent by default. Set `"silentNotifications": false` in `config.json` if you want the default Windows toast sound instead.
The bundled custom sound is controlled separately and defaults to enabled via `"playNotificationSound": true`.

## Config Notes

- use `thresholds[]` for normal operation; `thresholdGwei` still works as shorthand
- `hysteresisGwei` overrides percentage-based hysteresis when both could apply
- `state.json` stores runtime threshold state only; it does not duplicate threshold definitions from config
- the persisted state key is `thresholdState`

Repo reference files are available in `config/example.config.json` and `config/config.schema.json`.

## Run From Repo

If you do not want to link the CLI yet:

```bash
bun run start init
bun run start notify
bun run start
```

## Validate RPCs

```bash
bun run validate:rpcs
bun run validate:rpcs --skip-defillama
```

RPC discovery in this project also builds on [DefiLlama chainlist](https://github.com/DefiLlama/chainlist) data. Huge thanks to the DefiLlama team for the quality and usefulness of their public infra work.

Optional extra RPCs:

```bash
GAS_NOTIFY_RPC_LIST="wss://ethereum-rpc.publicnode.com,https://ethereum-rpc.publicnode.com" bun run validate:rpcs
```

## Development

```bash
bun run lint
bun run check
```

## Chrome Extension Experiment

There is also an unpacked-extension experiment on branch `experiment/chrome-extension`.

Current interaction model:

- click the extension action icon to toggle a sticky gas overlay on the current page
- click again to hide it
- the overlay is meant for quick glances while doing transactions

To load it locally in Chrome:

```bash
bun run extension:build
```

1. open `chrome://extensions`
2. enable **Developer mode**
3. click **Load unpacked**
4. select the `dist-extension/` folder from this repo

Rebuild after source changes:

```bash
bun run extension:build
```

Optional watch mode:

```bash
bun run extension:watch
```

Then click **Reload** for the extension in `chrome://extensions`, and refresh the target page.

Notes:

- no Chrome Web Store publishing is required for local use
- Chrome will show unpacked/developer warnings; that is expected
- protected pages like `chrome://*` and the Chrome Web Store will not support the overlay
- extension source lives in `src/`
- Vite outputs the unpacked loadable build to `dist-extension/`
- legacy CLI code is parked under `legacy-shell/` on this branch

## Troubleshooting

- if `gas-notify` says config is missing, run `gas-notify init`
- if `gas-notify notify` fails, confirm Windows notifications are enabled for your user session
- if WebSocket providers flap, confirm the validator still reports them in `ws_confirmed`
- if only polling works, keep HTTP endpoints configured and let the app retry WebSocket automatically
