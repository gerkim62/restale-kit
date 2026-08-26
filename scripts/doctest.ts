import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT_DIR = process.cwd()
const DOCS_DIR = path.join(ROOT_DIR, 'docs')
const DOCTEST_DIR = path.join(ROOT_DIR, 'restale-kit', 'src', '__tests__', 'doctest')

interface DoctestCase {
  testName: string
  code: string
  index: number
}

function getAllMarkdownFiles(dir: string): string[] {
  const results: string[] = []
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

function extractDoctests(filePath: string): DoctestCase[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  // Match ```ts doctest ... ``` or ```typescript doctest ... ```
  const doctestRegex = /```(?:ts|typescript)\s+doctest(?::([a-zA-Z0-9_-]+))?\s*\n([\s\S]*?)```/g
  const tests: DoctestCase[] = []
  let match: RegExpExecArray | null
  let index = 0

  while ((match = doctestRegex.exec(content)) !== null) {
    index++
    const testName = match[1] || `snippet_${String(index)}`
    const code = match[2]
    tests.push({ testName, code, index })
  }

  return tests
}

function generateTestFile(relPath: string, tests: DoctestCase[]): string {
  const safeName = relPath.replace(/[^a-zA-Z0-9]/g, '_')
  const testFilePath = path.join(DOCTEST_DIR, `${safeName}.test.ts`)

  let allImports = `// Auto-generated doctest from ${relPath}\nimport { describe, it, expect, vi } from 'vitest'\n`
  let testCases = `\ndescribe('Doctest: ${relPath}', () => {\n`

  for (const t of tests) {
    const lines = t.code.split('\n')
    const importLines: string[] = []
    const bodyLines: string[] = []

    for (const line of lines) {
      if (/^\s*import\s+/.test(line) || /^\s*export\s+/.test(line)) {
        importLines.push(line.replace(/^\s*export\s+/, ''))
      } else {
        bodyLines.push(line)
      }
    }

    if (importLines.length > 0) {
      allImports += importLines.join('\n') + '\n'
    }

    testCases += `  it('${t.testName}', async () => {\n`
    testCases += bodyLines.map((l) => `    ${l}`).join('\n') + '\n'
    testCases += `  })\n\n`
  }

  testCases += `})\n`

  fs.writeFileSync(testFilePath, allImports + testCases, 'utf-8')
  return testFilePath
}

function main() {
  const mdFiles = getAllMarkdownFiles(DOCS_DIR)
  let totalTests = 0
  const generatedFiles: string[] = []

  if (fs.existsSync(DOCTEST_DIR)) {
    fs.rmSync(DOCTEST_DIR, { recursive: true, force: true })
  }
  fs.mkdirSync(DOCTEST_DIR, { recursive: true })

  for (const file of mdFiles) {
    const relPath = path.relative(ROOT_DIR, file)
    const tests = extractDoctests(file)
    if (tests.length > 0) {
      totalTests += tests.length
      const testFile = generateTestFile(relPath, tests)
      generatedFiles.push(testFile)
    }
  }

  if (totalTests === 0) {
    console.log('[doctest] No doctest fences (```ts doctest) found in docs. Checked ' + String(mdFiles.length) + ' markdown files.')
    return
  }

  console.log(`[doctest] Running ${String(totalTests)} doctest spec(s) across ${String(generatedFiles.length)} doc files...`)

  try {
    execSync(`pnpm --filter restale-kit exec vitest run src/__tests__/doctest`, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    })
    console.log(`[doctest] OK: All ${String(totalTests)} doctest specs passed.`)
  } catch {
    console.error(`[doctest] FAILED: Some doctests failed.`)
    process.exit(1)
  } finally {
    if (fs.existsSync(DOCTEST_DIR)) {
      fs.rmSync(DOCTEST_DIR, { recursive: true, force: true })
    }
  }
}

main()
