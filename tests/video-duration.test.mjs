import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const code=ts.transpileModule(readFileSync(new URL('../lib/studio/video-duration.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const module={exports:{}}
vm.runInNewContext(`(function(module,exports){${code}\n})`)(module,module.exports)
const {formatVideoDurations,parseVideoDurationInput}=module.exports

test('continuous seconds use a compact range while preset gaps remain explicit',()=>{
  assert.equal(formatVideoDurations(Array.from({length:27},(_,i)=>i+4)),'4-30')
  assert.equal(formatVideoDurations([4,6,8]),'4、6、8')
  assert.equal(formatVideoDurations([8,4,5,6,4]),'4-6、8')
  assert.equal(formatVideoDurations([4]),'4')
})

test('range input accepts 4-30 and equivalent separators',()=>{
  for(const text of ['4-30','4 – 30','4至30'])assert.equal(JSON.stringify(parseVideoDurationInput(text)),JSON.stringify({mode:'range',min:4,max:30,step:1}))
  assert.deepEqual([...parseVideoDurationInput('4,6,8').values],[4,6,8])
  assert.deepEqual([...parseVideoDurationInput('4，6-8').values],[4,6,7,8])
})

test('duration input rejects reversed, fractional, empty and oversized ranges',()=>{
  for(const text of ['30-4','0-30','4-3601','4.5-30','4-','4,,8','','4-30-40'])assert.equal(parseVideoDurationInput(text),undefined,text)
})
