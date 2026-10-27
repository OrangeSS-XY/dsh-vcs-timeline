/**
 * Screenshot the generated panel previews with the locally installed Edge.
 *
 * Design-verification helper: headless Edge renders `docs/ui-preview/*.html`
 * at a 400px sidebar width into matching PNGs. No package is installed and no
 * network is used.
 *
 * Usage: node scripts/preview-shots.mjs [--scale 2]
 * @module scripts/preview-shots
 */

import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'docs', 'ui-preview')

const candidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]
const browser = candidates.find((candidate) => existsSync(candidate))
if (browser === undefined) {
  console.error('No local Edge/Chrome found; previews stay HTML-only.')
  process.exit(1)
}

const scaleArg = process.argv.indexOf('--scale')
const scale = scaleArg > 0 ? Number(process.argv[scaleArg + 1] ?? '2') : 2
const pages = (await readdir(dir)).filter((name) => name.endsWith('.html'))
for (const page of pages.sort()) {
  const html = join(dir, page)
  const png = join(dir, page.replace(/\.html$/, '.png'))
  await execFileAsync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-extensions',
    `--force-device-scale-factor=${scale}`,
    '--window-size=400,900',
    `--screenshot=${png}`,
    pathToFileURL(html).href,
  ], { timeout: 60_000, windowsHide: true })
  console.log(`shot ${page} -> ${png.replace(root + '\\', '')}`)
}
