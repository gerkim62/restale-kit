import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

interface TsSymbol {
  getName(): string
  getFlags(): number
  valueDeclaration?: unknown
  declarations?: unknown[]
}

interface TsType {
  readonly _brand?: 'TsType'
}

interface TsSourceFile {
  readonly _brand?: 'TsSourceFile'
}

interface TsTypeChecker {
  getSymbolAtLocation(node: TsSourceFile): TsSymbol | undefined
  getExportsOfModule(symbol: TsSymbol): TsSymbol[]
  getTypeOfSymbolAtLocation(symbol: TsSymbol, location: unknown): TsType
  getPropertiesOfType(type: TsType): TsSymbol[]
}

interface TsProgram {
  getTypeChecker(): TsTypeChecker
  getSourceFile(fileName: string): TsSourceFile | undefined
}

interface TsCompilerApi {
  createProgram(rootNames: string[], options: Record<string, unknown>): TsProgram
  ScriptTarget: { ES2022: number }
  ModuleKind: { NodeNext: number }
  ModuleResolutionKind: { NodeNext: number }
  SymbolFlags: {
    Class: number
    Function: number
    Interface: number
    TypeAlias: number
    Variable: number
  }
}

function isTsCompilerApi(v: unknown): v is TsCompilerApi {
  if (!isPlainRecord(v)) return false
  return (
    typeof v['createProgram'] === 'function' &&
    isPlainRecord(v['ScriptTarget']) &&
    isPlainRecord(v['ModuleKind']) &&
    isPlainRecord(v['ModuleResolutionKind']) &&
    isPlainRecord(v['SymbolFlags'])
  )
}

function getTsCompiler(): TsCompilerApi {
  const ROOT_DIR = process.cwd()
  const pnpmDir = path.join(ROOT_DIR, 'node_modules', '.pnpm')
  if (fs.existsSync(pnpmDir)) {
    for (const dir of fs.readdirSync(pnpmDir)) {
      if (dir.startsWith('typescript@')) {
        const candidate = path.join(pnpmDir, dir, 'node_modules', 'typescript', 'lib', 'typescript.js')
        if (fs.existsSync(candidate)) {
          try {
            const mod: unknown = require(candidate)
            if (isTsCompilerApi(mod)) {
              return mod
            }
          } catch {
            // try next candidate
          }
        }
      }
    }
  }
  try {
    const mod: unknown = require('typescript')
    if (isTsCompilerApi(mod)) {
      return mod
    }
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

interface EntrypointInfo {
  subpath: string
  exportName: string
  typesFile: string
}

interface MemberInfo {
  name: string
  members?: string[] | undefined
}

interface SymbolInfo {
  name: string
  kind: string
  members?: MemberInfo[] | undefined
}

interface FlatSymbolInfo {
  name: string
  entrypoint: string
  kind: string
}

interface InventoryOutput {
  generatedAt: string
  entrypoints: Record<string, { subpath: string; symbols: SymbolInfo[] }>
  allSymbols: FlatSymbolInfo[]
}

function getExportEntrypoints(): EntrypointInfo[] {
  const rawPkg: unknown = JSON.parse(fs.readFileSync(PKG_JSON_PATH, 'utf-8'))
  const entrypoints: EntrypointInfo[] = []

  if (!isPlainRecord(rawPkg)) return entrypoints
  const exportsMap = rawPkg['exports']
  if (!isPlainRecord(exportsMap)) return entrypoints

  for (const [subpath, config] of Object.entries(exportsMap)) {
    let typesPath: string | undefined
    if (typeof config === 'string') {
      typesPath = config
    } else if (isPlainRecord(config) && typeof config['types'] === 'string') {
      typesPath = config['types']
    }
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

function analyzeSymbols(): InventoryOutput {
  const entrypoints = getExportEntrypoints()
  const fileNames = entrypoints.map((e) => e.typesFile).filter((f) => fs.existsSync(f))

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
  const inventory: InventoryOutput = {
    generatedAt: new Date().toISOString(),
    entrypoints: {},
    allSymbols: [],
  }

  for (const entry of entrypoints) {
    const symbols: SymbolInfo[] = []
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

          const members: MemberInfo[] = []

          // If class or interface, walk public members
          const decl = exp.valueDeclaration ?? exp.declarations?.[0]
          if (decl) {
            const type = checker.getTypeOfSymbolAtLocation(exp, decl)
            const typeProps = checker.getPropertiesOfType(type)

            for (const prop of typeProps) {
              const propName = prop.getName()
              if (
                propName.startsWith('_') ||
                propName.startsWith('private') ||
                propName === 'prototype' ||
                propName === 'captureStackTrace' ||
                propName === 'prepareStackTrace' ||
                propName === 'stackTraceLimit'
              ) {
                continue
              }

              const subMembers: string[] = []
              const propDecl = prop.valueDeclaration ?? prop.declarations?.[0]
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
      console.error(`[generate-api-report] FAILED: ${path.relative(ROOT_DIR, INVENTORY_PATH)} does not exist. Run "node scripts/generate-api-report.ts"`)
      process.exit(1)
    }
    const current = fs.readFileSync(INVENTORY_PATH, 'utf-8')
    const rawCurrent: unknown = JSON.parse(current)
    const rawNew: unknown = JSON.parse(inventoryJson)

    if (isPlainRecord(rawCurrent) && isPlainRecord(rawNew)) {
      delete rawCurrent['generatedAt']
      delete rawNew['generatedAt']

      if (JSON.stringify(rawCurrent) !== JSON.stringify(rawNew)) {
        console.error(`[generate-api-report] FAILED: API surface drift detected in docs/api-inventory.json. Run "node scripts/generate-api-report.ts"`)
        process.exit(1)
      }
    }
    console.log('[generate-api-report] OK: API inventory matches current package exports.')
  } else {
    fs.mkdirSync(path.dirname(INVENTORY_PATH), { recursive: true })
    fs.writeFileSync(INVENTORY_PATH, inventoryJson, 'utf-8')
    console.log(`[generate-api-report] Generated ${path.relative(ROOT_DIR, INVENTORY_PATH)} with ${String(inventory.allSymbols.length)} indexed symbols.`)
  }
}

main()
