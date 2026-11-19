import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
const code=ts.transpileModule(readFileSync(new URL('../lib/studio/model-routing-patch.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const mod={exports:{}};new Function('module','exports',code)(mod,mod.exports)
const {modelRoutingPatch}=mod.exports
const fixture=()=>({logicalModels:[{id:'video',requiresSubscription:false,bindings:[]}],defaultModels:{textModel:'text',imageModel:'image',videoModel:'video',audioModel:''},modelPointCosts:{video:2,image:1}})
test('model edits do not write unrelated defaults and costs; a no-op produces no request',()=>{
 const before=fixture(),draft=structuredClone(before)
 assert.deepEqual(modelRoutingPatch(before,draft),{})
 draft.logicalModels[0].requiresSubscription=true
 assert.deepEqual(modelRoutingPatch(before,draft),{logicalModels:draft.logicalModels})
 assert.equal(before.logicalModels[0].requiresSubscription,false)
})
test('price and default edits include only the changed entries, including explicit zero and empty selection',()=>{
 const before=fixture(),draft=structuredClone(before)
 draft.defaultModels.videoModel='';draft.modelPointCosts.video=0
 assert.deepEqual(modelRoutingPatch(before,draft),{defaultModels:{videoModel:''},modelPointCosts:{video:0}})
})
