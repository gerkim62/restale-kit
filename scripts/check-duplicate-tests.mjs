import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const regressionDir = path.join(rootDir, 'restale-kit', 'src', '__tests__', 'regression')

if (!fs.existsSync(regressionDir)) {
  console.error(`Error: Directory not found: ${regressionDir}`)
  process.exit(1)
}

const files = fs.readdirSync(regressionDir).filter((f) => !f.startsWith('.'))
if (files.length === 0) {
  console.error('Error: No regression test files found in ' + regressionDir)
  process.exit(1)
}

const hashMap = new Map()
let hasDuplicates = false

for (const file of files) {
  const filePath = path.join(regressionDir, file)
  if (!fs.statSync(filePath).isFile()) continue
  const content = fs.readFileSync(filePath)
  const hash = crypto.createHash('sha256').update(content).digest('hex')

  if (hashMap.has(hash)) {
    console.error(
      `Error: Duplicate test file detected: "${file}" is byte-identical to "${hashMap.get(hash)}" (hash: ${hash})`
    )
    hasDuplicates = true
  } else {
    hashMap.set(hash, file)
  }
}

if (hasDuplicates) {
  process.exit(1)
}

console.log(
  `[check-duplicate-tests] Passed: Verified ${files.length} unique test files in src/__tests__/regression/`
)
