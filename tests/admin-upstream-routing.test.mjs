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
const pricing=compile(read('../lib/studio/upstream-pricing.ts'))
const aliases=compile(read('../lib/studio/model-alias.ts'))
const nodes=node=>node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).flatMap(nodes)]:[]
const text=node=>typeof node==='string'?node:node&&typeof node==='object'?[node.props?.children].flat(Infinity).map(text).join(''):''
test('channel editor exposes the result-storage switch and submits its choice without changing peer channels',async()=>{
  const saved=[],channel={id:'cdn',name:'CDN',baseUrl:'https://provider.example/v1',models:['image'],enabled:true,storeGeneratedMedia:false},peer={...channel,id:'peer',storeGeneratedMedia:true}
  const component=compile(read('../components/studio/admin-channels.tsx')+'\nexport {ChannelEditor}',{
    react:{useState:value=>[typeof value==='function'?value():value,()=>{}],useCallback:fn=>fn},
    'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'lucide-react':new Proxy({},{get:(_,key)=>key}),
    '@/lib/studio/upstream-pricing':pricing,'@/lib/studio/model-alias':aliases,'@/lib/utils':{cn:(...values)=>values.filter(Boolean).join(' ')},
    '@/lib/studio/admin-api':{saveChannels:async value=>saved.push(value)},'./ui':{ControlButton:'Button',StatusBadge:'Badge'},'./video-profile-editor':{},'./model-icon':{},'./lobe-icon-picker':{},'./admin-shell':{},'./admin-kit':new Proxy({},{get:(_,key)=>key}),
  }).ChannelEditor
  const tree=component({channel,existingChannels:[channel,peer],onClose(){},onSaved(){}}),switcher=nodes(tree).find(node=>node.type==='input'&&node.props.name==='storeGeneratedMedia')
  assert.equal(switcher.props.role,'switch');assert.equal(switcher.props.defaultChecked,false);assert.ok(text(tree).includes('生成结果转存 R2'))
  const original=global.FormData
  global.FormData=class { constructor(value){this.value=value} get(key){return this.value[key]??null} }
  try{
    await nodes(tree).find(node=>node.type==='form').props.onSubmit({preventDefault(){},currentTarget:{baseUrl:channel.baseUrl,name:channel.name,enabled:'on',storeGeneratedMedia:'on'}})
    assert.equal(saved[0][0].storeGeneratedMedia,true);assert.deepEqual(saved[0][1],peer);assert.equal(channel.storeGeneratedMedia,false)
  }finally{global.FormData=original}
})
function harness(){
  let cursor=0;const slots=[],saved=[]
  const react={useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]},useMemo:fn=>fn()}
  const channels=['one','two'].map(id=>({id,name:`账号${id}`,baseUrl:'https://provider.example.invalid/v1',apiFormat:'openai',enabled:true,hasApiKey:true,models:['video-model']}))
  const settings={systemChannels:channels,modelPointCosts:{},defaultModels:{},logicalModels:[{id:'video',name:'合成视频模型',capability:'video',enabled:true,iconUrl:'https://example.invalid/default.svg',bindings:channels.map((channel,index)=>({id:channel.id,channelId:channel.id,upstreamModel:'video-model',iconUrl:`https://example.invalid/${channel.id}.svg`,priority:index+1,enabled:true,capabilityProfile:{maxReferences:index+5,videoBillingUnit:'second',videoPricing:{resolutionPricing:{'720p':{generationRate:index+1}}}}}))}]}
  const component=compile(read('../components/studio/admin-channels.tsx')+'\nexport {RoutingEditor}',{
    react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'lucide-react':new Proxy({},{get:(_,key)=>key}),
    '@/lib/studio/upstream-pricing':pricing,'@/lib/studio/model-alias':aliases,'@/lib/utils':{cn:(...values)=>values.filter(Boolean).join(' ')},
    '@/lib/studio/admin-api':{saveRouting:async value=>saved.push(value)},'./ui':{ControlButton:'Button',StatusBadge:'Badge'},'./video-profile-editor':{VideoProfileEditor:'VideoProfileEditor'},'./model-icon':{ModelIcon:'ModelIcon'},'./lobe-icon-picker':{LobeIconPicker:'IconPicker'},'./admin-shell':{},
    './admin-kit':new Proxy({useConfirm:()=>({confirm:input=>input.onConfirm()})},{get:(target,key)=>target[key]||key}),
  }).RoutingEditor
  const render=()=>{cursor=0;return nodes(component({settings,onClose(){},onSaved(){}}))}
  const save=()=>render()[0].props.footer.props.children.find(node=>text(node)==='保存路由配置').props.onClick()
  return{render,save,saved,settings}
}

test('real routing editor keeps accounts collapsible, blocks conflicting prices and unifies from a chosen source',async()=>{
  const h=harness(),bindings=()=>h.render().filter(node=>node.type==='details'&&node.props.className.includes('admin-config-group rounded-xl'))
  assert.equal(bindings().length,2);assert.equal(bindings()[0].props.open,true);assert.equal(bindings()[1].props.open,false)
  const icons=h.render().filter(node=>node.type==='IconPicker')
  assert.equal(icons.length,1,'only the default model icon remains editable')
  assert.equal(icons[0].props['aria-label'],'video 默认模型图标')
  assert.equal(icons[0].props.value,h.settings.logicalModels[0].iconUrl)
  await h.save();assert.equal(h.saved.length,0)
  assert.ok(h.render().some(node=>text(node).includes('同上游渠道价格不一致')))
  const buttons=h.render().filter(node=>node.type==='Button'&&text(node)==='以此渠道价格统一')
  buttons[1].props.onClick()
  await h.save();assert.equal(h.saved.length,1)
  const [one,two]=h.saved[0].logicalModels[0].bindings
  assert.equal(one.capabilityProfile.videoPricing.resolutionPricing['720p'].generationRate,2)
  assert.equal(two.capabilityProfile.videoPricing.resolutionPricing['720p'].generationRate,2)
  assert.equal(one.capabilityProfile.maxReferences,5);assert.equal(two.capabilityProfile.maxReferences,6)
  assert.equal(one.iconUrl,undefined);assert.equal(two.iconUrl,undefined,'saving removes obsolete binding icon overrides')
  assert.ok(h.settings.logicalModels[0].bindings[0].iconUrl,'opening does not alter saved settings')
  assert.equal(h.settings.logicalModels[0].bindings[0].capabilityProfile.videoPricing.resolutionPricing['720p'].generationRate,1,'opening and editing never mutates original settings')
})

test('real profile callbacks synchronize price changes but keep reference ceilings independent',async()=>{
  const h=harness(),editors=()=>h.render().filter(node=>node.type==='VideoProfileEditor')
  editors()[0].props.onChange({videoPricing:{resolutionPricing:{'720p':{generationRate:7,referenceVideoGenerationRate:3}}}})
  assert.equal(editors()[1].props.profile.videoPricing.resolutionPricing['720p'].generationRate,7)
  editors()[0].props.onChange({videoReferenceTotalLimit:4})
  assert.equal(editors()[0].props.profile.videoReferenceTotalLimit,4)
  assert.equal(editors()[1].props.profile.videoReferenceTotalLimit,undefined)
  await h.save();assert.equal(h.saved.length,1)
})

test('model notes are saved as a model field and preserve multiline input',async()=>{
  const h=harness()
  h.render().filter(node=>node.type==='Button'&&text(node)==='以此渠道价格统一')[0].props.onClick()
  const field=()=>h.render().find(node=>node.props?.['aria-label']==='video 模型备注')
  assert.equal(field().props.value,'');assert.equal(field().props.maxLength,2000)
  field().props.onChange({target:{value:'使用说明\n参考图片'}})
  assert.equal(field().props.value,'使用说明\n参考图片')
  await h.save();assert.equal(h.saved[0].logicalModels[0].note,'使用说明\n参考图片')
  assert.equal(h.settings.logicalModels[0].note,undefined,'editing only changes the draft')
})
