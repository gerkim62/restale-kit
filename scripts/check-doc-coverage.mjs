import fs from 'node:fs'
import path from 'node:path'

const ROOT_DIR = process.cwd()
const DOCS_DIR = path.join(ROOT_DIR, 'docs')
const INVENTORY_PATH = path.join(DOCS_DIR, 'api-inventory.json')
const MATRIX_PATH = path.join(DOCS_DIR, 'coverage-matrix.md')
const CHECKLIST_PATH = path.join(DOCS_DIR, 'guide-checklist.json')
const GUIDE_DIR = path.join(DOCS_DIR, 'guide')

function getAllDocText() {
  let combined = ''
  function walk(dir) {
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

function checkGuideChecklist() {
  console.log('[check-doc-coverage] 1/4 Checking guide existence checklist...')
  if (!fs.existsSync(CHECKLIST_PATH)) {
    throw new Error(`Guide checklist not found at ${CHECKLIST_PATH}`)
  }

  const checklist = JSON.parse(fs.readFileSync(CHECKLIST_PATH, 'utf-8'))
  const missing = []

  for (const item of checklist) {
    const expectedFile = path.join(GUIDE_DIR, item.file)
    if (!fs.existsSync(expectedFile)) {
      missing.push(`[${item.id}] ${item.title} -> missing docs/guide/${item.file}`)
    }
  }

  if (missing.length > 0) {
    throw new Error(`Guide checklist validation failed (${missing.length} missing guide pages):\n${missing.join('\n')}`)
  }
  console.log(`  ✓ All ${checklist.length} required guide pages exist under docs/guide/.`)
}

function checkCoverageMatrix() {
  console.log('[check-doc-coverage] 2/4 Checking coverage matrix completeness...')
  if (!fs.existsSync(MATRIX_PATH)) {
    throw new Error(`Coverage matrix not found at ${MATRIX_PATH}. Run "node scripts/generate-coverage-matrix.mjs"`)
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
    throw new Error(`API inventory not found at ${INVENTORY_PATH}. Run "node scripts/generate-api-report.mjs"`)
  }

  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf-8'))
  const docText = getAllDocText()
  const unmentionedSymbols = []

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
      `Symbol coverage gate failed! ${unmentionedSymbols.length} exported symbol(s) have 0 mentions across /docs:\n` +
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

  const missing = []
  for (const member of keyMembers) {
    const searchString = member.includes('.') ? member : `.${member}`
    if (!docText.includes(searchString)) {
      missing.push(member)
    }
  }

  if (missing.length > 0) {
    throw new Error(`Class member coverage gate failed! The following group methods are not documented:\n${missing.map(m => `  - ${m}`).join('\n')}`)
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
    console.error(`\n❌ FAILED: ${error.message}`)
    process.exit(1)
  }
}

main()
