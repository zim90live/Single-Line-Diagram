import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(projectDir, path), 'utf8')
const readJson = (path) => JSON.parse(read(path))
const alignment = readJson('design-system/aidc-ui-alignment.json')
const localManifest = readJson('design-system/component-manifest.json')
const failures = []

function fail(message) {
  failures.push(message)
}

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name)
    if (entry.isDirectory()) return collectFiles(absolutePath)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [absolutePath] : []
  })
}

if (alignment.schemaVersion !== 1) fail('alignment schemaVersion must be 1')
if (alignment.sharedPackage !== '@aidc/ui') fail('shared package must remain @aidc/ui')

const localComponentKeys = localManifest.components.map((component) => component.key)
if (JSON.stringify(localComponentKeys) !== JSON.stringify(alignment.canonicalComponents)) {
  fail('local primitive keys drifted from the AIDC alignment contract')
}
const localHelperKeys = localManifest.headless.map((helper) => helper.key)
if (JSON.stringify(localHelperKeys) !== JSON.stringify(alignment.canonicalHelpers)) {
  fail('local headless helper keys drifted from the AIDC alignment contract')
}

const featureFiles = collectFiles(join(projectDir, 'src')).filter((file) => (
  !file.includes(`${join('src', 'components', 'ui')}/`)
))
for (const file of featureFiles) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const specifier = match[1]
    if (
      specifier === './components/ui' ||
      specifier === './ui' ||
      specifier === '../ui' ||
      specifier.endsWith('/components/ui')
    ) {
      fail(`${relative(projectDir, file)} bypasses @aidc/ui with ${specifier}`)
    }
  }
}

const tsconfig = readJson('tsconfig.app.json')
if (tsconfig.compilerOptions?.paths?.['@aidc/ui']?.[0] !== './src/components/ui/index.ts') {
  fail('tsconfig.app.json must map @aidc/ui to the temporary local implementation')
}
const viteConfig = read('vite.config.ts')
if (!viteConfig.includes("'@aidc/ui': fileURLToPath(new URL('./src/components/ui/index.ts'")) {
  fail('vite.config.ts must map @aidc/ui to the temporary local implementation')
}

const sourceArgumentIndex = process.argv.indexOf('--source')
if (sourceArgumentIndex >= 0) {
  const sourceArgument = process.argv[sourceArgumentIndex + 1]
  if (!sourceArgument) fail('--source requires an AIDC repository path')
  else {
    const sourceRoot = resolve(projectDir, sourceArgument)
    if (!existsSync(join(sourceRoot, 'design-system/component-manifest.json'))) {
      fail(`AIDC source is missing at ${sourceRoot}`)
    } else {
      const sourceManifest = JSON.parse(readFileSync(
        join(sourceRoot, 'design-system/component-manifest.json'),
        'utf8',
      ))
      const sourceComponentKeys = sourceManifest.components.map((component) => component.key)
      const sourceHelperKeys = sourceManifest.headlessHelpers.map((helper) => helper.key)
      if (sourceManifest.schemaVersion !== alignment.upstream.componentManifestSchemaVersion) {
        fail(`AIDC component manifest schema changed to ${sourceManifest.schemaVersion}`)
      }
      if (sourceManifest.sourceOfTruth !== alignment.upstream.sourceOfTruth) {
        fail(`AIDC sourceOfTruth changed to ${sourceManifest.sourceOfTruth}`)
      }
      if (JSON.stringify(sourceComponentKeys) !== JSON.stringify(alignment.canonicalComponents)) {
        fail('AIDC primitive keys changed; update the convergence contract intentionally')
      }
      if (JSON.stringify(sourceHelperKeys) !== JSON.stringify(alignment.canonicalHelpers)) {
        fail('AIDC helper keys changed; update the convergence contract intentionally')
      }
      const sourceTheme = JSON.parse(readFileSync(join(sourceRoot, 'design-system/theme.json'), 'utf8'))
      if (sourceTheme.schemaVersion !== alignment.upstream.themeSchemaVersion) {
        fail(`AIDC theme schema changed to ${sourceTheme.schemaVersion}`)
      }
      const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: sourceRoot,
        encoding: 'utf8',
      }).trim()
      if (sourceCommit !== alignment.upstream.commit) {
        fail(`AIDC HEAD changed from ${alignment.upstream.commit} to ${sourceCommit}`)
      }
      for (const [path, expectedHash] of Object.entries(alignment.sourceFiles)) {
        const absolutePath = join(sourceRoot, path)
        if (!existsSync(absolutePath)) {
          fail(`AIDC canonical file is missing: ${path}`)
          continue
        }
        const actualHash = createHash('sha256')
          .update(readFileSync(absolutePath))
          .digest('hex')
        if (actualHash !== expectedHash) fail(`AIDC canonical file changed: ${path}`)
      }
    }
  }
}

if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join('\n'))
  process.exit(1)
}

console.log(
  `AIDC UI boundary verified: ${alignment.canonicalComponents.length} primitives, ` +
  `${alignment.canonicalHelpers.length} helpers, ` +
  `${alignment.pendingUpstreamChanges.length} pending upstream changes.`,
)
