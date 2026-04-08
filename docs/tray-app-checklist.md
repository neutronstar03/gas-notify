## Tauri Tray App Checklist

### Goal
- Turn the current shell-based gas monitor into a lightweight Windows tray app with a small floating widget.

### Product shape
- [ ] Create a Tauri desktop app shell
- [ ] Add a tray icon (gas pump concept)
- [ ] Left-click tray icon toggles widget visibility
- [ ] Right-click tray icon opens menu: Show/Hide, Pause, Resume, Quit
- [ ] Keep monitoring alive even when the widget is hidden

### Monitoring core
- [ ] Extract reusable monitoring logic from CLI-specific code
- [ ] Preserve WebSocket-first block monitoring
- [ ] Preserve HTTP fallback and reconnect behavior
- [ ] Track the latest 2-4 blocks in memory for UI display
- [ ] Expose current status: connected mode, provider, last update time

### Widget UI v1
- [ ] Build a frameless always-on-top floating panel
- [ ] Make panel draggable and remember its position
- [ ] Start with compact size around 220px wide
- [ ] Show 3 rows by default
- [ ] Each row shows block suffix, base fee in gwei, and relative age
- [ ] Emphasize latest fee visually
- [ ] Add a subtle live connection indicator

### Theming
- [ ] Add a playful gas-themed visual variant
- [ ] Add a plain dark visual variant
- [ ] Make theme switchable in settings

### App settings
- [ ] Persist widget position
- [ ] Persist visible row count (2, 3, or 4)
- [ ] Persist selected theme
- [ ] Persist always-on-top preference
- [ ] Persist paused/running monitoring state

### Nice-to-have after v1
- [ ] Hover or click to reveal extra info
- [ ] Threshold coloring / alert states
- [ ] Windows notifications for threshold crossings
- [ ] Mini history sparkline
- [ ] Launch at startup

### Repo implementation steps
1. Add Tauri dependencies and app scaffold.
2. Create shared monitor module(s) reusable by the desktop app.
3. Build tray lifecycle and toggle behavior.
4. Build the floating widget window.
5. Wire live monitoring state into the UI.
6. Add persistence for settings and widget state.
7. Polish styling and tray assets.
8. Test packaging and Windows behavior.
