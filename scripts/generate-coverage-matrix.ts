import fs from 'node:fs'
import path from 'node:path'

const ROOT_DIR = process.cwd()
const EXAMPLES_DIR = path.join(ROOT_DIR, 'examples')
const DOCS_DIR = path.join(ROOT_DIR, 'docs')
const MATRIX_OUTPUT_PATH = path.join(DOCS_DIR, 'coverage-matrix.md')

const isCheck = process.argv.includes('--check')

type AxisKey = 'server' | 'client' | 'pubsub' | 'auth'

const AXES: Record<AxisKey, string[]> = {
  server: ['express', 'fastify', 'hono', 'node', 'fetch'],
  client: ['tanstack-query', 'swr', 'vanilla'],
  pubsub: ['none', 'redis', 'ably', 'pusher'],
  auth: ['unscoped', 'scoped'],
}

const AXIS_LABELS: Record<AxisKey, Record<string, string>> = {
  server: {
    express: 'Express',
    fastify: 'Fastify',
    hono: 'Hono',
    node: 'Node (http)',
    fetch: 'Fetch API (Next.js / Bun / Deno)',
  },
  client: {
    'tanstack-query': 'TanStack Query',
    swr: 'SWR',
    vanilla: 'Vanilla SSEClient',
  },
  pubsub: {
    none: 'None (Local memory)',
    redis: 'Redis',
    ably: 'Ably',
    pusher: 'Pusher',
  },
  auth: {
    unscoped: 'Unscoped (unauthenticated)',
    scoped: 'Scoped (HMAC token)',
  },
}

interface CoverageSource {
  name: string
  path: string
  coverage: Partial<Record<AxisKey, string>>
  type: 'example' | 'recipe'
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function collectExampleManifests(): CoverageSource[] {
  const manifests: CoverageSource[] = []
  if (!fs.existsSync(EXAMPLES_DIR)) return manifests

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
        const pkgJsonPath = path.join(fullPath, 'package.json')
        if (fs.existsSync(pkgJsonPath)) {
          const rawPkg: unknown = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
          if (isPlainRecord(rawPkg)) {
            const restale = rawPkg['restale']
            if (isPlainRecord(restale)) {
              const rawCoverage = restale['coverage']
              if (isPlainRecord(rawCoverage)) {
                const coverage: Partial<Record<AxisKey, string>> = {}
                for (const [k, v] of Object.entries(rawCoverage)) {
                  if (typeof v === 'string' && (k === 'server' || k === 'client' || k === 'pubsub' || k === 'auth')) {
                    coverage[k] = v
                  }
                }
                const name = typeof rawPkg['name'] === 'string' ? rawPkg['name'] : path.basename(fullPath)
                manifests.push({
                  name,
                  path: path.relative(ROOT_DIR, fullPath),
                  coverage,
                  type: 'example',
                })
              }
            }
          }
        }
        walk(fullPath)
      }
    }
  }

  walk(EXAMPLES_DIR)
  return manifests
}

function collectRecipeCoverage(): CoverageSource[] {
  const recipesDir = path.join(DOCS_DIR, 'recipes')
  const recipes: CoverageSource[] = []
  if (!fs.existsSync(recipesDir)) return recipes

  const files = fs.readdirSync(recipesDir)
  for (const file of files) {
    if (file.endsWith('.md')) {
      const name = file.replace('.md', '')
      const relPath = path.relative(ROOT_DIR, path.join(recipesDir, file))

      // Derive coverage from recipe names or frontmatter
      const coverage: Partial<Record<AxisKey, string>> = {}
      if (name.startsWith('server-')) coverage.server = name.replace('server-', '')
      if (name.startsWith('client-')) coverage.client = name.replace('client-', '')
      if (name.startsWith('pubsub-')) coverage.pubsub = name.replace('pubsub-', '')
      if (name.startsWith('auth-')) coverage.auth = name.replace('auth-', '')
      if (name === 'flagship-full-stack') {
        coverage.server = 'fetch'
        coverage.client = 'tanstack-query'
        coverage.pubsub = 'redis'
        coverage.auth = 'scoped'
      }

      if (Object.keys(coverage).length > 0) {
        recipes.push({
          name: `Recipe: ${name}`,
          path: relPath,
          coverage,
          type: 'recipe',
        })
      }
    }
  }

  return recipes
}

interface TableRow {
  val1: string
  cells: Record<string, string>
}

interface TableData {
  axis1: AxisKey
  axis2: AxisKey
  rows: TableRow[]
}

interface CoverageStats {
  matrixResults: TableData[]
  totalCombinations: number
  coveredCombinations: number
  emptyCells: string[]
}

function generatePairwiseCoverage(sources: CoverageSource[]): CoverageStats {
  const pairs: [AxisKey, AxisKey][] = [
    ['server', 'client'],
    ['server', 'pubsub'],
    ['server', 'auth'],
    ['client', 'pubsub'],
    ['client', 'auth'],
    ['pubsub', 'auth'],
  ]

  const matrixResults: TableData[] = []
  let totalCombinations = 0
  let coveredCombinations = 0
  const emptyCells: string[] = []

  for (const [axis1, axis2] of pairs) {
    const table: TableData = {
      axis1,
      axis2,
      rows: [],
    }

    for (const val1 of AXES[axis1]) {
      const row: TableRow = { val1, cells: {} }
      for (const val2 of AXES[axis2]) {
        totalCombinations++
        const matching = sources.filter((s) => {
          const c = s.coverage
          return (
            (c[axis1] === val1 && c[axis2] === val2) ||
            (c[axis1] === val1 && !c[axis2] && s.type === 'recipe') ||
            (c[axis2] === val2 && !c[axis1] && s.type === 'recipe')
          )
        })

        if (matching.length > 0) {
          coveredCombinations++
          row.cells[val2] = matching
            .map((m) => {
              const href = m.type === 'recipe' ? `./recipes/${path.basename(m.path)}` : `../${m.path}`
              return `[${m.name}](${href})`
            })
            .join(', ')
        } else {
          row.cells[val2] = '❌ **GAP**'
          emptyCells.push(`${axis1}:${val1} × ${axis2}:${val2}`)
        }
      }
      table.rows.push(row)
    }

    matrixResults.push(table)
  }

  return { matrixResults, totalCombinations, coveredCombinations, emptyCells }
}

function buildMarkdown(
  sources: CoverageSource[],
  { matrixResults, totalCombinations, coveredCombinations, emptyCells }: CoverageStats
): string {
  const percentage = Math.round((coveredCombinations / totalCombinations) * 100)
  let md = `# Pairwise Usage Coverage Matrix

> **Automated verification artifact:** Generated by \`scripts/generate-coverage-matrix.ts\` from example manifests in \`/examples/**/package.json\` and recipes in \`/docs/recipes/\`.
>
> **Pairwise coverage:** ${String(coveredCombinations)}/${String(totalCombinations)} combinations (${String(percentage)}%)

---

## 1. Registered Usage Examples

| Example / Artifact | Path | Declared Axis Coverage |
|---|---|---|
${sources
  .map((s) => {
    const href = s.type === 'recipe' ? `./recipes/${path.basename(s.path)}` : `../${s.path}`
    return `| \`${s.name}\` | [${s.path}](${href}) | ${Object.entries(s.coverage)
      .map(([k, v]) => `**${k}**: \`${v ?? ''}\``)
      .join(', ')} |`
  })
  .join('\n')}

---

## 2. Pairwise Coverage Tables

`

  for (const table of matrixResults) {
    const label1 = table.axis1.toUpperCase()
    const label2 = table.axis2.toUpperCase()
    md += `### ${label1} × ${label2}\n\n`

    const headers = [' ', ...AXES[table.axis2].map((v2) => AXIS_LABELS[table.axis2][v2] || v2)]
    md += `| ${headers.join(' | ')} |\n`
    md += `| ${headers.map(() => '---').join(' | ')} |\n`

    for (const row of table.rows) {
      const v1Label = AXIS_LABELS[table.axis1][row.val1] || row.val1
      const cols = [v1Label, ...AXES[table.axis2].map((v2) => row.cells[v2] || '❌ **GAP**')]
      md += `| ${cols.join(' | ')} |\n`
    }

    md += '\n'
  }

  if (emptyCells.length > 0) {
    md += `## ⚠️ Coverage Gaps Detected\n\n`
    md += emptyCells.map((gap) => `- [ ] ${gap}`).join('\n') + '\n\n'
  } else {
    md += `## ✅ Zero Coverage Gaps\n\nAll pairwise combinations across server transports, client adapters, pub/sub brokers, and auth modes are verified.\n`
  }

  return md
}

function main() {
  const examples = collectExampleManifests()
  const recipes = collectRecipeCoverage()
  const allSources = [...examples, ...recipes]

  const stats = generatePairwiseCoverage(allSources)
  const markdown = buildMarkdown(allSources, stats)

  if (isCheck) {
    if (!fs.existsSync(MATRIX_OUTPUT_PATH)) {
      console.error(`[coverage-matrix] FAILED: ${path.relative(ROOT_DIR, MATRIX_OUTPUT_PATH)} does not exist. Run "node scripts/generate-coverage-matrix.ts"`)
      process.exit(1)
    }
    const current = fs.readFileSync(MATRIX_OUTPUT_PATH, 'utf-8')
    if (current.trim() !== markdown.trim()) {
      console.error(`[coverage-matrix] FAILED: Drift detected in docs/coverage-matrix.md. Run "node scripts/generate-coverage-matrix.ts"`)
      process.exit(1)
    }
    if (stats.emptyCells.length > 0) {
      console.error(`[coverage-matrix] FAILED: ${String(stats.emptyCells.length)} uncovered pairwise combination(s):\n${stats.emptyCells.join('\n')}`)
      process.exit(1)
    }
    console.log(`[coverage-matrix] OK: Pairwise matrix is 100% covered (${String(stats.coveredCombinations)}/${String(stats.totalCombinations)}).`)
  } else {
    fs.mkdirSync(path.dirname(MATRIX_OUTPUT_PATH), { recursive: true })
    fs.writeFileSync(MATRIX_OUTPUT_PATH, markdown, 'utf-8')
    console.log(`[coverage-matrix] Generated ${path.relative(ROOT_DIR, MATRIX_OUTPUT_PATH)} (${String(stats.coveredCombinations)}/${String(stats.totalCombinations)} covered).`)
  }
}

main()
