import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

async function moduleAt(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const { activeAnnouncements, announcementKey, popupEligible, homepageAnnouncement, safeAnnouncementHref } = await moduleAt('../lib/studio/announcements.ts')
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
test('home uses a banner; only opted-in non-home creative pages auto-popup', () => {
  assert.equal(popupEligible(notice, '/', false), false)
  assert.equal(popupEligible(notice, '/studio', true), false)
  assert.equal(popupEligible(notice, '/studio', false), false)
  assert.equal(popupEligible(notice, '/image', true), false)
  const afterLogin = { ...notice, popupHome: false, popupAfterLogin: true }
  assert.equal(popupEligible(afterLogin, '/image', true), true)
  assert.equal(popupEligible(afterLogin, '/drama/project', true), true)
  assert.equal(popupEligible(afterLogin, '/canvas/project', false), false)
  for (const path of ['/', '/studio', '/terms', '/privacy', '/login', '/plans', '/admin/settings']) assert.equal(popupEligible(afterLogin, path, true), false)
})

test('homepage selects the latest revised active banner without reviving expired announcements', () => {
  const now = Date.parse('2026-10-14T05:00:00Z')
  const revised = { ...notice, id: 'revision', updatedAt: '2026-10-14T04:00:00Z' }
  const expired = { ...notice, id: 'expired', updatedAt: '2026-10-14T05:00:00Z', endsAt: '2026-10-14T05:00:00Z' }
  assert.equal(homepageAnnouncement([notice, expired, revised], now).id, 'revision')
  assert.equal(homepageAnnouncement([{ ...revised, popupHome: false }, expired], now), undefined)
  assert.equal(homepageAnnouncement([{ ...notice, startsAt: '2026-10-14T06:00:00Z' }], now), undefined)
})

test('banner links allow site paths and web URLs and reject executable or ambiguous destinations', () => {
  assert.equal(safeAnnouncementHref('/plans?returnTo=%2Fstudio'), '/plans?returnTo=%2Fstudio')
  assert.equal(safeAnnouncementHref('https://example.com/news'), 'https://example.com/news')
  for (const href of ['javascript:alert(1)', 'data:text/html,abc', '//outside.test', '/\\outside.test', '/plans\nnext']) assert.equal(safeAnnouncementHref(href), '')
})
test('announcement destinations normalize complete URLs and retain local query and hash', () => {
  assert.equal(safeAnnouncementHref('  /plans?campaign=notice#credits  '), '/plans?campaign=notice#credits')
  assert.equal(safeAnnouncementHref(' HTTPS://EXAMPLE.COM:443/news '), 'https://example.com/news')
  assert.equal(safeAnnouncementHref('http://example.com/news'), 'http://example.com/news')
  assert.equal(safeAnnouncementHref(''), '')
  assert.equal(safeAnnouncementHref(undefined), '')
})
test('announcement destinations reject credentials, incomplete schemes and control characters', () => {
  for (const href of ['https:example.com', 'https:/example.com', 'https:///example.com', 'https://user:pass@example.com', 'https://@example.com', 'https://user@example.com', '\t/plans', '/plans\n', '/plans\u0085next', 'https://example.com\r/news', 'mailto:hello@example.com', 'file:///tmp/test']) {
    assert.equal(safeAnnouncementHref(href), '', href)
  }
})
test('announcement destination length is bounded before and after URL normalization', () => {
  assert.equal(safeAnnouncementHref('/' + 'a'.repeat(2047)).length, 2048)
  assert.equal(safeAnnouncementHref('/' + 'a'.repeat(2048)), '')
  assert.equal(safeAnnouncementHref('https://example.com/' + '创'.repeat(300)), '')
})
test('a revised announcement has a new dismissal identity', () => {
  assert.notEqual(announcementKey(notice), announcementKey({ ...notice, updatedAt: '2026-10-14T04:00:00Z' }))
})
test('plan close retains local project query and hash and rejects unsafe or looping destinations', () => {
  assert.equal(safeReturnPath('/projects/one?section=shots#shot2'), '/projects/one?section=shots#shot2')
  for (const path of [null, '', '//outside.test', '/\\outside.test', 'https://outside.test', 'javascript:alert(1)', '/plans?returnTo=/plans', '/login', '/image\n']) assert.equal(safeReturnPath(path), '/studio')
})
