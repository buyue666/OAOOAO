import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const out = {}
new Function('exports', ts.transpileModule(readFileSync(new URL('../lib/studio/studio-tour.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(out)

test('guide stays within desktop, narrow mobile and short landscape viewports', () => {
  for (const viewport of [{width:1920,height:919},{width:420,height:800},{width:320,height:568},{width:740,height:340}]) {
    for (const target of [null,{left:8,top:10,width:200,height:500},{left:viewport.width-44,top:8,width:36,height:36},{left:16,top:viewport.height-70,width:viewport.width-32,height:55}]) {
      const placed=out.studioTourPlacement(target,viewport,{width:380,height:220})
      assert.ok(placed.left>=12 && placed.top>=12)
      assert.ok(placed.left+placed.width<=viewport.width-12)
      assert.ok(placed.top+220<=viewport.height-12)
    }
  }
})
test('guide prefers free space beside the target rather than covering the highlighted area', () => {
  const target={left:8,top:300,width:210,height:60}
  const placed=out.studioTourPlacement(target,{width:1280,height:800},{width:380,height:220})
  assert.ok(placed.left>target.left+target.width)
})
test('completion is scoped by account and guide type; replay uses a local event', () => {
  assert.notEqual(out.studioTourKey('account-a','studio'),out.studioTourKey('account-b','studio'))
  assert.notEqual(out.studioTourKey('account-a','studio'),out.studioTourKey('account-a','tryon'))
  assert.equal(out.STUDIO_TOUR_EVENT,'oao:show-studio-tour')
})
test('contextual steps explain optional inputs and never suggest automatic paid generation', () => {
  const home=out.studioTourSteps('studio')
  assert.equal(home.length,4)
  assert.match(home.at(-1).description,/新手引导/)
  assert.equal(out.studioTourSteps('studio',true)[0].title,'Creative tools')
})
