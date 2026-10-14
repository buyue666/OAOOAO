import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import ts from 'typescript'

const helperSource = await readFile(new URL('../lib/studio/announcement-countdown.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const helpers = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const { getAnnouncementCountdown } = helpers
const now = Date.parse('2026-10-14T03:00:00.000Z')
const deadlineIn = milliseconds => new Date(now + milliseconds).toISOString()

test('countdown hides when no valid deadline or clock is available', () => {
  for (const value of [undefined, '', '   ', 'invalid', '2026-99-14T03:00:00Z']) assert.equal(getAnnouncementCountdown(value, now), null)
  assert.equal(getAnnouncementCountdown(deadlineIn(10000), Number.NaN), null)
  assert.equal(getAnnouncementCountdown(deadlineIn(10000), Number.POSITIVE_INFINITY), null)
})

test('countdown disappears at the exact deadline and never shows an expired zero clock', () => {
  assert.equal(getAnnouncementCountdown(deadlineIn(0), now), null)
  assert.equal(getAnnouncementCountdown(deadlineIn(-1), now), null)
  assert.equal(getAnnouncementCountdown(deadlineIn(-86400000), now), null)
})

test('rounding up preserves the final partial second without ending early', () => {
  assert.deepEqual(getAnnouncementCountdown(deadlineIn(1), now), { remainingSeconds: 1, days: 0, hours: 0, minutes: 0, seconds: 1 })
  assert.equal(getAnnouncementCountdown(deadlineIn(999), now).remainingSeconds, 1)
  assert.equal(getAnnouncementCountdown(deadlineIn(1000), now).remainingSeconds, 1)
  assert.equal(getAnnouncementCountdown(deadlineIn(1001), now).remainingSeconds, 2)
})

test('countdown carries correctly across minute, hour and day boundaries', () => {
  assert.deepEqual(getAnnouncementCountdown(deadlineIn(86400000), now), { remainingSeconds: 86400, days: 1, hours: 0, minutes: 0, seconds: 0 })
  assert.deepEqual(getAnnouncementCountdown(deadlineIn(86400001), now), { remainingSeconds: 86401, days: 1, hours: 0, minutes: 0, seconds: 1 })
  const seconds = 2 * 86400 + 3 * 3600 + 4 * 60 + 5
  assert.deepEqual(getAnnouncementCountdown(deadlineIn(seconds * 1000), now), { remainingSeconds: seconds, days: 2, hours: 3, minutes: 4, seconds: 5 })
  assert.deepEqual(getAnnouncementCountdown(deadlineIn(86399000), now), { remainingSeconds: 86399, days: 0, hours: 23, minutes: 59, seconds: 59 })
})

test('day counts above 99 retain their full value', () => {
  const seconds = 1234 * 86400 + 9 * 3600 + 8 * 60 + 7
  assert.deepEqual(getAnnouncementCountdown(deadlineIn(seconds * 1000), now), { remainingSeconds: seconds, days: 1234, hours: 9, minutes: 8, seconds: 7 })
})

test('equivalent timezone instants yield the same remaining time', () => {
  const utc = getAnnouncementCountdown('2026-10-15T03:04:05Z', now)
  assert.deepEqual(getAnnouncementCountdown('2026-10-15T11:04:05+08:00', now), utc)
  assert.deepEqual(getAnnouncementCountdown('2026-10-14T22:04:05-05:00', now), utc)
})

test('resuming after a delayed tick uses elapsed wall time instead of counting ticks', () => {
  const deadline = deadlineIn(90000)
  assert.equal(getAnnouncementCountdown(deadline, now).remainingSeconds, 90)
  assert.equal(getAnnouncementCountdown(deadline, now + 65500).remainingSeconds, 25)
  assert.equal(getAnnouncementCountdown(deadline, now + 95000), null)
})

test('server markup stays empty and stable for future, expired and missing deadlines', async () => {
  const source = await readFile(new URL('../components/announcement-countdown.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const require = createRequire(import.meta.url)
  const module = { exports: {} }
  runInNewContext(compiled, { module, exports: module.exports, require: name => name === '@/lib/studio/announcement-countdown' ? helpers : require(name) })
  const { AnnouncementCountdown } = module.exports
  for (const endsAt of [undefined, 'invalid', '2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z']) {
    assert.equal(renderToString(createElement(AnnouncementCountdown, { endsAt })), '')
    assert.equal(renderToString(createElement(AnnouncementCountdown, { endsAt })), '')
  }
})
