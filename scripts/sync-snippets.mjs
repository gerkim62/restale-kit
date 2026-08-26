import fs from 'node:fs'
import path from 'node:path'

const ROOT_DIR = process.cwd()
const DOCS_DIR = path.join(ROOT_DIR, 'docs')
const SNIPPETS_DIR = path.join(ROOT_DIR, 'snippets')

const isCheck = process.argv.includes('--check')

function getAllMarkdownFiles(dir) {
  const results = []
  if (!fs.existsSync(dir)) return results
  const list = fs.readdirSync(dir)
  for (const file of list) {
    const filePath = path.join(dir, file)
    const stat = fs.statSync(filePath)
    if (stat.isDirectory()) {
      results.push(...getAllMarkdownFiles(filePath))
    } else if (file.endsWith('.md')) {
      results.push(filePath)
    }
  }
  return results
}

function findSnippetFile(name) {
  const tsPath = path.join(SNIPPETS_DIR, `${name}.ts`)
  if (fs.existsSync(tsPath)) return tsPath
  const tsxPath = path.join(SNIPPETS_DIR, `${name}.tsx`)
  if (fs.existsSync(tsxPath)) return tsxPath
  const jsPath = path.join(SNIPPETS_DIR, `${name}.js`)
  if (fs.existsSync(jsPath)) return jsPath
  return null
}

function processMarkdownFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8')
  let modified = content
  let hasErrors = false
  const changes = []

  // Pattern: <!-- snippet:start name -->...<!-- snippet:end -->
  const snippetRegex = /<!--\s*snippet:start\s+([a-zA-Z0-9_-]+)\s*-->([\s\S]*?)<!--\s*snippet:end\s*-->/g

  modified = content.replace(snippetRegex, (_match, snippetName) => {
    const snippetPath = findSnippetFile(snippetName)
    if (!snippetPath) {
      console.error(`[sync-snippets] ERROR: Unknown snippet "${snippetName}" referenced in ${filePath}`)
      hasErrors = true
      return _match
    }

    const snippetSource = fs.readFileSync(snippetPath, 'utf-8').trim()
    const ext = path.extname(snippetPath).slice(1) || 'ts'
    const newBlock = `<!-- snippet:start ${snippetName} -->\n\`\`\`${ext}\n${snippetSource}\n\`\`\`\n<!-- snippet:end -->`

    if (_match !== newBlock) {
      changes.push({ snippetName, filePath })
    }

    return newBlock
  })

  return { modified, hasErrors, changes }
}

function main() {
  const mdFiles = getAllMarkdownFiles(DOCS_DIR)
  let totalChanges = 0
  let totalErrors = 0

  for (const file of mdFiles) {
    const { modified, hasErrors, changes } = processMarkdownFile(file)
    if (hasErrors) totalErrors++

    if (changes.length > 0) {
      totalChanges += changes.length
      const relFile = path.relative(ROOT_DIR, file)
      if (isCheck) {
        console.error(`[sync-snippets] DRIFT DETECTED in ${relFile}: ${changes.map(c => c.snippetName).join(', ')}`)
      } else {
        fs.writeFileSync(file, modified, 'utf-8')
        console.log(`[sync-snippets] Synced ${changes.length} snippet(s) in ${relFile}`)
      }
    }
  }

  if (totalErrors > 0) {
    console.error(`[sync-snippets] FAILED: Encountered ${totalErrors} error(s).`)
    process.exit(1)
  }

  if (isCheck && totalChanges > 0) {
    console.error(`[sync-snippets] FAILED: ${totalChanges} snippet block(s) are out of sync with /snippets/. Run "node scripts/sync-snippets.mjs" to update.`)
    process.exit(1)
  }

  if (isCheck) {
    console.log(`[sync-snippets] OK: All snippet blocks match /snippets/*.ts source files.`)
  } else {
    console.log(`[sync-snippets] Completed. ${totalChanges} snippet block(s) updated.`)
  }
}

main()
