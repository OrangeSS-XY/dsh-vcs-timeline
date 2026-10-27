/**
 * Build the two runtime artifacts:
 *
 *  - `lib/index.js`  — Host half: one ESM bundle, node builtins only.
 *  - `lib/client.js` — Client half: one CJS bundle wrapped in the browser
 *    module-loader factory envelope (`window.__ModuleLoader__.load`), with
 *    `react` provided by the page's module table.
 *
 * Run with `node scripts/build.mjs`. Both bundles embed the package version
 * so the running plugin can report it without reading package.json at
 * runtime.
 * @module scripts/build
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const version = String(manifest.version ?? '0.0.0')
const packageName = String(manifest.name)
const define = { __PLUGIN_VERSION__: JSON.stringify(version), __PLUGIN_NAME__: JSON.stringify(packageName) }

await mkdir(resolve(root, 'lib'), { recursive: true })

/** Host half: ESM, node platform, type-only DSH imports erased by esbuild. */
await build({
  entryPoints: [resolve(root, 'src/host/index.ts')],
  outfile: resolve(root, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none',
  define,
  logLevel: 'info',
})

/** Client half: CJS body, React left to the page module table. */
const clientBundle = await build({
  entryPoints: [resolve(root, 'src/client/index.ts')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'react',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  sourcemap: false,
  legalComments: 'none',
  define,
  logLevel: 'warning',
})

const body = clientBundle.outputFiles?.[0]?.text ?? ''
if (body === '') throw new Error('client bundle is empty')

/*
 * The module loader hands the factory a `require` bound to the page's module
 * table. Wrapping the CJS body keeps that table authoritative for react and
 * keeps the plugin a single self-registering artifact.
 */
const wrapper = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(packageName)},
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;
    (function (module, exports, require) {
${body}
    })(module, exports, require);
    return module.exports;
  },
});
`

await writeFile(resolve(root, 'lib/client.js'), wrapper, 'utf8')
console.log(`built ${packageName}@${version}: lib/index.js, lib/client.js`)
