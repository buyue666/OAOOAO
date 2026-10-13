import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

async function moduleAt(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const { activeAnnouncements, announcementKey, popupEligible } = await moduleAt('../lib/studio/announcements.ts')
const { safeReturnPath } = await moduleAt('../lib/studio/return-path.ts')
const notice = { id: 'test', title: 'Synthetic notice', content: 'Test only', enabled: true, popupHome: true, popupAfterLogin: false, updatedAt: '2026-10-14T03:00:00Z' }

test('announcement interval uses actual instants; starts inclusive, ends exclusive', () => {
  const timed = { ...notice, startsAt: '2026-10-14T11:00:00+08:00', endsAt: '2026-10-14T12:00:00+08:00' }
  assert.equal(activeAnnouncements([timed], Date.parse('2026-10-14T03:00:00Z')).length, 1)
  assert.equal(activeAnnouncements([timed], Date.parse('2026-10-14T02:59:59Z')).length, 0)
  assert.equal(activeAnnouncements([timed], Date.parse('2026-10-14T04:00:00Z')).length, 0)
  assert.equal(activeAnnouncements([{ ...notice, enabled: false }]).length, 0)
  assert.equal(activeAnnouncements([{ ...notice, startsAt: 'invalid' }]).length, 0)
})
test('home means public landing and creation home; legal/admin/payment pages never auto-popup', () => {
  assert.equal(popupEligible(notice, '/', false), true)
  assert.equal(popupEligible(notice, '/studio', true), true)
  assert.equal(popupEligible(notice, '/studio', false), false)
  assert.equal(popupEligible(notice, '/image', true), false)
  const afterLogin = { ...notice, popupHome: false, popupAfterLogin: true }
  assert.equal(popupEligible(afterLogin, '/image', true), true)
  assert.equal(popupEligible(afterLogin, '/drama/project', true), true)
  assert.equal(popupEligible(afterLogin, '/canvas/project', false), false)
  for (const path of ['/terms', '/privacy', '/login', '/plans', '/admin/settings']) assert.equal(popupEligible(afterLogin, path, true), false)
})
test('a revised announcement has a new dismissal identity', () => {
  assert.notEqual(announcementKey(notice), announcementKey({ ...notice, updatedAt: '2026-10-14T04:00:00Z' }))
})
test('plan close retains local project query and hash and rejects unsafe or looping destinations', () => {
  assert.equal(safeReturnPath('/projects/one?section=shots#shot2'), '/projects/one?section=shots#shot2')
  for (const path of [null, '', '//outside.test', '/\\outside.test', 'https://outside.test', 'javascript:alert(1)', '/plans?returnTo=/plans', '/login', '/image\n']) assert.equal(safeReturnPath(path), '/studio')
})
