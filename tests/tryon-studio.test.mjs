import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as jsxRuntime from 'react/jsx-runtime'

const read=file=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8')
function load(file,imports={}){const exports={};new Function('exports','require',ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(exports,name=>{if(!(name in imports))throw Error(name);return imports[name]});return exports}
const logic=load('lib/studio/tryon.ts')
const reference=role=>({id:role,title:role,url:`https://fixture.example/${role}.png`})
const options={model:'fixture-image',ratio:'2:3',resolution:'1K',quality:'auto',count:1,prompt:'保留刺绣',background:'preserve',style:'photo'}

test('all seven reference combinations assign consecutive image numbers and non-conflicting pose instructions',()=>{
  for(let mask=1;mask<8;mask++){
    const selected=logic.emptyTryOnSelections();['person','garment','pose'].forEach((role,index)=>{if(mask&(1<<index))selected[role]=reference(role)})
    const input=logic.tryOnInput(selected,options),lines=input.prompt.split('\n').filter(line=>line.startsWith('参考图 '))
    assert.equal(lines.length,input.references.length)
    lines.forEach((line,index)=>assert.ok(line.startsWith(`参考图 ${index+1} `)))
    assert.deepEqual(input.references.map(item=>item.url),['person','garment','pose'].filter(role=>selected[role]).map(role=>reference(role).url))
    assert.equal(input.kind,'edit');assert.equal(input.count,1)
    if(selected.pose){assert.match(input.prompt,/优先遵循身体动作/);assert.doesNotMatch(input.prompt,/保留人物参考中的原有姿势/)}
    else if(selected.person)assert.match(input.prompt,/保留人物参考中的原有姿势/)
  }
})
test('references are never silently truncated and text-only creations use generation mode',()=>{
  const selected={person:reference('person'),garment:reference('garment'),pose:reference('pose')}
  assert.match(logic.tryOnReferenceError(selected,2),/最多支持 2 张/)
  assert.equal(logic.tryOnReferences(selected).length,3)
  assert.equal(logic.tryOnReferenceError(selected,3),'')
  assert.equal(logic.tryOnInput(logic.emptyTryOnSelections(),options).kind,'generation')
})
test('custom presets, supplementary instructions and selected pose angle are all retained',()=>{
  const input=logic.tryOnInput({person:reference('person'),garment:null,pose:{...reference('pose'),angle:'侧面'}},{...options,preset:'定制服装摄影规范'})
  assert.ok(input.prompt.startsWith('定制服装摄影规范\n'))
  assert.match(input.prompt,/（侧面）/);assert.match(input.prompt,/补充要求：保留刺绣/)
  assert.match(input.prompt,/未指定服装，保留人物原有衣着/)
})
const elements=node=>Array.isArray(node)?node.flatMap(elements):node&&typeof node==='object'&&node.props?[node,...elements(node.props.children)]:[]
test('workbench keeps presets collapsed, exposes three independent references and waits for a confirmed quote',()=>{
  const slots=[];let cursor=0
  const imports={react:{useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]},useRef:initial=>{const i=cursor++;return slots[i]??=( {current:initial})},useEffect(){},useMemo:compute=>compute()},'react/jsx-runtime':jsxRuntime,'next/link':'Link','lucide-react':{},'@/lib/studio/store':{useStudio:()=>({state:{user:{id:'fixture'},liveModels:[]}})},'@/lib/studio/generation-store':{useGeneration:()=>({tasks:[]})},'@/lib/studio/studio-models':{filterModelsByCapability:()=>[],imageQualityOptions:()=>['auto']},'@/lib/studio/account-api':{},'@/lib/studio/creative-references-api':{},'@/lib/studio/tryon':logic,'@/lib/utils':{cn:(...v)=>v.filter(Boolean).join(' ')},'../ui':{ModelNote:'ModelNote'},'./tryon-gallery':{TryOnGallery:'TryOnGallery'}}
  imports['@/lib/studio/studio-models'].qualityLabel=value=>value
  imports['@/components/ui/dialog']={Dialog:'Dialog',DialogContent:'DialogContent',DialogTitle:'DialogTitle'}
  const Tool=load('components/studio/tools/ai-tryon-tool.tsx',imports).default
  const render=()=>{cursor=0;return elements(Tool())}
  const first=render()
  assert.equal(first.find(item=>item.props['data-testid']==='ai-tryon-preset').props.open,undefined)
  assert.equal(first.find(item=>item.props['data-testid']==='ai-tryon-submit').props.disabled,true)
  for(const role of ['person','garment','pose'])assert.ok(first.some(item=>item.props['data-testid']===`tryon-role-${role}`))
  let picker=first.find(item=>item.type==='TryOnGallery');picker.props.onSelect(reference('garment'))
  render().find(item=>item.props['data-testid']==='tryon-role-pose').props.onClick()
  picker=render().find(item=>item.type==='TryOnGallery');assert.equal(picker.props.role,'pose');picker.props.onSelect(reference('pose'))
  render().find(item=>item.props['aria-label']==='移除姿势参考').props.onClick()
  const current=render();assert.ok(current.some(item=>item.props['aria-label']==='移除服装参考'));assert.ok(!current.some(item=>item.props['aria-label']==='移除姿势参考'))
})
