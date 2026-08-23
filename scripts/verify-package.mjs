/**
 * Pre-release Package Verification Script
 *
 * Verifies that the packed npm tarball (`npm pack`) installs cleanly into an isolated
 * consumer project and that all public subpath entrypoints (`restale-kit`, `restale-kit/server`,
 * `restale-kit/client`, `restale-kit/react`, `restale-kit/tanstack-query`, `restale-kit/swr`, etc.)
 * can be imported at runtime and typechecked with strict TypeScript settings (`Node16` resolution).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDir, '..')
const packageDirectory = join(root, 'restale-kit')
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'restale-kit-package-'))

function run(command, arguments_, options = {}) {
  execFileSync(command, arguments_, {
    stdio: 'inherit',
    ...options,
  })
}

try {
  run('npm', ['pack', '--ignore-scripts', '--pack-destination', temporaryDirectory], { cwd: packageDirectory })
  const tarball = readdirSync(temporaryDirectory).find((file) => file.endsWith('.tgz'))
  if (!tarball) throw new Error('npm pack did not create a tarball')

  const sourceNodeModules = join(packageDirectory, 'node_modules')

  writeFileSync(
    join(temporaryDirectory, 'package.json'),
    JSON.stringify({ name: 'restale-kit-consumer-smoke', private: true, type: 'module' }, null, 2) + '\n'
  )

  if (existsSync(sourceNodeModules)) {
    const consumerNodeModules = join(temporaryDirectory, 'node_modules')
    const restalePackageDir = join(consumerNodeModules, 'restale-kit')
    mkdirSync(restalePackageDir, { recursive: true })
    run('tar', ['-xzf', join(temporaryDirectory, tarball), '-C', restalePackageDir, '--strip-components=1'])

    // Link peer/dev dependencies from existing node_modules for instant runtime and type-checking
    for (const item of readdirSync(sourceNodeModules)) {
      if (item === 'restale-kit' || item === '.bin' || item === '.pnpm') continue
      try {
        symlinkSync(join(sourceNodeModules, item), join(consumerNodeModules, item), 'junction')
      } catch {
        // ignore if exists
      }
    }
  } else {
    // In CI matrix or isolated environments without local node_modules, install tarball and peer/test types via npm
    run(
      'npm',
      [
        'install',
        '--no-audit',
        '--no-fund',
        join(temporaryDirectory, tarball),
        'typescript',
        '@types/node',
        '@types/react',
        '@tanstack/react-query',
        'react',
        'swr',
        'ioredis',
        'ably',
        'pusher',
      ],
      { cwd: temporaryDirectory }
    )
  }

  writeFileSync(
    join(temporaryDirectory, 'imports.mjs'),
    `const entryPoints = [
  'restale-kit',
  'restale-kit/server',
  'restale-kit/testing',
  'restale-kit/client',
  'restale-kit/react',
  'restale-kit/swr',
  'restale-kit/tanstack-query',
  'restale-kit/pubsub',
  'restale-kit/redis',
  'restale-kit/ably',
  'restale-kit/pusher',
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
  Signal,
  RevalidateSignal,
  RevokeEventDetail,
  RenewEventDetail,
  ChannelClosedError,
  SchemaValidationError,
  OnDeadlineAction,
} from 'restale-kit'
import type { SSEChannel, InlineDataResolver, SSEChannelGroupOptions } from 'restale-kit/server'
import type { createSSEChannel, SSEChannelOptions } from 'restale-kit/testing'
import type { SSEClient, AutoReconnectOptions } from 'restale-kit/client'
import type { UseRestaleResult } from 'restale-kit/react'
import type { TanStackQueryAdapterOptions } from 'restale-kit/tanstack-query'

// Verify types are properly exported and resolved
const _testTypes: JSONValue = 'test'
const _testSignal: RevalidateSignal = { key: ['test'] }
const _testWireSignal: Signal = _testSignal
const _testRevoke: RevokeEventDetail = { reason: 'deadline' }
const _testRenew: RenewEventDetail = { reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 }
const _testReconnect: AutoReconnectOptions = { native: true, jsBackoff: false }
const _testDeadlineAction: OnDeadlineAction = 'reconnect'
const _testDirectChannel: SSEChannelOptions = { lifetime: { ttlMs: 60000, onDeadline: _testDeadlineAction } }
const _testTanStackOptions: TanStackQueryAdapterOptions = { toQueryKey: (key) => key }
const _testGroupOptions: SSEChannelGroupOptions = {
  inlineDataResolver: (conns) => new Map(conns.map((c) => [c.connectionId, { signal: { key: ['test'] } }])),
}

declare const _client: SSEClient
declare const _channel: SSEChannel
_client.close()
_channel.disconnect()
`
  )
  writeFileSync(
    join(temporaryDirectory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'Node16',
        moduleResolution: 'Node16',
        types: ['node'],
        skipLibCheck: false,
        strict: true,
        noEmit: true,
      },
      include: ['types.ts'],
    }, null, 2) + '\n'
  )
  const localTsc7 = join(root, 'node_modules', 'typescript-7', 'bin', 'tsc')
  const localTsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
  const tempTsc = join(temporaryDirectory, 'node_modules', 'typescript', 'bin', 'tsc')
  const tempTscBin = join(temporaryDirectory, 'node_modules', '.bin', 'tsc')

  if (existsSync(localTsc7)) {
    run('node', [localTsc7, '--noEmit'], { cwd: temporaryDirectory })
  } else if (existsSync(localTsc)) {
    run('node', [localTsc, '--noEmit'], { cwd: temporaryDirectory })
  } else if (existsSync(tempTsc)) {
    run('node', [tempTsc, '--noEmit'], { cwd: temporaryDirectory })
  } else if (existsSync(tempTscBin)) {
    run(tempTscBin, ['--noEmit'], { cwd: temporaryDirectory })
  } else {
    run('npx', ['--yes', 'typescript', '--noEmit'], { cwd: temporaryDirectory })
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}
