import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'

function copyManifestPlugin() {
  return {
    name: 'copy-extension-manifest',
    writeBundle() {
      const sourcePath = path.resolve(__dirname, 'src/manifest.json')
      const targetPath = path.resolve(__dirname, 'dist-extension/manifest.json')
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      fs.copyFileSync(sourcePath, targetPath)
    },
  }
}

export default defineConfig({
  build: {
    outDir: 'dist-extension',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        background: path.resolve(__dirname, 'src/background.ts'),
        content: path.resolve(__dirname, 'src/content.ts'),
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
