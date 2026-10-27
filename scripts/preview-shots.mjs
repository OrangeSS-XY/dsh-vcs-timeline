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
import { readdir, readFile } from 'node:fs/promises'
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
  // Each page declares the stage size it was rendered at (side panel 400x900,
  // fullscreen overlay 1440x900); the shot uses exactly that viewport.
  const markup = await readFile(html, 'utf8')
  const declared = /data-stage="(\d+)x(\d+)"/.exec(markup)
  const width = declared?.[1] ?? '400'
  const height = declared?.[2] ?? '900'
  await execFileAsync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-extensions',
    `--force-device-scale-factor=${scale}`,
    `--window-size=${width},${height}`,
    `--screenshot=${png}`,
    pathToFileURL(html).href,
  ], { timeout: 60_000, windowsHide: true })
  console.log(`shot ${page} (${width}x${height}) -> ${png.replace(root + '\\', '')}`)
}
