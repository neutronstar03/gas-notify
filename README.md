# Gas Notify

Compact Chrome extension widget for live Ethereum `baseFeePerGas` monitoring.

## What it does

- click the extension action icon to open a small standalone gas widget window
- click again to focus the existing widget instead of opening duplicates
- widget is not injected into the current page DOM
- WebSocket-first monitoring with HTTP fallback
- recent block fee history with live age updates

## Local development

```bash
bun install
bun run lint
bun run check
bun run extension:build
```

Optional watch mode:

```bash
bun run extension:watch
```

## Load in Chrome

1. open `chrome://extensions`
2. enable **Developer mode**
3. click **Load unpacked**
4. select the `dist-extension/` folder from this repo

After source changes:

1. run `bun run extension:build`
2. click **Reload** for the extension in `chrome://extensions`

## Notes

- no Chrome Web Store publishing is required for local use
- Chrome will show unpacked/developer warnings; that is expected
- source lives in `src/`
- Vite outputs the loadable extension bundle to `dist-extension/`

## Versioning

- `package.json` is the single source of truth for the app version
- the build copies that version into the generated extension `manifest.json`
