import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'

const backends = [
  { name: 'Express', packageName: '@restale-kit-example/express', port: 3000 },
  { name: 'Hono', packageName: '@restale-kit-example/hono', port: 3001 },
  { name: 'Fastify', packageName: '@restale-kit-example/fastify', port: 3002 },
  { name: 'Node', packageName: '@restale-kit-example/node', port: 3003 },
  { name: 'Fetch (Web Standard)', packageName: '@restale-kit-example/fetch', port: 3004 },
]

const frontends = [
  { name: 'React Query', packageName: '@restale-kit-example/react-query', port: 5173 },
  { name: 'React SWR', packageName: '@restale-kit-example/react-swr', port: 5174 },
  { name: 'Vanilla JS', packageName: '@restale-kit-example/vanilla', port: 5175 },
]

const fullstack = [
  { name: 'Next.js 16 App Router + Redis Flagship Reference', packageName: '@restale-kit-example/full-stack-reference', port: 3000 },
]

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const children = []

function select(options, answer) {
  const index = Number(answer) - 1
  return options[index] ?? options.find((option) => option.name.toLowerCase() === answer.toLowerCase())
}

function start(args, env = {}) {
  const child = spawn(pnpm, args, { stdio: 'inherit', env: { ...process.env, ...env } })
  children.push(child)
  child.once('exit', (code) => {
    if (code && code !== 0) stop(code)
  })
  child.once('error', (error) => {
    console.error(`Could not start ${pnpm}: ${error.message}`)
    stop(1)
  })
}

function stop(code = 0) {
  for (const child of children) child.kill('SIGTERM')
  process.exit(code)
}

const prompt = createInterface({ input: stdin, output: stdout })
const answers = []
const waiting = []

prompt.on('line', (answer) => {
  const resolve = waiting.shift()
  if (resolve) resolve(answer)
  else answers.push(answer)
})

function question(message) {
  stdout.write(message)
  if (answers.length) return Promise.resolve(answers.shift())
  return new Promise((resolve) => waiting.push(resolve))
}

const modeAnswer = await question(
  `Select mode:\n1. Custom Pair (Backend + Frontend)\n2. Flagship Reference (Full-Stack Next.js 16 + Redis)\n> `,
)

if (modeAnswer.trim() === '2') {
  prompt.close()
  const app = fullstack[0]
  start(['--filter', app.packageName, 'run', 'dev'])
  console.log(`\nStarting ${app.name}...`)
  console.log(`Open http://localhost:${app.port}\n`)
} else {
  const backendAnswer = await question(
    `Backend:\n${backends.map((item, index) => `${index + 1}. ${item.name}`).join('\n')}\n> `,
  )
  const backend = select(backends, backendAnswer.trim())

  if (!backend) {
    prompt.close()
    console.error('Choose a listed backend.')
    process.exit(1)
  }

  const frontendAnswer = await question(
    `Frontend:\n${frontends.map((item, index) => `${index + 1}. ${item.name}`).join('\n')}\n> `,
  )
  prompt.close()
  const frontend = select(frontends, frontendAnswer.trim())

  if (!frontend) {
    console.error('Choose a listed frontend.')
    process.exit(1)
  }

  start(['--filter', backend.packageName, 'run', 'dev'])
  start(['--filter', frontend.packageName, 'run', 'dev', '--port', String(frontend.port), '--strictPort'], {
    BACKEND_PORT: String(backend.port),
  })

  console.log(`\n${backend.name} + ${frontend.name} is starting.`)
  console.log(`Open http://localhost:${frontend.port}\n`)
}

process.once('SIGINT', () => stop())
process.once('SIGTERM', () => stop())
