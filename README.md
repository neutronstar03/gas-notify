# Gas Notify

Compact Chrome extension widget for live Ethereum `baseFeePerGas` monitoring.

## Demo

<video src="https://github.com/user-attachments/assets/e315978f-cb2b-4a85-aca1-de99add64db8" autoplay loop muted playsinline controls width="240">
  Your browser does not support embedded video. You can download the demo here:
  <a href="https://github.com/user-attachments/assets/e315978f-cb2b-4a85-aca1-de99add64db8">Gas Notify demo video</a>
</video>

## What it does

- click the extension action icon to open a small standalone gas widget window
- click again to focus the existing widget instead of opening duplicates
- widget is not injected into the current page DOM
- WebSocket-first monitoring with HTTP fallback
- recent block fee history with live age updates

## Local development

```bash
bun install --frozen-lockfile
bun run verify
bun run validate:rpcs
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

1. run `bun run verify`
2. click **Reload** for the extension in `chrome://extensions`

To update an existing checkout on either computer:

```bash
git pull --ff-only
bun install --frozen-lockfile
bun run verify
```

## Notes

- no Chrome Web Store publishing is required for local use
- Chrome will show unpacked/developer warnings; that is expected
- source lives in `src/`
- Vite outputs the loadable extension bundle to `dist-extension/`

## Validate RPCs

```bash
bun run validate:rpcs
bun run validate:rpcs --skip-defillama
```

Optional custom candidate list:

```bash
GAS_NOTIFY_RPC_LIST="wss://ethereum-rpc.publicnode.com,https://ethereum-rpc.publicnode.com" bun run validate:rpcs
```

The validator prints JSON grouped into `ws_confirmed`, `http_confirmed`, and `rejected`.

## Versioning

- `package.json` is the single source of truth for the app version
- the build normalizes a Major.Minor version such as `1.2` to `1.2.0` in the generated extension manifest
- unpacked development reloads keep the same version; bump `package.json` only for a meaningful release

## v2.0: one fee suggestion for Rabby

The widget shows one **Suggested** gwei value. Click it to copy the number, then paste it into Rabby's **Custom Gas Price** and **Max Priority Fee** fields. With both fields equal, the effective price per gas equals the quoted value when the transaction is included. The suggestion estimates ordinary Ethereum mainnet transaction fees, not blob fees, gas limits, transaction success, or guaranteed inclusion.

For up to five recent blocks, `eth_feeHistory` supplies each block's gas-weighted 60th-percentile effective priority fee and the calculated next-block base fee `B`. The estimator uses:

```text
T = max(median(recent usable tips), latest block tip (zero for an empty block))
Suggested = max(ceil(B × 1.10), B + T)
```

The median of an even sample count rounds upward. All calculations use integer wei. The copied value rounds upward to six decimal places in gwei, retaining individual wei for smaller fees. The latest tip catches spikes already visible in a confirmed block; unseen pending demand can still delay inclusion.

History is fetched immediately, so there is no five-block startup wait. One to four usable blocks work too. Without usable tip history, the widget calculates the next base fee from the latest block's base fee and gas utilization, applies +10%, and marks the suggestion **Provisional**. After 45 seconds without a newer block timestamp, copying is disabled and the widget shows **Unavailable** until fresh data arrives.

The four rows remain actual observed base fees. The header shows the change from the previous observed block (which may not be consecutive during an outage). Row ages are block ages; the footer shows time since receiving the latest displayed block.

Color and size settings survive reloads, the toolbar badge follows the accent, and window position is remembered and clamped to current display work areas. Right-click the extension action for Color/Size; click to open/focus, double-click to close. The extension uses display information to keep its window on-screen and clipboard-write permission for the copy button.

## RPC sources and release validation

RPC candidates come from Chainlist's documented JSON feed, <https://chainlist.org/rpcs.json>, maintained in <https://github.com/DefiLlama/chainlist>. The validator filters Ethereum mainnet (`chainId: 1`), skips obvious key placeholders, and keeps configured defaults if discovery fails. The legacy `--skip-defillama` flag is retained as an alias for skipping discovery. No JavaScript source scraping is required.

A listing alone is not enough: this app needs the correct chain ID, fresh blocks with base fees, and `eth_feeHistory` with usable rewards and the next base fee. WebSocket candidates must actually deliver a matching `newHeads` notification. The validator reports these capabilities, rejection reasons, and latency; it does not automatically change the extension's providers.

For a bounded validation run:

```powershell
bun run validate:rpcs --skip-defillama --limit 12
bun run validate:rpcs --no-discovery --no-defaults --url https://ethereum-rpc.publicnode.com,https://eth.drpc.org,wss://ethereum-rpc.publicnode.com,wss://eth.drpc.org --timeout-ms 8000
```

Before release, select a small set from confirmed candidates, edit `src/widget/config.ts`, and update the HTTP origins in `src/manifest.json`. Test endpoints from the workstation where the widget runs; latency and access vary by network.

The v2.0 validation on 2026-10-14 from this workstation selected PublicNode and dRPC for WebSocket, and PublicNode, dRPC and Blast for HTTP/fee history. Both WebSocket endpoints delivered actual heads. HTTP chain/block/history sequences took approximately 623ms, 383ms and 899ms respectively in that sample. `0xrpc.io` HTTP also passed but its WebSocket failed; `eth.llamarpc.com` returned HTTP 525. These are dated observations, not uptime guarantees.
