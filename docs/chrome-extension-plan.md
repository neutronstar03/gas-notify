## Chrome Extension Plan

### Goal
- Replace the abandoned tray-app experiment with a private unpacked Chrome extension.
- Show a tiny gas monitor only when the user clicks the extension action.
- Do not inject UI into webpages.

### Desired behavior
- Click extension icon: open or focus a small standalone extension window.
- Widget is not injected into the current page DOM.
- Widget stays open while browsing and while doing transactions.
- Widget behaves like a tiny browser-managed popup window.

### Recommended architecture

- source lives in `src/`
- Vite builds unpacked output into `dist-extension/`
- Chrome should load the built `dist-extension/` folder, not the source folder

#### 1. Manifest V3 extension
- `manifest.json`
- action icon
- background service worker
- standalone widget page

#### 2. Background/service worker
- Handles extension action click
- Opens widget window if missing
- Focuses existing widget window if already open
- Stores lightweight settings in `chrome.storage.local`

#### 3. Widget page
- Renders a compact floating-tool style UI in an extension page
- Runs gas monitoring logic directly in the widget
- Shows recent values and connection status

#### 4. Shared monitor core
- Reuse the RPC and fee parsing logic where possible
- Prefer browser-safe modules only
- WebSocket-first
- HTTP fallback if needed

### UI v1
- Small dark panel
- Opens as a separate popup window
- Shows latest recent block fee values
- Designed for quick glances during transactions

Suggested compact content:
- latest fee
- previous fee(s)
- tiny age indicator
- optional connection dot

### Interaction model
- User clicks extension icon
- Background script either:
  - opens the widget window if missing
  - focuses the existing widget window if already open

### Window strategy
- Use `chrome.windows.create({ type: 'popup' })`
- Keep the widget independent from webpage DOM/CSS
- Re-focus the same widget window instead of spawning duplicates

### Technical notes
- Unpacked Chrome extension is fine for local use
- Chrome will show Developer Mode warnings, but the extension remains usable
- Since UI is not page-injected, protected pages are less relevant to the widget itself
- Chrome still will not let the extension inject into protected pages, but that is no longer central to v1
- Legacy shell code is preserved in git history/branching, not in this branch tree

### Step-by-step implementation plan
1. Create extension skeleton under a dedicated folder.
2. Add MV3 manifest and action icon wiring.
3. Add background worker to open/focus widget window.
4. Build standalone widget page shell.
5. Port minimal gas monitor logic into browser-safe shared code.
6. Render latest fees in the widget.
7. Add local settings if needed.

### Commands

```bash
bun run extension:build
bun run extension:watch
```

### v1 success criteria
- Clicking the extension icon opens or focuses a small standalone widget window.
- Widget shows live gas values.
- Widget is visually compact and usable during transactions.
- No publishing required; works as a private unpacked extension.
