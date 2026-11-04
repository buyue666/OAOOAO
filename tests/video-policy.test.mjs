import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const code=ts.transpileModule(readFileSync(new URL('../lib/studio/video-policy.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const module={exports:{}}
vm.runInNewContext(`(function(module,exports){${code}\n})`)(module,module.exports)
const {selectableVideoDurations,videoReferenceLimit}=module.exports
const model={capabilities:{durations:['4 秒','6 秒','8 秒','10 秒'],maxReferences:15,videoPolicy:{referenceLimits:{image:9,video:3,audio:3},referenceRules:{image:{maxCount:8}},durationsByMode:{first:[4,6],references:[8]},durationRules:{'720p':{mode:'range',min:4,max:8,step:2}}}}}
test('duration dropdown follows resolution, mode and configured interval',()=>{
  assert.deepEqual([...selectableVideoDurations(model,'720p','first')],['4 秒','6 秒'])
  assert.deepEqual([...selectableVideoDurations(model,'720p','references')],['8 秒'])
  assert.deepEqual([...selectableVideoDurations(undefined,'720p','text')],[])
})
test('reference picker uses the lower configured/native limit and zero keeps native support',()=>{
  assert.equal(videoReferenceLimit(model,'image'),8)
  assert.equal(videoReferenceLimit(model,'video'),3)
  assert.equal(videoReferenceLimit({...model,capabilities:{...model.capabilities,videoPolicy:{...model.capabilities.videoPolicy,referenceRules:{image:{maxCount:0}}}}},'image'),9)
})
