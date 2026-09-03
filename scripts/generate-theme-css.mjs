import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const themePath = resolve(projectDir, 'design-system/theme.json')
const outputPath = resolve(projectDir, 'src/styles/theme.generated.css')
const theme = JSON.parse(readFileSync(themePath, 'utf8'))
const identifierPattern = /^[a-z][a-z0-9-]*$/
const referencePattern = /\{([a-z][a-z0-9-]*)\}/g
const allowedTypes = new Set([
  'color',
  'dimension',
  'number',
  'font-family',
  'font-weight',
  'duration',
  'cubic-bezier',
  'shadow',
  'text-style',
])

if (theme.schemaVersion !== 2) {
  throw new Error(`design-system/theme.json: expected schemaVersion 2, received ${theme.schemaVersion}.`)
}
if (theme.css?.selector !== '[data-aidc-theme]') {
  throw new Error('design-system/theme.json: css.selector must remain [data-aidc-theme].')
}
if (!Array.isArray(theme.css?.layerOrder) || theme.css.layerOrder.length === 0) {
  throw new Error('design-system/theme.json: css.layerOrder must be a non-empty array.')
}
if (!Array.isArray(theme.css?.root) || theme.css.root.length === 0) {
  throw new Error('design-system/theme.json: css.root must be a non-empty array.')
}

const tokenEntries = Object.entries(theme.groups ?? {}).flatMap(([groupName, entries]) => {
  if (!['foundation', 'semantic', 'domain', 'component'].includes(groupName)) {
    throw new Error(`design-system/theme.json: unsupported token group ${groupName}.`)
  }
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new Error(`design-system/theme.json: group ${groupName} must be an object.`)
  }
  return Object.entries(entries).map(([name, entry]) => ({ groupName, name, entry }))
})

const tokenByName = new Map()
for (const { groupName, name, entry } of tokenEntries) {
  if (!identifierPattern.test(name)) {
    throw new Error(`design-system/theme.json: invalid token ${groupName}.${name}.`)
  }
  if (tokenByName.has(name)) {
    throw new Error(`design-system/theme.json: duplicate token ${name}.`)
  }
  if (!entry || !allowedTypes.has(entry.type) || typeof entry.value !== 'string' || !entry.value) {
    throw new Error(`design-system/theme.json: invalid typed token ${groupName}.${name}.`)
  }
  tokenByName.set(name, entry)
}

function references(value) {
  return [...value.matchAll(referencePattern)].map((match) => match[1])
}

function assertReferences(scope, value) {
  for (const reference of references(value)) {
    if (!tokenByName.has(reference)) {
      throw new Error(`design-system/theme.json: ${scope} references unknown token {${reference}}.`)
    }
  }
}

for (const { name, entry } of tokenEntries) {
  assertReferences(`token ${name}`, entry.value)
}
for (const declaration of theme.css.root) {
  if (!declaration || typeof declaration.property !== 'string' || typeof declaration.value !== 'string') {
    throw new Error('design-system/theme.json: invalid css.root declaration.')
  }
  assertReferences(`root property ${declaration.property}`, declaration.value)
}

const visitState = new Map()
function visit(name, ancestry = []) {
  if (visitState.get(name) === 'done') return
  if (visitState.get(name) === 'visiting') {
    throw new Error(`design-system/theme.json: token reference cycle ${[...ancestry, name].join(' -> ')}.`)
  }
  visitState.set(name, 'visiting')
  for (const reference of references(tokenByName.get(name).value)) visit(reference, [...ancestry, name])
  visitState.set(name, 'done')
}
for (const name of tokenByName.keys()) visit(name)

const recipeEntries = Object.entries(theme.recipes ?? {})
if (recipeEntries.length === 0) {
  throw new Error('design-system/theme.json: recipes must be a non-empty object.')
}
for (const [name, recipe] of recipeEntries) {
  if (!identifierPattern.test(name) || !recipe || !allowedTypes.has(recipe.type)) {
    throw new Error(`design-system/theme.json: invalid recipe ${name}.`)
  }
  const token = tokenByName.get(recipe.token)
  if (!token) throw new Error(`design-system/theme.json: recipe ${name} references unknown token ${recipe.token}.`)
  if (token.type !== recipe.type) {
    throw new Error(`design-system/theme.json: recipe ${name} type ${recipe.type} does not match ${recipe.token} type ${token.type}.`)
  }
}

function toCssValue(value) {
  return value.replace(referencePattern, (_, name) => `var(--${name})`)
}

const lines = [
  '/* This file is generated from design-system/theme.json. Do not edit directly. */',
  `@layer ${theme.css.layerOrder.join(', ')};`,
  '',
  `${theme.css.selector} {`,
]

for (const declaration of theme.css.root) {
  lines.push(`  ${declaration.property}: ${toCssValue(declaration.value)};`)
}
for (const [groupName, entries] of Object.entries(theme.groups)) {
  lines.push('', `  /* ${groupName} tokens. */`)
  for (const [name, entry] of Object.entries(entries)) {
    lines.push(`  --${name}: ${toCssValue(entry.value)};`)
  }
}
lines.push('', '  /* Component recipe bindings. */')
for (const [name, recipe] of recipeEntries) {
  lines.push(`  --recipe-${name}: var(--${recipe.token});`)
}
lines.push('}', '')

const generatedCss = lines.join('\n')
if (process.argv.includes('--check')) {
  if (readFileSync(outputPath, 'utf8') !== generatedCss) {
    console.error('src/styles/theme.generated.css is stale. Run npm run generate:theme.')
    process.exit(1)
  }
  console.log(`Theme CSS is current (${tokenEntries.length} tokens, ${recipeEntries.length} recipes).`)
} else {
  const temporaryPath = `${outputPath}.tmp-${process.pid}`
  writeFileSync(temporaryPath, generatedCss)
  renameSync(temporaryPath, outputPath)
  console.log(`Generated src/styles/theme.generated.css (${tokenEntries.length} tokens, ${recipeEntries.length} recipes).`)
}
