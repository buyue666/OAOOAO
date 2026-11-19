import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

async function moduleUrl(path, imports = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const [name, url] of Object.entries(imports)) code = code.replaceAll(`'${name}'`, `'${url}'`)
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const context = await moduleUrl('../lib/studio/director-context.ts')
const mentions = await moduleUrl('../lib/studio/prompt-references.ts')
const files = await moduleUrl('../lib/studio/agent-files.ts')
const { directorRequestPrompt, directorConversationHistory, remapDirectorReferences, agentPlanCosts } = await import(await moduleUrl('../lib/studio/director-workspace.ts', { './director-context': context, './prompt-references': mentions, './agent-files': files }))
const references = [{ id: 'owned-a', title: '耳机正面' }, { id: 'owned-b', title: '场景参考' }]

test('Agent mentions bind to owned asset IDs and the chosen scene without claiming visual understanding', () => {
  const prompt = directorRequestPrompt('用 @图1 的产品放进 @图2 的场景', { surface: 'chat' }, 'commerce', references)
  assert.match(prompt, /@图1（素材 ID：owned-a）/)
  assert.match(prompt, /@图2（素材 ID：owned-b）/)
  assert.match(prompt, /创作场景：电商商品/)
  assert.match(prompt, /名称不是视觉内容/)
  assert.doesNotMatch(prompt, /projectTitle|已经看过/)
})

test('removing or reordering a reference never silently changes the referenced image', () => {
  assert.equal(remapDirectorReferences('用 @图1 和 @图2', references, [references[1]]), '用 （已移除：耳机正面） 和 @图1')
  assert.equal(remapDirectorReferences('@图1 @图2 @1', references, [...references].reverse()), '@图2 @图1 @图2')
  assert.equal(remapDirectorReferences('普通文字与 @未知', references, []), '普通文字与 @未知')
})

test('planning is separated from additional execution estimates, including older server responses', () => {
  const planApproval = { totalPoints: 27, steps: [{ estimatedPoints: 10 }, { estimatedPoints: 7 }] }
  assert.deepEqual(agentPlanCosts({ pointsCost: 10, planApproval }), { planning: 10, execution: 17 })
  assert.deepEqual(agentPlanCosts({ pointsCost: 27, planningPoints: 10, planApproval: { ...planApproval, executionEstimatedPoints: 17 } }), { planning: 10, execution: 17 })
  assert.deepEqual(agentPlanCosts({ pointsCost: 0 }), { planning: 0, execution: 0 })
})

test('follow-up planning includes earlier requirements, real plans and result summaries', () => {
  const messages=[{id:'u1',role:'user',text:'建筑使用完整外壳，加入道路和绿植'},{id:'a1',role:'agent',text:'已生成方案',runId:'r1'}]
  const runs={r1:{id:'r1',status:'awaiting_approval',summary:'街区环境方案',prompt:'private-upstream-request-must-not-recur',tasks:[{title:'场景渲染',type:'image',status:'pending',optimizedPrompt:'保留道路与树木'}],planApproval:{steps:[{title:'搭建建筑外壳'}]},outputs:[]},unrelated:{id:'other',summary:'unrelated-account-must-not-appear'}}
  const history=directorConversationHistory(messages,runs)
  const prompt=directorRequestPrompt('把刚才的场景改成夜景',{surface:'chat'},'general',[],history)
  assert.match(prompt,/把刚才的场景改成夜景/)
  assert.match(prompt,/建筑使用完整外壳/)
  assert.match(prompt,/街区环境方案/)
  assert.match(prompt,/搭建建筑外壳/)
  assert.match(prompt,/awaiting_approval/)
  assert.doesNotMatch(prompt,/private-upstream-request-must-not-recur|unrelated-account-must-not-appear/)
})

test('conversation context stays bounded and prioritizes recent turns', () => {
  const messages=Array.from({length:40},(_,i)=>({id:String(i),role:'user',text:`turn-${i}-`+'细节'.repeat(4000)}))
  const context=directorConversationHistory(messages,{})
  assert.ok(context.length<12500)
  assert.match(context,/turn-39-/)
  assert.doesNotMatch(context,/turn-0-/)
  assert.equal(directorConversationHistory([],{}),'')
})
