import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { writeFileSync } from 'node:fs'

const result = await build({
  entryPoints: ['scripts/smoke-material.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  tsconfig: 'tsconfig.json',
})
writeFileSync('node_modules/.cache-smoke.mjs', result.outputFiles[0].text)
await import(pathToFileURL('node_modules/.cache-smoke.mjs').href)
