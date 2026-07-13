import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const version = process.argv[2]
if (!version) throw new Error('Usage: node scripts/extract-changelog.mjs <version>')

const changelog = readFileSync(resolve(import.meta.dirname, '../restale-kit/CHANGELOG.md'), 'utf8')
const header = `## [${version}]`
const start = changelog.indexOf(header)
if (start === -1) throw new Error(`No changelog section found for ${version}`)

const contentStart = changelog.indexOf('\n', start) + 1
const nextHeader = changelog.indexOf('\n## [', contentStart)
const notes = changelog.slice(contentStart, nextHeader === -1 ? undefined : nextHeader).trim()
if (!notes) throw new Error(`Changelog section for ${version} is empty`)

process.stdout.write(`${notes}\n`)
