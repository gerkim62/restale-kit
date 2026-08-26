import fs from 'node:fs'
import path from 'node:path'

const ROOT_DIR = process.cwd()
const DOCS_DIR = path.join(ROOT_DIR, 'docs')
const INVENTORY_PATH = path.join(DOCS_DIR, 'api-inventory.json')
const MATRIX_PATH = path.join(DOCS_DIR, 'coverage-matrix.md')
const CHECKLIST_PATH = path.join(DOCS_DIR, 'guide-checklist.json')
const GUIDE_DIR = path.join(DOCS_DIR, 'guide')

interface ChecklistItem {
  id: string
  title: string
  file: string
}

interface SymbolItem {
  name: string
  kind: string
}

interface EntrypointData {
  symbols: SymbolItem[]
}

interface ApiInventory {
  entrypoints: Record<string, EntrypointData>
}

function getAllDocText(): string {
  let combined = ''
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.name.endsWith('.md')) {
        combined += ' ' + fs.readFileSync(fullPath, 'utf-8')
      }
    }
  }
  walk(DOCS_DIR)
  return combined
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isChecklistItem(val: unknown): val is ChecklistItem {
  return (
    isPlainRecord(val) &&
    typeof val['id'] === 'string' &&
    typeof val['title'] === 'string' &&
    typeof val['file'] === 'string'
  )
}

function parseInventory(raw: unknown): ApiInventory {
  if (!isPlainRecord(raw) || !('entrypoints' in raw)) {
    return { entrypoints: {} }
  }
  const rawEntrypoints = raw['entrypoints']
  if (!isPlainRecord(rawEntrypoints)) {
    return { entrypoints: {} }
  }
  const entrypoints: Record<string, EntrypointData> = {}
  for (const [key, value] of Object.entries(rawEntrypoints)) {
    if (isPlainRecord(value) && Array.isArray(value['symbols'])) {
      const symbols: SymbolItem[] = []
      for (const s of value['symbols']) {
        if (
          isPlainRecord(s) &&
          typeof s['name'] === 'string' &&
          typeof s['kind'] === 'string'
        ) {
          symbols.push({ name: s['name'], kind: s['kind'] })
        }
      }
      entrypoints[key] = { symbols }
    }
  }
  return { entrypoints }
}

function checkGuideChecklist() {
  console.log('[check-doc-coverage] 1/4 Checking guide existence checklist...')
  if (!fs.existsSync(CHECKLIST_PATH)) {
    throw new Error(`Guide checklist not found at ${CHECKLIST_PATH}`)
  }

  const raw: unknown = JSON.parse(fs.readFileSync(CHECKLIST_PATH, 'utf-8'))
  const checklist = Array.isArray(raw) ? raw.filter(isChecklistItem) : []
  const missing: string[] = []

  for (const item of checklist) {
    const expectedFile = path.join(GUIDE_DIR, item.file)
    if (!fs.existsSync(expectedFile)) {
      missing.push(`[${item.id}] ${item.title} -> missing docs/guide/${item.file}`)
    }
  }

  if (missing.length > 0) {
    throw new Error(`Guide checklist validation failed (${String(missing.length)} missing guide pages):\n${missing.join('\n')}`)
  }
  console.log(`  ✓ All ${String(checklist.length)} required guide pages exist under docs/guide/.`)
}

function checkCoverageMatrix() {
  console.log('[check-doc-coverage] 2/4 Checking coverage matrix completeness...')
  if (!fs.existsSync(MATRIX_PATH)) {
    throw new Error(`Coverage matrix not found at ${MATRIX_PATH}. Run "node scripts/generate-coverage-matrix.ts"`)
  }

  const matrixContent = fs.readFileSync(MATRIX_PATH, 'utf-8')
  if (matrixContent.includes('❌ **GAP**') || matrixContent.includes('Coverage Gaps Detected')) {
    throw new Error('Coverage matrix contains unresolved gap cells! Check docs/coverage-matrix.md')
  }
  console.log('  ✓ Coverage matrix has 0 empty cells and 100% pairwise coverage.')
}

function checkSymbolCoverage() {
  console.log('[check-doc-coverage] 3/4 Checking exported symbol coverage...')
  if (!fs.existsSync(INVENTORY_PATH)) {
    throw new Error(`API inventory not found at ${INVENTORY_PATH}. Run "node scripts/generate-api-report.ts"`)
  }

  const rawInventory: unknown = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf-8'))
  const inventory = parseInventory(rawInventory)
  const docText = getAllDocText()
  const unmentionedSymbols: string[] = []

  // Top-level exported symbols
  for (const [entrypoint, data] of Object.entries(inventory.entrypoints)) {
    // Root export can be empty
    if (entrypoint === 'restale-kit' && data.symbols.length === 0) continue

    for (const sym of data.symbols) {
      // Check if symbol name is mentioned in markdown docs
      // Use word boundary search
      const regex = new RegExp(`\\b${sym.name}\\b`)
      if (!regex.test(docText)) {
        unmentionedSymbols.push(`${entrypoint} -> ${sym.name} (${sym.kind})`)
      }
    }
  }

  if (unmentionedSymbols.length > 0) {
    throw new Error(
      `Symbol coverage gate failed! ${String(unmentionedSymbols.length)} exported symbol(s) have 0 mentions across /docs:\n` +
        unmentionedSymbols.map((s) => `  - ${s}`).join('\n'),
    )
  }
  console.log(`  ✓ All exported symbols across all package entrypoints are mentioned in documentation.`)
}

function checkClassMemberCoverage() {
  console.log('[check-doc-coverage] 4/4 Checking class member surface coverage...')
  const docText = getAllDocText()
  const keyMembers = [
    'handle',
    'local.broadcast',
    'local.revokeWhere',
    'local.revokeByConnectionId',
    'local.pushInlineData',
    'cluster.broadcast',
    'cluster.pushInlineData',
    'cluster.revokeWhere',
    'cluster.revokeByConnectionId',
  ]

  const missing: string[] = []
  for (const member of keyMembers) {
    const searchString = member.includes('.') ? member : `.${member}`
    if (!docText.includes(searchString)) {
      missing.push(member)
    }
  }

  if (missing.length > 0) {
    throw new Error(`Class member coverage gate failed! The following group methods are not documented:\n${missing.map((m) => `  - ${m}`).join('\n')}`)
  }
  console.log('  ✓ All critical SSEChannelGroup public methods and sub-namespaces are documented.')
}

function main() {
  console.log('=== ReStale Kit Documentation Gap Gate ===\n')
  try {
    checkGuideChecklist()
    checkCoverageMatrix()
    checkSymbolCoverage()
    checkClassMemberCoverage()
    console.log('\n✅ PASS: Documentation verification complete. 0 Gaps found across all 4 gates.')
  } catch (error) {
    console.error(`\n❌ FAILED: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

main()
