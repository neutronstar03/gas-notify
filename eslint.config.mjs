import antfu from '@antfu/eslint-config'

export default antfu(
  {
    typescript: true,
  },
  {
    ignores: [
      'data/**',
      'dist/**',
      'logs/**',
      'src-tauri/gen/**',
      'src-tauri/target/**',
      'vendor/**',
    ],
  },
)
