import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'

const MAX_VERSION_SEGMENT = 65535
const VERSION_SEGMENT_PATTERN = /^(?:0|[1-9]\d*)$/

function normalizeExtensionVersion(version: string): string {
  const segments = version.split('.')
  if (segments.length === 0 || segments.length > 4) {
    throw new Error(`Invalid extension version in package.json: ${version}`)
  }

  const normalized = segments.map((segment) => {
    if (!VERSION_SEGMENT_PATTERN.test(segment)) {
      throw new Error(`Invalid extension version segment in package.json: ${segment}`)
    }

    const value = Number(segment)
    if (value > MAX_VERSION_SEGMENT) {
      throw new Error(`Extension version segment exceeds ${MAX_VERSION_SEGMENT}: ${segment}`)
    }

    return String(value)
  })

  while (normalized.length < 3) {
    normalized.push('0')
  }

  return normalized.join('.')
}

function getBuildVersion(): string {
  const packageJsonPath = path.resolve(__dirname, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version: string }
  const buildVersion = normalizeExtensionVersion(packageJson.version)
  console.log(`🔨 Building Gas Notify v${buildVersion}`)

  return buildVersion
}

function copyManifestPlugin() {
  return {
    name: 'copy-extension-manifest',
    writeBundle() {
      const sourcePath = path.resolve(__dirname, 'src/manifest.json')
      const iconsSourceDir = path.resolve(__dirname, 'src/icons')
      const targetPath = path.resolve(__dirname, 'dist-extension/manifest.json')
      const iconsTargetDir = path.resolve(__dirname, 'dist-extension/icons')
      const manifest = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as Record<string, unknown>

      // package.json is the version source; normalize Major.Minor to Major.Minor.0.
      manifest.version = getBuildVersion()

      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      fs.writeFileSync(targetPath, JSON.stringify(manifest, null, 2))

      fs.mkdirSync(iconsTargetDir, { recursive: true })
      for (const entry of fs.readdirSync(iconsSourceDir)) {
        fs.copyFileSync(path.join(iconsSourceDir, entry), path.join(iconsTargetDir, entry))
      }
    },
  }
}

export default defineConfig({
  build: {
    outDir: 'dist-extension',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: path.resolve(__dirname, 'src/background.ts'),
        widget: path.resolve(__dirname, 'src/widget.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  plugins: [copyManifestPlugin()],
})
