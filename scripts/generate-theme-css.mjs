import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const themePath = resolve(projectDir, 'design-system/theme.json')
const outputPath = resolve(projectDir, 'src/styles/theme.generated.css')
const theme = JSON.parse(readFileSync(themePath, 'utf8'))

for (const groupName of ['tokens', 'recipes']) {
  const group = theme[groupName]
  if (!group || typeof group !== 'object' || Array.isArray(group)) {
    throw new Error(`design-system/theme.json: ${groupName} must be an object.`)
  }
  for (const [name, entry] of Object.entries(group)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      throw new Error(`Invalid theme key: ${groupName}.${name}`)
    }
    if (!entry || typeof entry.type !== 'string' || typeof entry.value !== 'string' || !entry.value) {
      throw new Error(`Invalid typed theme entry: ${groupName}.${name}`)
    }
  }
}

function emitEntries(entries, prefix = '') {
  return Object.entries(entries)
    .map(([name, entry]) => `  --${prefix}${name}: ${entry.value};`)
    .join('\n')
}

const css = `/* Generated from design-system/theme.json. Do not edit directly. */
@layer components;

:root {
  color: var(--ink);
  background: var(--canvas);
  font-family: var(--font-interface);
  font-synthesis: none;
  text-rendering: optimizeLegibility;

${emitEntries(theme.tokens)}

${emitEntries(theme.recipes, 'recipe-')}
}
`

if (process.argv.includes('--check')) {
  if (readFileSync(outputPath, 'utf8') !== css) {
    console.error('src/styles/theme.generated.css is stale. Run npm run generate:theme.')
    process.exit(1)
  }
  console.log('Theme CSS is current.')
} else {
  writeFileSync(outputPath, css)
  console.log('Generated src/styles/theme.generated.css.')
}
