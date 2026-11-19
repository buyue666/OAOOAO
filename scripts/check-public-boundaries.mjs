import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const policy = JSON.parse(readFileSync(path.join(root, 'public-source-boundaries.json'), 'utf8'))
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const textHash = name => {
  const bytes = readFileSync(path.join(root, name))
  return hash(/\.(?:glb|png|webp|jpg|jpeg|gif)$/i.test(name) ? bytes : Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n')))
}
const failures = []
for (const name of files) {
  if (policy.excludedPrefixes.some(prefix => name.startsWith(prefix))) failures.push(`Private path: ${name}`)
  if (policy.frozenPrefixes.some(prefix => name.startsWith(prefix)) && !policy.frozenFiles[name]) failures.push(`Unreviewed protected file: ${name}`)
}
for (const [name, expected] of Object.entries(policy.frozenFiles)) {
  try { if (textHash(name) !== expected) failures.push(`Protected baseline changed: ${name}`) }
  catch { failures.push(`Protected baseline missing: ${name}`) }
}
if (failures.length) throw Error('Public release boundary check failed:\n' + failures.join('\n'))
console.log(`Public boundaries verified: ${Object.keys(policy.frozenFiles).length} baseline files; director 0.1 only.`)
