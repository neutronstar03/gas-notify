import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'

function copyManifestPlugin() {
  return {
    name: 'copy-extension-manifest',
    writeBundle() {
      const sourcePath = path.resolve(__dirname, 'src/manifest.json')
      const packageJsonPath = path.resolve(__dirname, 'package.json')
      const targetPath = path.resolve(__dirname, 'dist-extension/manifest.json')
      const manifest = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as Record<string, unknown>
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version: string }

      manifest.version = packageJson.version

      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      fs.writeFileSync(targetPath, JSON.stringify(manifest, null, 2))
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
