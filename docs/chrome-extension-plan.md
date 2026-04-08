## Chrome Extension Plan

### Goal
- Replace the abandoned tray-app experiment with a private unpacked Chrome extension.
- Show a tiny gas monitor only when the user clicks the extension action.

### Desired behavior
- Click extension icon: inject or toggle a sticky gas panel on the current page.
- Click extension icon again: hide/remove the panel.
- Panel stays visible while browsing that page and while doing transactions.
- Panel should be draggable if feasible.
- If true drag is awkward in content-script land, fall back to a simple fixed small panel.

### Recommended architecture

- source lives in `src/`
- Vite builds unpacked output into `dist-extension/`
- Chrome should load the built `dist-extension/` folder, not the source folder

#### 1. Manifest V3 extension
- `manifest.json`
- action icon
- background service worker
- content script

#### 2. Background/service worker
- Handles extension action click
- Checks active tab
- Sends toggle message to content script
- Stores lightweight settings in `chrome.storage.local`

#### 3. Content script overlay
- Injects a compact floating panel into the webpage DOM
- Maintains overlay state per tab/page
- Handles UI rendering and optional dragging
- Reads gas updates and renders recent values

#### 4. Shared monitor core
- Reuse the RPC and fee parsing logic where possible
- Prefer browser-safe modules only
- WebSocket-first
- HTTP fallback if needed

### UI v1
- Small dark panel
- No browser window/frame
- Shows latest recent block fee values
- Designed for quick glances during transactions

Suggested compact content:
- latest fee
- previous fee(s)
- tiny age indicator
- optional connection dot

### Interaction model
- User clicks extension icon
- Background script sends `toggle-overlay`
- Content script either:
  - creates the overlay if missing
  - removes/hides it if already shown

### Dragging strategy

#### Preferred
- Overlay is a DOM element positioned `fixed`
- Drag implemented with pointer events
- Position persisted per tab session or locally

#### Fallback
- Fixed position in top-right or bottom-right corner
- No drag in v1 if drag becomes noisy on arbitrary pages

### Technical notes
- Unpacked Chrome extension is fine for local use
- Chrome will show Developer Mode warnings, but the extension remains usable
- Overlay will not work on protected pages like `chrome://*` or the Chrome Web Store

### Step-by-step implementation plan
1. Create extension skeleton under a dedicated folder.
2. Add MV3 manifest and action icon wiring.
3. Add background worker to toggle overlay on current tab.
4. Build content-script overlay shell.
5. Port minimal gas monitor logic into browser-safe shared code.
6. Render latest fees in the overlay.
7. Add optional dragging.
8. Add local settings if needed.

### Commands

```bash
bun run extension:build
bun run extension:watch
```

### v1 success criteria
- Clicking the extension icon toggles the overlay on a normal webpage.
- Overlay shows live gas values.
- Overlay is visually compact and usable during transactions.
- No publishing required; works as a private unpacked extension.
