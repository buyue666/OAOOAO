import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
function compile(source,imports={}) {
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
  const module={exports:{}}
  new Function('require','module','exports',code)(name=>{assert.ok(name in imports,`Unexpected import ${name}`);return imports[name]},module,module.exports)
  return module.exports
}
const helpers=compile(read('../lib/studio/video-profile.ts'))
const durations=compile(read('../lib/studio/video-duration.ts'))
const all=node=>node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).flatMap(all)]:[]
const text=node=>typeof node==='string'?node:node&&typeof node==='object'?[node.props?.children].flat(Infinity).map(text).join(''):''
const initial=()=>({videoQualities:['480p','1080p','2K'],nativeVideoQualities:['480p','1080p','2K'],nativeDurationSeconds:Array.from({length:27},(_,i)=>i+4),durationSeconds:Array.from({length:27},(_,i)=>i+4),maxDurationByResolution:{'2K':15},videoBillingUnit:'second',supportsReferenceImage:true,supportsVideoReference:true,supportsAudioReference:true,videoPricing:{resolutionPricing:{'480p':{generationRate:2,referencePrices:{extraImage:0,referenceVideoPerSecond:3},referenceDurationTiers:[{maxSeconds:15,prices:{extraImage:0,referenceVideoPerSecond:3}},{maxSeconds:30,prices:{extraImage:1,referenceVideoPerSecond:6}}]},'1080p':{generationRate:8}}}})

function harness(profile=initial(), extra={}) {
  const slots=[],patches=[];let cursor=0
  const react={useState(value){const index=cursor++;if(!(index in slots))slots[index]=value;return[slots[index],next=>slots[index]=typeof next==='function'?next(slots[index]):next]}}
  const renderJsx=(type,props)=>typeof type === 'function' ? type(props) : {type,props}
  const leaves={'react/jsx-runtime':{jsx:renderJsx,jsxs:renderJsx},'./admin-kit':{AdminField:'Field',AdminInput:'Input',AdminSelect:'Select'},'./ui':{ControlButton:'Button'}}
  const prices=compile(read('../components/studio/video-generation-prices.tsx'),leaves)
  const module=compile(read('../components/studio/video-profile-editor.tsx'),{react,'./video-generation-prices':prices,...leaves,'react/jsx-runtime':{jsx:renderJsx,jsxs:renderJsx},'./admin-kit':{AdminField:'Field',AdminInput:'Input',AdminSelect:'Select'},'./ui':{ControlButton:'Button'},'@/lib/studio/video-duration':durations,'@/lib/studio/video-profile':helpers,'@/lib/studio/studio-models':{qualityLabel:value=>value}})
  const render=()=>{cursor=0;return module.VideoProfileEditor({...extra,profile,onChange:patch=>{patches.push(patch);profile={...profile,...patch}}})}
  const field=name=>all(render()).find(node=>node.props?.['aria-label']===name)
  const button=name=>all(render()).find(node=>node.type==='Button'&&text(node)===name)
  return{render,field,button,patches,profile:()=>profile}
}

test('all resolutions can be added manually; duplicate or unsafe names cannot save',()=>{
  const h=harness()
  h.field('新增清晰度').props.onChange({target:{value:'720p'}});h.button('添加清晰度').props.onClick()
  assert.ok(h.profile().videoQualities.includes('720p'))
  const count=h.patches.length
  h.field('新增清晰度').props.onChange({target:{value:'720P'}});h.button('添加清晰度').props.onClick()
  assert.equal(h.patches.length,count)
  assert.throws(()=>helpers.validVideoQuality('__proto__',[]))
})

test('batch copying only edits selected targets and respects native duration caps',()=>{
  const h=harness(),before=structuredClone(h.profile())
  h.field('选择清晰度 480p').props.onChange({target:{checked:true}})
  assert.equal(h.button('批量更改所选清晰度参数').props.disabled,true)
  h.field('选择清晰度 2K').props.onChange({target:{checked:true}})
  h.button('批量更改所选清晰度参数').props.onClick()
  assert.deepEqual(h.profile().videoPricing.resolutionPricing['1080p'],before.videoPricing.resolutionPricing['1080p'])
  assert.equal(h.profile().videoPricing.resolutionPricing['2K'].referencePrices.extraImage,0)
  assert.deepEqual(h.profile().videoPricing.resolutionPricing['2K'].referenceDurationTiers,[{maxSeconds:15,prices:{extraImage:0,referenceVideoPerSecond:3}}])
  assert.equal(Math.max(...helpers.videoDurationValues(h.profile(),'2K')),15)
  assert.deepEqual(h.profile().videoQualities,before.videoQualities)
})

test('resolution-specific price edits and clearing never change another resolution',()=>{
  const h=harness()
  h.field('480p 生成价格 · 积分/秒').props.onChange({target:{value:'0'}})
  h.field('480p 第2段 参考视频 · 积分/秒').props.onChange({target:{value:'7'}})
  assert.equal(h.profile().videoPricing.resolutionPricing['480p'].generationRate,0)
  assert.equal(h.profile().videoPricing.resolutionPricing['480p'].referenceDurationTiers[1].prices.referenceVideoPerSecond,7)
  assert.equal(h.profile().videoPricing.resolutionPricing['1080p'].generationRate,8)
  h.field('480p 生成价格 · 积分/秒').props.onChange({target:{value:''}})
  assert.equal(h.profile().videoPricing.resolutionPricing['480p'].generationRate,null)
})

test('removing a frame/reference switch keeps all configured prices for later reuse',()=>{
  const h=harness(),before=structuredClone(h.profile().videoPricing)
  const label=all(h.render()).find(node=>node.type==='label'&&text(node)==='参考视频')
  all(label).find(node=>node.type==='input').props.onChange({target:{checked:false}})
  assert.deepEqual(h.profile().videoPricing,before)
})

test('conditional template shows two output prices without reference-video input fees',()=>{
  const profile={...initial(),videoPricingTemplate:'reference-video-output'}
  const h=harness(profile,{longDurationMultiplier:2})
  assert.equal(h.field('480p 普通生成价格 · 积分/秒').props.value,2)
  assert.equal(h.field('480p 参考视频生成价格 · 积分/秒').props.value,3)
  assert.equal(h.field('480p 第1段 参考视频 · 积分/秒'),undefined)
  assert.equal(h.field('480p 第1段 超额视频 · 积分/个'),undefined)
  assert.equal(h.field('参考视频 免费数量（个）'),undefined)
  assert.match(text(h.render()),/16–30 秒自动 ×2/)
  h.field('480p 参考视频生成价格 · 积分/秒').props.onChange({target:{value:'0'}})
  assert.equal(h.profile().videoPricing.resolutionPricing['480p'].referenceVideoGenerationRate,0)
  h.field('480p 参考视频生成价格 · 积分/秒').props.onChange({target:{value:''}})
  assert.equal(h.profile().videoPricing.resolutionPricing['480p'].referenceVideoGenerationRate,null)
  assert.equal(profile.videoPricing.resolutionPricing['480p'].referenceVideoGenerationRate,undefined,'rendering never writes stored settings')
})

test('extra feature switches require an explicit administrator selection',()=>{
  const h=harness(initial(),{featureSwitches:[{key:'syntheticFeatureEnabled',label:'开启附加功能'}]})
  assert.equal(h.field('开启附加功能').props.checked,false)
  h.field('开启附加功能').props.onChange({target:{checked:true}})
  assert.equal(h.profile().syntheticFeatureEnabled,true)
  h.field('开启附加功能').props.onChange({target:{checked:false}})
  assert.equal(h.profile().syntheticFeatureEnabled,false)
})
