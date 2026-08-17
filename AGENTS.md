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

`package.json` is the single source of truth for the extension version.

- A Major.Minor value such as `"version": "1.2"` is normalized to `1.2.0` in the generated manifest.
- Chrome unpacked-extension reloads do not require a unique version for every local build.
- Do not generate a build component from seconds since midnight: Chrome version components cannot exceed 65535, and the value would reset backwards every day.
- Bump the package version only for meaningful releases.

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
bun run lint:fix
bun run verify
```

`bun run verify` runs non-mutating lint, type checking, tests, and the extension build. On a fresh or updated checkout, install the exact locked dependencies first with `bun install --frozen-lockfile`.
