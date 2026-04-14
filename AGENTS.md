# Agent Instructions for Gas Notify Extension

## Build Tool

**Use BUN, not npm.**

All commands should use `bun` instead of `npm`:

```bash
# Correct
bun run extension:build
bun run extension:watch
bun run check
bun run lint
bun run lint:fix

# Incorrect - do not use
npm run extension:build
```

## Versioning System

The extension uses an auto-incrementing version format:

```
Major.Minor.Build
```

### How it works:

1. **Base Version**: Set in `package.json` as `"version": "1.0"` (Major.Minor only)
2. **Build Number**: Automatically generated as **seconds since midnight** (0-86399)
3. **Result**: Every build produces a unique version like `1.0.19557`, `1.0.19558`, etc.

### Why this system:

- **Auto-increments every build** - No manual version bumping needed
- **Resets daily** - Numbers stay manageable (max 86399)
- **Easy to verify** - Console shows: `🔨 Building Gas Notify v1.0.19912 (05:31:52)`
- **Chrome recognizes changes** - Extension updates properly on refresh

### When to bump Major/Minor:

- Change `package.json` version to `"1.1"` or `"2.0"` for significant releases
- The build number (patch) is always auto-generated from the timestamp

## Project Structure

```
src/
  manifest.json          # Extension manifest (permissions, icons, etc.)
  background.ts          # Service worker (window management, LED badge, themes)
  widget.html            # Widget UI HTML
  widget.ts              # Widget entry point
  widget.css             # Theme system with CSS variables
  widget/
    main.ts              # Widget initialization and theme handling
    view.ts              # UI rendering
    monitor.ts           # WebSocket/HTTP monitoring
    wsRpcClient.ts       # WebSocket RPC client
    rpc.ts               # HTTP RPC client
  icons/                 # Extension icons

dist-extension/          # Build output (load this in Chrome)
```

## Code Quality

Before committing, run:

```bash
bun run lint:fix   # Check for linting errors
bun run check      # TypeScript type checking
bun run extension:build  # Verify build succeeds
```
