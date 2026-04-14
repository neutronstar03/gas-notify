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

## Release Workflow

When creating a new release:

1. **Correct the base version** in `package.json` first (for example `1.2`)
2. Run the standard verification/build commands:

```bash
bun run lint:fix
bun run check
bun run extension:build
```

3. Create the git commit for the release changes. The commit message should follow this format:

```
v1.2: <description of changes>
```

For example:
- `v1.2: add 4 new accent colors with separate Color/Size menus`
- `v1.3: implement dark mode toggle and keyboard shortcuts`

4. Create a git tag matching the base version, for example:

```bash
git tag v1.2
```

5. Push both the commit and the tag:

```bash
git push
git push --tags
```

Important:
- Do not forget to bump the base version before release if the release introduces a new minor/major version
- Commit messages should start with the version, e.g., `v1.2: description`
- Tags should use the `v<Major>.<Minor>` format, such as `v1.2`

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
