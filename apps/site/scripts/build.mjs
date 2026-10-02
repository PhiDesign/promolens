import { cp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(siteRoot, 'dist')

await rm(output, { recursive: true, force: true })
await mkdir(path.join(output, 'assets'), { recursive: true })
await cp(path.join(siteRoot, 'public'), output, { recursive: true })
await cp(
  path.resolve(siteRoot, '../extension/public/icons/icon128.png'),
  path.join(output, 'assets', 'promolens-icon.png')
)

console.log(`Built PromoLens site in ${output}`)
