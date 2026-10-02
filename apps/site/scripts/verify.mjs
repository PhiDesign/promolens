import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(siteRoot, 'dist')
const pages = ['index.html', 'pricing/index.html', 'terms/index.html', 'privacy/index.html', 'refunds/index.html', '404.html']

for (const page of pages) await access(path.join(output, page))

const combined = (await Promise.all(pages.map((page) => readFile(path.join(output, page), 'utf8')))).join('\n')
const required = [
  'promolens.amadoso.com',
  '/pricing/',
  '/terms/',
  '/privacy/',
  '/refunds/',
  'PromoLens Plus',
  '$4.99',
  'Amadoso',
  'not affiliated with Reddit'
]

for (const value of required) {
  if (!combined.includes(value)) throw new Error(`Site verification failed: missing ${value}`)
}

console.log(`Verified ${pages.length} pages and required Paddle review content`)
