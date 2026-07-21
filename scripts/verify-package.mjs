import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packageDirectory = join(root, 'restale-kit')
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'restale-kit-package-'))
const npmCache = join(temporaryDirectory, 'npm-cache')
const environment = { ...process.env, npm_config_cache: npmCache }

function run(command, arguments_, options = {}) {
  execFileSync(command, arguments_, {
    stdio: 'inherit',
    env: environment,
    ...options,
  })
}

try {
  run('npm', ['pack', '--pack-destination', temporaryDirectory], { cwd: packageDirectory })
  const tarball = readdirSync(temporaryDirectory).find((file) => file.endsWith('.tgz'))
  if (!tarball) throw new Error('npm pack did not create a tarball')

  run('npm', ['init', '--yes'], { cwd: temporaryDirectory })
  writeFileSync(
    join(temporaryDirectory, 'package.json'),
    JSON.stringify({ name: 'restale-kit-consumer-smoke', private: true, type: 'module' }, null, 2) + '\n'
  )
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      `./${tarball}`,
      'react',
      '@tanstack/react-query',
      'swr',
      'ioredis',
      'ably',
      'pusher',
      'typescript',
      '@types/react',
      '@types/react-dom',
    ],
    { cwd: temporaryDirectory }
  )

  writeFileSync(
    join(temporaryDirectory, 'imports.mjs'),
    `const entryPoints = [
  'restale-kit',
  'restale-kit/server',
  'restale-kit/node',
  'restale-kit/fetch',
  'restale-kit/client',
  'restale-kit/react',
  'restale-kit/swr',
  'restale-kit/tanstack-query',
  'restale-kit/pubsub',
  'restale-kit/redis',
  'restale-kit/ably',
  'restale-kit/pusher',
  'restale-kit/express',
  'restale-kit/fastify',
  'restale-kit/hono',
]

await Promise.all(entryPoints.map((entryPoint) => import(entryPoint)))
console.log('All public entry points imported successfully.')
`
  )
  run('node', ['imports.mjs'], { cwd: temporaryDirectory })

  // Type-check the imports to validate declaration exports
  writeFileSync(
    join(temporaryDirectory, 'types.ts'),
    `import type {
  JSONValue,
  InvalidateSignal,
  RevokeEventDetail,
  RenewEventDetail,
  ChannelClosedError,
  SchemaValidationError,
} from 'restale-kit'
import type { SSEChannel } from 'restale-kit/server'
import type { SSEInvalidatorClient } from 'restale-kit/client'
import type { UseReStaleResult } from 'restale-kit/react'

// Verify types are properly exported and resolved
const _testTypes: JSONValue = 'test'
const _testSignal: InvalidateSignal = { key: ['test'] }
const _testRevoke: RevokeEventDetail = { reason: 'deadline' }
const _testRenew: RenewEventDetail = { reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 }
`
  )
  writeFileSync(
    join(temporaryDirectory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'Node16',
        moduleResolution: 'Node16',
        skipLibCheck: false,
        strict: true,
        noEmit: true,
      },
      include: ['types.ts'],
    }, null, 2) + '\n'
  )
  run('npx', ['tsc', '--noEmit'], { cwd: temporaryDirectory })
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}
