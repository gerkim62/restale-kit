import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function getTsCompiler() {
  const ROOT_DIR = process.cwd()
  const pnpmDir = path.join(ROOT_DIR, 'node_modules', '.pnpm')
  if (fs.existsSync(pnpmDir)) {
    for (const dir of fs.readdirSync(pnpmDir)) {
      if (dir.startsWith('typescript@')) {
        const candidate = path.join(pnpmDir, dir, 'node_modules', 'typescript', 'lib', 'typescript.js')
        if (fs.existsSync(candidate)) {
          try {
            const mod = require(candidate)
            if (typeof mod.createProgram === 'function') return mod
          } catch {
            // try next candidate
          }
        }
      }
    }
  }
  try {
    const mod = require('typescript')
    if (typeof mod.createProgram === 'function') return mod
  } catch {
    // try fallback
  }
  throw new Error('Could not load TypeScript compiler API')
}

const ts = getTsCompiler()

const ROOT_DIR = process.cwd()
const PKG_DIR = path.join(ROOT_DIR, 'restale-kit')
const PKG_JSON_PATH = path.join(PKG_DIR, 'package.json')
const INVENTORY_PATH = path.join(ROOT_DIR, 'docs', 'api-inventory.json')

const isCheck = process.argv.includes('--check')

function getExportEntrypoints() {
  const pkgJson = JSON.parse(fs.readFileSync(PKG_JSON_PATH, 'utf-8'))
  const exportsMap = pkgJson.exports || {}
  const entrypoints = []

  for (const [subpath, config] of Object.entries(exportsMap)) {
    const typesPath = typeof config === 'string' ? config : config.types
    if (typesPath) {
      const fullTypesPath = path.resolve(PKG_DIR, typesPath)
      entrypoints.push({
        subpath,
        exportName: subpath === '.' ? 'restale-kit' : `restale-kit/${subpath.replace(/^\.\//, '')}`,
        typesFile: fullTypesPath,
      })
    }
  }

  return entrypoints
}

function analyzeSymbols() {
  const entrypoints = getExportEntrypoints()
  const fileNames = entrypoints.map(e => e.typesFile).filter(f => fs.existsSync(f))

  if (fileNames.length === 0) {
    throw new Error('No .d.ts files found. Run "pnpm --filter restale-kit build" first.')
  }

  const program = ts.createProgram(fileNames, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
  })

  const checker = program.getTypeChecker()
  const inventory = {
    generatedAt: new Date().toISOString(),
    entrypoints: {},
    allSymbols: [],
  }

  for (const entry of entrypoints) {
    const symbols = []
    const sourceFile = program.getSourceFile(entry.typesFile)

    if (sourceFile) {
      const fileSymbol = checker.getSymbolAtLocation(sourceFile)
      if (fileSymbol) {
        const exports = checker.getExportsOfModule(fileSymbol)
        for (const exp of exports) {
          const symbolName = exp.getName()
          const flags = exp.getFlags()
          let kind = 'symbol'

          if (flags & ts.SymbolFlags.Class) kind = 'class'
          else if (flags & ts.SymbolFlags.Function) kind = 'function'
          else if (flags & ts.SymbolFlags.Interface) kind = 'interface'
          else if (flags & ts.SymbolFlags.TypeAlias) kind = 'type'
          else if (flags & ts.SymbolFlags.Variable) kind = 'constant'

          const members = []

          // If class or interface, walk public members
          const decl = exp.valueDeclaration || exp.declarations?.[0]
          if (decl) {
            const type = checker.getTypeOfSymbolAtLocation(exp, decl)
            const typeProps = checker.getPropertiesOfType(type)

            for (const prop of typeProps) {
              const propName = prop.getName()
              if (propName.startsWith('_') || propName.startsWith('private')) continue

              const subMembers = []
              const propDecl = prop.valueDeclaration || prop.declarations?.[0]
              if (propDecl) {
                const propType = checker.getTypeOfSymbolAtLocation(prop, propDecl)
                const nestedProps = checker.getPropertiesOfType(propType)
                for (const np of nestedProps) {
                  const npName = np.getName()
                  if (!npName.startsWith('_')) {
                    subMembers.push(npName)
                  }
                }
              }

              members.push({
                name: propName,
                members: subMembers.length > 0 ? subMembers : undefined,
              })
            }
          }

          symbols.push({
            name: symbolName,
            kind,
            members: members.length > 0 ? members : undefined,
          })

          inventory.allSymbols.push({
            name: symbolName,
            entrypoint: entry.exportName,
            kind,
          })

          // Add class/member paths for symbol lookup
          for (const m of members) {
            inventory.allSymbols.push({
              name: `${symbolName}.${m.name}`,
              entrypoint: entry.exportName,
              kind: 'class-member',
            })
            if (m.members) {
              for (const sm of m.members) {
                inventory.allSymbols.push({
                  name: `${symbolName}.${m.name}.${sm}`,
                  entrypoint: entry.exportName,
                  kind: 'nested-member',
                })
              }
            }
          }
        }
      }
    }

    inventory.entrypoints[entry.exportName] = {
      subpath: entry.subpath,
      symbols,
    }
  }

  return inventory
}

function main() {
  const inventory = analyzeSymbols()
  const inventoryJson = JSON.stringify(inventory, null, 2) + '\n'

  if (isCheck) {
    if (!fs.existsSync(INVENTORY_PATH)) {
      console.error(`[generate-api-report] FAILED: ${path.relative(ROOT_DIR, INVENTORY_PATH)} does not exist. Run "node scripts/generate-api-report.mjs"`)
      process.exit(1)
    }
    const current = fs.readFileSync(INVENTORY_PATH, 'utf-8')
    // Compare ignoring generatedAt timestamp
    const currentObj = JSON.parse(current)
    const newObj = JSON.parse(inventoryJson)
    delete currentObj.generatedAt
    delete newObj.generatedAt

    if (JSON.stringify(currentObj) !== JSON.stringify(newObj)) {
      console.error(`[generate-api-report] FAILED: API surface drift detected in docs/api-inventory.json. Run "node scripts/generate-api-report.mjs"`)
      process.exit(1)
    }
    console.log('[generate-api-report] OK: API inventory matches current package exports.')
  } else {
    fs.mkdirSync(path.dirname(INVENTORY_PATH), { recursive: true })
    fs.writeFileSync(INVENTORY_PATH, inventoryJson, 'utf-8')
    console.log(`[generate-api-report] Generated ${path.relative(ROOT_DIR, INVENTORY_PATH)} with ${inventory.allSymbols.length} indexed symbols.`)
  }
}

main()
