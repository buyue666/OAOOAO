import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../lib/studio/site-popups.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { safePopupImageUrl, activeSitePopups, popupPage, popupRevision, popupSeenKey } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const now = new Date(2026, 9, 14, 12).getTime()
const popup = { id: 'campaign', title: 'Synthetic activity', content: 'Isolated test', enabled: true, pages: ['home','studio'], frequency: 'session', updatedAt: new Date(now).toISOString() }

test('promotions only open on explicitly selected home or studio pages, never canvas, checkout, auth or legal pages', () => {
  for (const path of ['/canvas', '/canvas/project', '/plans', '/terms', '/privacy', '/login', '/admin/content', '/image', '/projects']) {
    assert.equal(popupPage(path), null)
    assert.deepEqual(activeSitePopups([popup], path, now), [])
  }
  assert.equal(activeSitePopups([popup], '/', now).length, 1)
  assert.equal(activeSitePopups([{ ...popup, pages: ['home'] }], '/studio', now).length, 0)
})
test('time windows include the start and exclude the end, reject invalid dates and keep latest campaign first', () => {
  const timed = { ...popup, startsAt: new Date(now).toISOString(), endsAt: new Date(now+1000).toISOString() }
  assert.equal(activeSitePopups([timed], '/', now-1).length, 0)
  assert.equal(activeSitePopups([timed], '/', now).length, 1)
  assert.equal(activeSitePopups([timed], '/', now+1000).length, 0)
  for (const invalid of [{enabled:false},{startsAt:'bad'},{endsAt:'bad'},{pages:undefined}]) assert.equal(activeSitePopups([{...popup,...invalid}], '/', now).length,0)
  const older = {...popup,id:'old',updatedAt:new Date(now-2000).toISOString()}
  assert.deepEqual(activeSitePopups([older,popup], '/', now).map(p=>p.id),['campaign','old'])
})
test('session dismissal survives date changes while daily dismissal resets by browser day; edits create a fresh revision', () => {
  assert.equal(popupSeenKey(popup,now), popupSeenKey(popup,now+86400000))
  const daily={...popup,frequency:'daily'}
  assert.notEqual(popupSeenKey(daily,now),popupSeenKey(daily,now+86400000))
  assert.notEqual(popupRevision(popup),popupRevision({...popup,updatedAt:new Date(now+1).toISOString()}))
})
test('public images accept media and HTTPS raster paths but reject credentials, traversal, SVG and executable schemes', () => {
  for (const target of ['/media/brand/oao-logo-transparent.png','https://example.com/cover.webp?v=1']) assert.equal(safePopupImageUrl(target),target)
  for (const target of ['data:image/png;base64,abc','javascript:alert(1)','http://example.com/a.png','//example.com/a.png','https://user:pass@example.com/a.png','https://@example.com/a.png','https:///example.com/a.png','/api/reference-assets/private','/media/../api/private','/media/%2e%2e/api/private','/media/a.svg','https://example.com/a.SVGZ?x=1','https://example.com/a%2esvg','/media/a.png\n']) {
    assert.equal(safePopupImageUrl(target),'',target)
  }
})
