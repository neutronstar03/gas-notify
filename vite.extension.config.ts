import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'

function getBuildVersion(): string {
  const packageJsonPath = path.resolve(__dirname, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version: string }

  // Get base version (e.g., "1.0" from "1.0.0" or just "1.0")
  const baseVersion = packageJson.version.split('.').slice(0, 2).join('.')

  // Calculate seconds since midnight
  const now = new Date()
  const secondsSinceMidnight = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()

  // Combine: base version + seconds (e.g., "1.0.45231")
  const buildVersion = `${baseVersion}.${secondsSinceMidnight}`

  // Log the version

  console.log(`🔨 Building Gas Notify v${buildVersion} (${now.toLocaleTimeString()})`)

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

      // Set version with timestamp
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
