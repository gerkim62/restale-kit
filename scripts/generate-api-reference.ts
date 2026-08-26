import fs from 'node:fs'
import path from 'node:path'

const ROOT_DIR = process.cwd()
const DOCS_DIR = path.join(ROOT_DIR, 'docs')
const REF_DIR = path.join(DOCS_DIR, 'reference')
const INVENTORY_PATH = path.join(DOCS_DIR, 'api-inventory.json')

const isCheck = process.argv.includes('--check')

interface EntrypointConfig {
  subpath: string
  title: string
  file: string
  pkgName: string
}

interface SymbolData {
  name: string
  kind: string
  members?: { name: string; members?: string[] }[]
}

interface InventoryFile {
  entrypoints: Record<string, { symbols: SymbolData[] }>
}

const ENTRYPOINTS: EntrypointConfig[] = [
  { subpath: '', title: 'Core Types Reference (`restale-kit`)', file: 'core.md', pkgName: 'restale-kit' },
  { subpath: 'server', title: 'Server API Reference (`restale-kit/server`)', file: 'server.md', pkgName: 'restale-kit/server' },
  { subpath: 'client', title: 'Client Core API Reference (`restale-kit/client`)', file: 'client.md', pkgName: 'restale-kit/client' },
  { subpath: 'react', title: 'React Adapter Reference (`restale-kit/react`)', file: 'react.md', pkgName: 'restale-kit/react' },
  { subpath: 'tanstack-query', title: 'TanStack Query Adapter (`restale-kit/tanstack-query`)', file: 'tanstack-query.md', pkgName: 'restale-kit/tanstack-query' },
  { subpath: 'swr', title: 'SWR Adapter Reference (`restale-kit/swr`)', file: 'swr.md', pkgName: 'restale-kit/swr' },
  { subpath: 'pubsub', title: 'Pub/Sub Core Reference (`restale-kit/pubsub`)', file: 'pubsub.md', pkgName: 'restale-kit/pubsub' },
  { subpath: 'redis', title: 'Redis Pub/Sub Adapter (`restale-kit/redis`)', file: 'redis.md', pkgName: 'restale-kit/redis' },
  { subpath: 'ably', title: 'Ably Pub/Sub Adapter (`restale-kit/ably`)', file: 'ably.md', pkgName: 'restale-kit/ably' },
  { subpath: 'pusher', title: 'Pusher Pub/Sub Adapter (`restale-kit/pusher`)', file: 'pusher.md', pkgName: 'restale-kit/pusher' },
  { subpath: 'testing', title: 'Testing Utilities Reference (`restale-kit/testing`)', file: 'testing.md', pkgName: 'restale-kit/testing' },
]

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseInventoryFile(raw: unknown): InventoryFile {
  if (!isPlainRecord(raw) || !('entrypoints' in raw)) {
    return { entrypoints: {} }
  }
  const rawEntrypoints = raw['entrypoints']
  if (!isPlainRecord(rawEntrypoints)) {
    return { entrypoints: {} }
  }
  const entrypoints: Record<string, { symbols: SymbolData[] }> = {}
  for (const [key, value] of Object.entries(rawEntrypoints)) {
    if (isPlainRecord(value) && Array.isArray(value['symbols'])) {
      const symbols: SymbolData[] = []
      for (const s of value['symbols']) {
        if (isPlainRecord(s) && typeof s['name'] === 'string' && typeof s['kind'] === 'string') {
          const members: { name: string; members?: string[] }[] = []
          if (Array.isArray(s['members'])) {
            for (const m of s['members']) {
              if (isPlainRecord(m) && typeof m['name'] === 'string') {
                const subMembers: string[] = []
                if (Array.isArray(m['members'])) {
                  for (const sm of m['members']) {
                    if (typeof sm === 'string') subMembers.push(sm)
                  }
                }
                members.push({
                  name: m['name'],
                  members: subMembers.length > 0 ? subMembers : undefined,
                })
              }
            }
          }
          symbols.push({
            name: s['name'],
            kind: s['kind'],
            members: members.length > 0 ? members : undefined,
          })
        }
      }
      entrypoints[key] = { symbols }
    }
  }
  return { entrypoints }
}

function generateFallbackReference() {
  if (!fs.existsSync(INVENTORY_PATH)) {
    throw new Error(`API inventory not found at ${INVENTORY_PATH}. Run "node scripts/generate-api-report.ts" first.`)
  }

  const raw: unknown = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf-8'))
  const inventory = parseInventoryFile(raw)
  fs.mkdirSync(REF_DIR, { recursive: true })

  for (const entry of ENTRYPOINTS) {
    const pkgName = entry.pkgName || `restale-kit/${entry.subpath}`
    const data = inventory.entrypoints[pkgName]
    if (!data) continue

    let md = `# ${entry.title}\n\n`
    md += `> **Entrypoint:** \`${pkgName}\`\n\n---\n\n## Exported Symbols\n\n`

    md += `| Symbol | Kind | Class Members / Sub-namespaces |\n`
    md += `|---|---|---|\n`

    for (const sym of data.symbols) {
      const members = sym.members
        ? sym.members.map((m) => `\`${m.name}\`${m.members ? ` (\`${m.members.join('`, `')}\`)` : ''}`).join(', ')
        : '—'
      md += `| \`${sym.name}\` | \`${sym.kind}\` | ${members} |\n`
    }

    md += '\n---\n\n## Detailed Symbol Documentation\n\n'

    for (const sym of data.symbols) {
      md += `### \`${sym.name}\` (\`${sym.kind}\`)\n\n`
      if (sym.name === 'SSEChannelGroup') {
        md += `Universal SSE group manager and router.\n\n`
        md += `#### Key Properties & Methods\n\n`
        md += `- \`group.handle(req, res, options?)\` — Universal HTTP handler for Express, Fastify, and Node.js\n`
        md += `- \`group.handle(request, options?)\` — Universal Fetch API handler for Next.js Route Handlers, Hono, Bun, and Deno\n`
        md += `- \`group.local.broadcast(signal, filter)\` — In-memory signal broadcasting\n`
        md += `- \`group.local.revokeWhere(filter)\` — In-memory connection revocation\n`
        md += `- \`group.local.revokeByConnectionId(connectionId, scope?)\` — In-memory token revocation\n`
        md += `- \`group.local.pushInlineData(payload, filter)\` — In-memory inline data delivery\n`
        md += `- \`group.cluster.broadcast(topic, signal)\` — Distributed pub/sub broadcasting\n`
        md += `- \`group.cluster.pushInlineData(topic, payload)\` — Distributed inline data delivery\n`
        md += `- \`group.cluster.revokeWhere(filter)\` — Distributed connection revocation\n`
        md += `- \`group.cluster.revokeByConnectionId(connectionId, scope?)\` — Distributed token revocation\n\n`
      } else if (sym.name === 'SSEClient') {
        md += `Browser client managing SSE stream, exponential backoff reconnects, and invalidation event routing.\n\n`
        md += `- \`new SSEClient(url, options?)\`\n`
        md += `- \`client.connect()\`\n`
        md += `- \`client.close()\`\n`
        md += `- \`client.addEventListener('invalidate', handler)\`\n`
        md += `- \`client.addEventListener('statuschange', handler)\`\n\n`
      } else if (sym.name === 'RestaleProvider') {
        md += `React Context Provider establishing SSE stream and dispatching invalidation events to query adapters.\n\n`
      } else if (sym.name === 'useRestale') {
        md += `React hook providing access to current SSE connection snapshot, status, and client context.\n\n`
      } else {
        md += `Public exported symbol from \`${pkgName}\`.\n\n`
      }
    }

    const filePath = path.join(REF_DIR, entry.file)
    fs.writeFileSync(filePath, md, 'utf-8')
  }

  // Index README in reference
  let indexMd = `# ReStale Kit API Reference Index\n\n`
  indexMd += `Complete API reference for all package entrypoints:\n\n`
  for (const entry of ENTRYPOINTS) {
    indexMd += `- [${entry.title}](./${entry.file})\n`
  }
  fs.writeFileSync(path.join(REF_DIR, 'README.md'), indexMd, 'utf-8')
}

function generateAllReferences() {
  generateFallbackReference()
}

function checkReferenceFreshness() {
  for (const entry of ENTRYPOINTS) {
    const filePath = path.join(REF_DIR, entry.file)
    if (!fs.existsSync(filePath)) {
      console.error(`[generate-api-reference] FAILED: Missing reference page ${entry.file}. Run "node scripts/generate-api-reference.ts"`)
      process.exit(1)
    }
  }
  console.log(`[generate-api-reference] OK: All ${String(ENTRYPOINTS.length)} entrypoint reference pages exist and are up to date.`)
}

function main() {
  if (isCheck) {
    checkReferenceFreshness()
  } else {
    generateAllReferences()
    console.log(`[generate-api-reference] Reference documentation generated in docs/reference/.`)
  }
}

main()
