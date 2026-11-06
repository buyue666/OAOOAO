import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import * as runtime from 'react/jsx-runtime'
import ts from 'typescript'
import {chineseText, englishText, englishLocale, translateUiText, compileLocaleModule} from './helpers/locale.mjs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
function load(path, imports) {
  const code = ts.transpileModule(read(path), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}}).outputText
  const module = {exports: {}}
  new Function('require','module','exports',code)(name => {assert.ok(name in imports, name); return imports[name]},module,module.exports)
  return module.exports
}
const icons = new Proxy({}, {get: () => () => null})
const cn = (...values) => values.filter(Boolean).join(' ')
const inertUi = {ControlButton: ({children,variant,size,...props}) => React.createElement('button',props,children),StatusBadge:({children})=>React.createElement('span',null,children),Tooltip:({children})=>children,MediaThumb:()=>null,IconAction:()=>null,SegmentedControl:({options})=>React.createElement('div',null,options.map(item=>React.createElement('span',{key:item.value},englishText(item.label))))}
const base = {react:React,'react/jsx-runtime':runtime,'lucide-react':icons,'@/lib/utils':{cn},'@/lib/studio/i18n':englishLocale,'./ui':inertUi}
const html = (type,props) => renderToStaticMarkup(React.createElement(type,props))

test('locale provider toggles both ways, updates html language, remembers reloads, and synchronizes tabs',()=>{
  const originalWindow=globalThis.window,originalDocument=globalThis.document
  const saved=new Map(),listeners=new Map()
  globalThis.window={localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)},addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)}
  globalThis.document={documentElement:{lang:''}}
  const harness=()=>{
    const slots=[],effects=[];let cursor=0
    const hooks={createContext:()=>({Provider:'provider'}),useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next]},useCallback:fn=>fn,useMemo:fn=>fn(),useContext:()=>null,useEffect:(fn,deps)=>{const i=cursor++,old=slots[i];if(!old||deps.some((value,index)=>!Object.is(value,old.deps[index])))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()}})}}
    const module=compileLocaleModule('lib/studio/i18n.tsx',{react:hooks,'react/jsx-runtime':{jsx:(type,props)=>({type,props})},'./ui-translation':{translateUiText}})
    return{render:()=>{cursor=0;const tree=module.LocaleProvider({children:'draft'});effects.splice(0).forEach(fn=>fn());return tree},cleanup:()=>slots.forEach(slot=>slot?.cleanup?.())}
  }
  let current
  try{
    current=harness();let tree=current.render();assert.equal(tree.props.value.locale,'zh-CN')
    tree.props.value.toggleLocale();tree=current.render()
    assert.equal(tree.props.value.locale,'en-US');assert.equal(tree.props.value.text('视频生成'),'Video generation');assert.equal(document.documentElement.lang,'en-US')
    assert.equal(saved.get('oaooao-locale'),'en-US');assert.equal(tree.props.children,'draft')
    current.cleanup();current=harness();current.render();tree=current.render()
    assert.equal(tree.props.value.locale,'en-US')
    listeners.get('storage')({key:'other-key',newValue:'zh-CN'});assert.equal(current.render().props.value.locale,'en-US')
    listeners.get('storage')({key:'oaooao-locale',newValue:'zh-CN'});tree=current.render();assert.equal(tree.props.value.text('视频生成'),'视频生成')
    tree.props.value.toggleLocale();current.render().props.value.toggleLocale();assert.equal(current.render().props.value.locale,'zh-CN')
  }finally{current?.cleanup();globalThis.window=originalWindow;globalThis.document=originalDocument}
})

test('English copy formats owned prices and durations without translating interpolation values or arbitrary content',()=>{
  assert.equal(englishText('{0} 积分',[560]),'560 credits')
  assert.equal(englishText('自选模型 · 按参数计价'),'自选模型 · Priced by parameters')
  assert.equal(englishText('gpt-image · 5 积分/次'),'gpt-image · 5 credits/request')
  assert.equal(englishText('预计消耗 50 积分'),'Estimated cost: 50 credits')
  assert.equal(englishText('消耗 20 积分 · 已退回'),'Used 20 credits · Refunded')
  assert.equal(englishText('15 秒'),'15 s');assert.equal(chineseText('15 秒'),'15 秒')
  assert.equal(englishText('移除 {0}',['参考图片']),'Remove 参考图片')
  assert.equal(englishText('一只猫在抓老鼠'),'一只猫在抓老鼠')
  assert.equal(englishText('my-photo.png'),'my-photo.png')
})

test('navigation and page titles respond to English while preserving user project names',()=>{
  const nav=load('components/studio/studio-nav.tsx',{...base,'next/link':({children,...props})=>React.createElement('a',props,children),'next/navigation':{useRouter:()=>({push(){}})}})
  const assetItem=nav.studioPrimaryNav.find(item=>item.href==='/assets')
  assert.ok(assetItem)
  const result=html(nav.StudioNavLink,{item:assetItem,pathname:'/assets'})
  assert.match(result,/Creative assets/);assert.doesNotMatch(result,/创作资产/)
  assert.equal(nav.localizedStudioPageTitle('/video',undefined,englishText),'Video generation')
  assert.equal(nav.localizedStudioPageTitle('/projects/one/shots','参考图片',englishText),'参考图片 · Shots')
})

test('workspace uploads, frame options, preview, and duration show English and retain canonical values',()=>{
  const kit=load('components/studio/workspace-kit.tsx',base)
  const upload=html(kit.ReferenceUploader,{items:[],onItemsChange(){},maxFiles:9,onPickFromLibrary(){}})
  for(const label of ['Reference images','Upload reference images','Choose files','Choose from library','Up to 9 files'])assert.ok(upload.includes(label),label)
  assert.doesNotMatch(upload,/[\u3400-\u9fff]/)
  const options=html(kit.OptionGrid,{value:'frames',onChange(){},options:[{value:'text',label:'文生视频'},{value:'frames',label:'首尾帧'}]})
  assert.match(options,/Text to video/);assert.match(options,/First \/ last frame/)
  const stage=html(kit.ResultStage,{view:'single',onViewChange(){},viewOptions:[],ratio:'16:9',status:'done',statusLabel:'已完成',emptyHint:'',isEmpty:false,mediaKind:'video',resultCount:1,children:'kept'})
  assert.match(stage,/Video preview/);assert.match(stage,/Completed/)
  const slider=load('components/studio/video-duration-slider.tsx',base)
  const output=html(slider.VideoDurationSlider,{value:'6 秒',options:['4 秒','6 秒','8 秒'],onChange(){}})
  assert.match(output,/Video duration/);assert.match(output,/6 s/);assert.doesNotMatch(output,/秒/)
  let changed
  const jsx=(type,props)=>({type,props})
  const direct=load('components/studio/video-duration-slider.tsx',{...base,react:{useId:()=> 'duration'},'react/jsx-runtime':{jsx,jsxs:jsx}})
  const all=node=>node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).flatMap(all)]:[]
  all(direct.VideoDurationSlider({value:'6 秒',options:['4 秒','6 秒','8 秒'],onChange:value=>changed=value})).find(node=>node.type==='input').props.onChange({target:{value:'2'}})
  assert.equal(changed,'8 秒')
})

test('actual account language action changes locale and closes only the menu',()=>{
  const source=read('components/studio/topbar.tsx'),ast=ts.createSourceFile('topbar.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  let handler
  const visit=node=>{if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(ast)==='button'&&node.getText(ast).includes('<Languages'))handler=node.openingElement.attributes.properties.find(p=>p.name?.text==='onClick').initializer.expression;ts.forEachChild(node,visit)};visit(ast)
  assert.ok(handler)
  let locale='zh-CN',open=true
  const code=ts.transpileModule(`module.exports=${handler.getText(ast)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,module={exports:{}}
  new Function('module','toggleLocale','setAccountOpen',code)(module,()=>locale=locale==='zh-CN'?'en-US':'zh-CN',value=>open=value)
  module.exports();assert.equal(locale,'en-US');assert.equal(open,false)
})

test('English check-in uses the immutable claim and expiry without changing business dates',()=>{
  const {checkInDisplay}=compileLocaleModule('lib/studio/check-in-rules.ts')
  const status={enabled:true,claimed:true,date:'2026-11-05',timeZone:'Asia/Shanghai',rewardPoints:900,claimedRewardPoints:15,claimedPlanName:'我的套餐',expiresAt:'2026-11-06T00:00:00Z',claimedValidityDays:1}
  const result=checkInDisplay(status,'en-US')
  assert.equal(result.title,'Claimed 15 credits today');assert.match(result.rule,/我的套餐/);assert.match(result.validity,/Beijing time/)
  assert.equal(status.date,'2026-11-05')
})

test('both workspaces keep typed prompts and the resolved media payload when English is active',async()=>{
  const source=read('components/studio/workspaces.tsx'),ast=ts.createSourceFile('workspaces.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  for(const name of ['ImageWorkspace','VideoWorkspace']){
    const node=ast.statements.find(item=>ts.isFunctionDeclaration(item)&&item.name?.text===name)
    const submit=node.body.statements.find(item=>ts.isFunctionDeclaration(item)&&item.name?.text==='submit')
    const references=[{id:'first',type:'image',url:'https://example.invalid/参考图片.png',role:'first_frame'}]
    const prompt='一只猫在抓老鼠，保持背景',payloads=[]
    const values={tx:englishText,submitBlock:'',prompt,liveReady:true,submitting:false,setSubmitting(){},resolveImageReferences:async()=>references,resolveVideoReferences:async()=>references,count:'1',maxBatch:1,generation:{createImage:async payload=>payloads.push(payload),createVideo:async payload=>payloads.push(payload)},model:{id:'canonical-model'},ratio:'16:9',resolution:'1K',quality:'480p',duration:'15 秒',advancedValues:{},resolveGenerationKind:()=> 'edit',state:{selectedProjectId:null},setNotice(){},serializePromptReferences:value=>value,privateVideo:undefined,privateOptions:{}}
    const code=ts.transpileModule(`export ${submit.getText(ast)}`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,module={exports:{}}
    new Function('module','exports',...Object.keys(values),code)(module,module.exports,...Object.values(values))
    await module.exports.submit({preventDefault(){}})
    assert.equal(payloads.length,1);assert.equal(payloads[0].prompt,prompt);assert.equal(payloads[0].references,references);assert.equal(payloads[0].model,'canonical-model')
    if(name==='VideoWorkspace'){assert.equal(payloads[0].seconds,15);assert.equal(payloads[0].quality,'480p')}
  }
})

test('completed task chrome is English while the saved task title remains unchanged',()=>{
  const live=load('components/studio/live-generation.tsx',{...base,'@/lib/studio/generation-store':{useGeneration:()=>({})},'@/lib/studio/generation-api':{isActiveStatus:()=>false}})
  const output=html(live.GenerationTaskCard,{compact:true,task:{id:'12345678',title:'一只猫在抓老鼠',model:'canonical-model',status:'success',media:[],pointsCost:20,createdAt:Date.UTC(2026,10,5)}})
  assert.match(output,/Completed/);assert.match(output,/Used 20 credits/);assert.match(output,/一只猫在抓老鼠/)
})
