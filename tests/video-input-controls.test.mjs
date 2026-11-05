import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import * as jsxRuntime from 'react/jsx-runtime'
import {chineseLocale} from './helpers/locale.mjs'

function load(path, imports = {}) {
  imports = {'@/lib/studio/i18n': chineseLocale, ...imports}
  const module = {exports: {}}
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText
  new Function('require', 'module', 'exports', code)(name => {assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]}, module, module.exports)
  return module.exports
}
const mentions = load('../lib/studio/prompt-references.ts')
const build = load('../lib/studio/video-references.ts').buildVideoReferences
const referencePolicy = load('../lib/studio/video-policy.ts')
const sessionModels = load('../lib/studio/studio-models.ts')

test('session models expose the configured total ceiling without raising upstream limits',()=>{
  const profile={supportsReferenceImage:true,maxReferences:15,maxReferenceImages:9,videoBillingUnit:'second'}
  const session={logicalModels:[{id:'video',name:'视频',capability:'video',enabled:true,bindings:[{id:'one',channelId:'one',upstreamModel:'video-model',enabled:true,priority:1,capabilityProfile:profile}]}]}
  const limit=()=>sessionModels.modelsFromSession(session)[0].capabilities.maxReferences
  assert.equal(limit(),15)
  profile.videoReferenceTotalLimit=8;assert.equal(limit(),8)
  profile.videoReferenceTotalLimit=100;assert.equal(limit(),15)
  profile.videoReferenceTotalLimit=0;assert.equal(limit(),15)
})

test('mixed upload limits count library files by type and share the total ceiling',()=>{
  const policy={supportsVideoReference:true,supportsAudioReference:true,referenceLimits:{image:9,video:3,audio:3}}
  const model={capabilities:{maxReferences:15,videoPolicy:policy,privateVideo:policy}}
  const selected=[{kind:'image'},{kind:'scene'},{kind:'video'},{kind:'video'},{kind:'audio'}]
  const uploads={image:5,video:1,audio:2}
  assert.equal(referencePolicy.videoReferenceUploadLimit(model,'video',selected,uploads),1,'selected videos consume the same three-video limit')
  assert.equal(referencePolicy.videoReferenceUploadLimit(model,'image',selected,uploads),7)
  assert.equal(referencePolicy.videoReferenceUploadLimit(model,'audio',selected,uploads),2)
  model.capabilities.maxReferences=10
  assert.equal(referencePolicy.videoReferenceUploadLimit(model,'image',selected,uploads),2,'all media types consume the total allowance')
})

function workspaceHarness(name, props) {
  const slots=[], effects=[]; let cursor=0
  const react={useId:()=>{cursor++;return 'params'},useRef:value=>{const i=cursor++;return slots[i] ||= {current:value}},useState:value=>{const i=cursor++;if(!(i in slots))slots[i]=value;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next]},useEffect:(callback,deps)=>{const i=cursor++;const previous=slots[i];if(!previous||deps.some((value,index)=>!Object.is(value,previous.deps[index])))effects.push(()=>{previous?.cleanup?.();slots[i]={deps,cleanup:callback()}})}}
  const jsx=(type,props)=>({type,props})
  const api=load('../components/studio/workspace-kit.tsx',{react,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':new Proxy({},{get:(_,key)=>key}),'@/lib/utils':{cn:(...values)=>values.filter(Boolean).join(' ')},'./ui':Object.fromEntries(['ControlButton','IconAction','MediaThumb','Notice','SegmentedControl','StatusBadge','Tooltip'].map(name=>[name,name]))})
  const nodes=node=>node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).flatMap(nodes)]:[]
  return {render:()=>{cursor=0;const tree=api[name](props);effects.splice(0).forEach(effect=>effect());return nodes(tree)},cleanup:()=>slots.forEach(slot=>slot?.cleanup?.())}
}

test('fullscreen restores the previous dock and preserves the same parameter subtree through minimize',()=>{
  const previous=globalThis.window
  globalThis.window={localStorage:{getItem:()=>null,setItem(){}}}
  const params={type:'input',props:{defaultValue:'保留提示词'}}
  const h=workspaceHarness('WorkspaceShell',{params,stage:'结果',onSubmit(){},submitLabel:'生成',credits:1})
  const render=()=>h.render(),move=value=>render().find(node=>node.type==='select').props.onChange({target:{value}})
  try{
    move('right');move('fullscreen')
    assert.equal(render()[0].props['data-panel-position'],'fullscreen')
    assert.ok(render().includes(params))
    assert.equal(render().find(node=>node.type==='section').props.inert,true)
    render().find(node=>node.props?.['aria-label']==='缩小参数面板').props.onClick()
    assert.equal(render()[0].props['data-panel-minimized'],true)
    assert.equal(render().find(node=>node.type==='section').props.inert,false)
    assert.ok(render().includes(params))
    render().find(node=>node.props?.['aria-label']==='展开参数面板').props.onClick()
    const event={key:'Escape',defaultPrevented:false,preventDefault(){this.defaultPrevented=true}}
    render()[0].props.onKeyDown(event)
    assert.equal(event.defaultPrevented,true)
    assert.equal(render()[0].props['data-panel-position'],'right')
    assert.ok(render().includes(params))
  }finally{h.cleanup();globalThis.window=previous}
})

test('upload success expires after three seconds while warnings remain and replacement cancels the old timer',async()=>{
  const previousWindow=globalThis.window,previousReader=globalThis.FileReader
  const timers=new Map();let sequence=0,items=[]
  globalThis.window={setTimeout:(callback,ms)=>{const id=++sequence;timers.set(id,{callback,ms});return id},clearTimeout:id=>timers.delete(id)}
  globalThis.FileReader=class{readAsDataURL(){this.result='data:image/png;base64,AA==';this.onload?.()}}
  const props={items,onItemsChange:next=>{items=next;props.items=next},maxFiles:6}
  const h=workspaceHarness('ReferenceUploader',props)
  const add=async(name,type)=>{h.render().find(node=>node.type==='input'&&node.props.type==='file').props.onChange({target:{files:[new File(['synthetic'],name,{type})],value:name}});await Promise.resolve();return h.render()}
  const notice=()=>h.render().find(node=>node.type==='Notice')
  try{
    await add('one.png','image/png')
    assert.equal(notice().props.tone,'accent');assert.equal(timers.size,1)
    assert.equal([...timers.values()][0].ms,3000)
    const first=[...timers.keys()][0]
    await add('two.png','image/png')
    assert.equal(timers.has(first),false);assert.equal(timers.size,1)
    ;[...timers.values()][0].callback()
    assert.equal(notice(),undefined);assert.equal(timers.size,0)
    await add('three.png','image/png')
    await add('invalid.txt','text/plain')
    assert.equal(notice().props.tone,'warning');assert.equal(timers.size,0)
    assert.equal(items.length,3)
  }finally{h.cleanup();items.forEach(item=>URL.revokeObjectURL(item.preview));globalThis.window=previousWindow;globalThis.FileReader=previousReader}
})

test('mention lookup and insertion preserve Chinese text on both sides of the caret', () => {
  assert.deepEqual(mentions.referenceMentionQuery('让 @人物 保持微笑', 5), {start: 2, query: '人物'})
  const result = mentions.insertReferenceMention('让 @人物 保持微笑', 2, 5, 1)
  assert.equal(result.value, '让 @2 保持微笑')
  assert.equal(result.caret, 5)
  assert.equal(mentions.referenceMentionQuery('让 @1 保持微笑', 9), undefined)
  assert.deepEqual(mentions.referenceMentionQuery('@1 与 @', 6), {start: 5, query: ''})
})

test('picker numbering follows submitted files for every input mode', () => {
  const ref = (id, type = 'image') => ({id, name: id, type, url: `https://example.invalid/${id}`})
  const groups = {first: [ref('first')], last: [ref('last')], source: [ref('source', 'video')], references: [ref('library'), ref('upload'), ref('video', 'video'), ref('audio', 'audio')]}
  for (const mode of ['text', 'first', 'ends', 'mixed', 'frames', 'references', 'edit']) {
    const active = mode === 'mixed' || mode === 'frames' ? {...groups,references:groups.references.filter(item=>item.type!=='video')} : groups
    const expected = build({...active, mode, frameReferenceTypes:['image','audio'], maxReferences: 8}).map(item => item.id)
    assert.deepEqual(mentions.orderedPromptReferences(mode, active).map(item => item.id), expected, mode)
  }
  assert.deepEqual(mentions.orderedPromptReferences('text', groups, false), [])
  assert.deepEqual(mentions.orderedPromptReferences('extend', groups), [])
})

test('typed material labels map to the submitted reference order and preserve legacy mentions',()=>{
  const references=[{type:'image'},{type:'video'},{type:'image'},{type:'audio'}]
  assert.deepEqual(references.map((_,index)=>mentions.referenceMentionLabel(references,index)),['@图1','@视频1','@图2','@音频1'])
  const value='让 @图2 参考 @视频1动作，用 @图1 背景和 @音频1，保留 @3。'
  assert.equal(mentions.serializePromptReferences(value,references),'让 @3 参考 @2动作，用 @1 背景和 @4，保留 @3。')
  assert.deepEqual(mentions.promptReferenceMentions('@图10 @图0 @1abc @视频2',references),[])
  assert.equal(mentions.serializePromptReferences('@图片1',references),'@1')
  assert.equal(mentions.serializePromptReferences('@图1',[{}]),'@1')
  const inserted=mentions.insertReferenceMention('使用 @视 的动作',3,5,1,references)
  assert.equal(inserted.value,'使用 @视频1 的动作')
  assert.equal(inserted.caret,8)
})

test('native prompt input renders highlighted labels, escaped text and an accessible plain value',()=>{
  const component=load('../components/studio/prompt-reference-input.tsx',{react:React,'react/jsx-runtime':jsxRuntime,'react-dom':{createPortal:node=>node},'lucide-react':{},'@/lib/studio/prompt-references':mentions}).PromptReferenceInput
  const value='让 @图1 和 @2 一起 <script>test</script>\n保持动作'
  const html=renderToStaticMarkup(React.createElement(component,{id:'image-prompt',value,onChange(){},references:[{id:'one',type:'image',name:'人物'},{id:'two',type:'image',name:'背景'}]}))
  assert.match(html,/<mark[^>]*prompt-reference-mention[^>]*>@图1<\/mark>/)
  assert.match(html,/<mark[^>]*prompt-reference-mention[^>]*>@2<\/mark>/)
  assert.match(html,/aria-hidden="true"/)
  assert.match(html,/<textarea[^>]*id="image-prompt"[^>]*role="combobox"/)
  assert.ok(html.includes('&lt;script&gt;test&lt;/script&gt;'))
  assert.ok(!html.includes('<script>test</script>'))
})

test('image and video submit handlers serialize labels only after resolving the actual references',async()=>{
  const source=readFileSync(new URL('../components/studio/workspaces.tsx',import.meta.url),'utf8')
  const parsed=ts.createSourceFile('workspace.tsx',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX)
  for(const name of ['ImageWorkspace','VideoWorkspace']){
    const workspace=parsed.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name)
    const submit=workspace.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='submit')
    const references=name==='ImageWorkspace'?[{type:'image',url:'https://example.invalid/one'},{type:'image',url:'https://example.invalid/two'}]:[{type:'image',url:'https://example.invalid/one'},{type:'video',url:'https://example.invalid/video'},{type:'image',url:'https://example.invalid/two'}]
    const payloads=[],notices=[]
    const bindings={submitBlock:'',prompt:name==='ImageWorkspace'?'画 @图2 与 @图1':'让 @图2 使用 @视频1 的动作',liveReady:true,submitting:false,setSubmitting(){},resolveImageReferences:async()=>references,resolveVideoReferences:async()=>references,count:'1',maxBatch:1,generation:{createImage:async payload=>payloads.push(payload),createVideo:async payload=>payloads.push(payload)},model:{id:'synthetic'},ratio:'16:9',resolution:'1K',quality:'480p',duration:'15 秒',advancedValues:{},resolveGenerationKind:()=> 'edit',state:{selectedProjectId:null},setNotice:value=>notices.push(value),serializePromptReferences:mentions.serializePromptReferences,privateVideo:undefined,privateOptions:{}}
    const code=ts.transpileModule(`export ${submit.getText(parsed)}`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
    const module={exports:{}}
    new Function('module','exports',...Object.keys(bindings),code)(module,module.exports,...Object.values(bindings))
    await module.exports.submit({preventDefault(){}})
    assert.equal(payloads.length,1,JSON.stringify(notices))
    assert.equal(payloads[0].prompt,name==='ImageWorkspace'?'画 @2 与 @1':'让 @3 使用 @2 的动作')
    assert.equal(payloads[0].references,references)
  }
})

test('fullscreen references sit directly below the prompt while docked controls retain their order',()=>{
  const component=load('../components/studio/workspace-kit.tsx',{react:React,'react/jsx-runtime':jsxRuntime,'lucide-react':{},'@/lib/utils':{cn:(...items)=>items.filter(Boolean).join(' ')},'./ui':{}}).WorkspaceParams
  const section=(layout,label)=>React.createElement('section',{layout,'data-layout':layout,key:layout},label)
  const html=renderToStaticMarkup(React.createElement(component,null,section('mode','模式'),section('prompt','提示词'),section('model','模型'),section('output','输出'),section('references','素材'),section('advanced','高级')))
  assert.match(html,/workspace-param-primary[^>]*><section[^>]*>提示词<\/section><\/div>/)
  assert.match(html,/workspace-param-settings[^>]*><section[^>]*>模型<\/section><section[^>]*>输出<\/section><section[^>]*>高级<\/section>/)
  assert.match(html,/workspace-param-references[^>]*><section[^>]*>素材<\/section><\/div>/)
  assert.ok(html.indexOf('workspace-param-references')>html.indexOf('>高级<'))
  assert.ok(html.indexOf('>模式<')<html.indexOf('workspace-param-columns'))
  const styles=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8')
  assert.match(styles,/\.workspace-param-columns\s*\{[^}]*grid-template-rows: min-content 1fr;/)
  assert.match(styles,/\.workspace-param-settings\s*\{ grid-column: 2; grid-row: 1 \/ span 2;/)
  assert.match(styles,/\.workspace-param-references\s*\{ grid-column: 1; grid-row: 2;/)
})

test('duration slider submits only supported slots and cannot manufacture an in-between duration', () => {
  const jsx = (type, props) => ({type, props})
  const slider = load('../components/studio/video-duration-slider.tsx', {react: {useId: () => 'duration'}, 'react/jsx-runtime': {jsx, jsxs: jsx}}).VideoDurationSlider
  const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
  const changes = []
  const input = nodes(slider({value: '6 秒', options: ['4 秒', '6 秒', '8 秒'], onChange: value => changes.push(value)})).find(node => node.type === 'input')
  assert.equal(input.props.value, 1)
  assert.equal(input.props.max, 2)
  input.props.onChange({target: {value: '2'}})
  input.props.onChange({target: {value: '99'}})
  assert.deepEqual(changes, ['8 秒'])
  for (const options of [[], ['8 秒']]) assert.equal(nodes(slider({value: '8 秒', options, onChange() {}})).find(node => node.type === 'input').props.disabled, true)
})

test('mention keyboard completion consumes Enter and Escape while leaving IME input alone', () => {
  const slots = []; let cursor = 0; let value = ''
  const react = {useEffect() {}, useLayoutEffect() {}, useId: () => 'references', useRef: initial => {const i = cursor++; return slots[i] ||= {current: initial}}, useState: initial => {const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => slots[i] = typeof next === 'function' ? next(slots[i]) : next]}}
  const jsx = (type, props) => ({type, props})
  const component = load('../components/studio/prompt-reference-input.tsx', {react, 'react/jsx-runtime': {jsx, jsxs: jsx}, 'react-dom': {createPortal: node => node}, 'lucide-react': {}, '@/lib/studio/prompt-references': mentions}).PromptReferenceInput
  const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
  const original = globalThis.document; globalThis.document = {body: {}}
  try {
    const render = () => {cursor = 0; return nodes(component({id: 'prompt', value, onChange: next => value = next, references: [{id: 'first', name: '首帧', type: 'image'}, {id: 'second', name: '人物', type: 'image'}]}))}
    const textarea = () => render().find(node => node.type === 'textarea')
    const native=textarea(),mirror=render().find(node=>node.props?.['aria-hidden']==='true'&&node.props.ref)
    native.props.ref.current={clientWidth:240,scrollTop:48,scrollLeft:6}
    mirror.props.ref.current={style:{},scrollTop:0,scrollLeft:0}
    native.props.onScroll()
    assert.equal(mirror.props.ref.current.style.width,'240px')
    assert.equal(mirror.props.ref.current.scrollTop,48)
    assert.equal(mirror.props.ref.current.scrollLeft,6)
    textarea().props.onChange({target: {value: '@', selectionStart: 1}})
    const event = key => ({key, nativeEvent: {isComposing: false}, prevented: false, stopped: false, preventDefault() {this.prevented = true}, stopPropagation() {this.stopped = true}})
    textarea().props.onKeyDown(event('ArrowDown'))
    const enter = event('Enter'); textarea().props.onKeyDown(enter)
    assert.equal(value, '@图2 '); assert.equal(enter.prevented, true)
    textarea().props.onChange({target: {value: '@', selectionStart: 1}})
    const ime = event('Enter'); ime.nativeEvent.isComposing = true; textarea().props.onKeyDown(ime)
    assert.equal(value, '@'); assert.equal(ime.prevented, false)
    const escape = event('Escape'); textarea().props.onKeyDown(escape)
    assert.equal(escape.prevented, true); assert.equal(escape.stopped, true)
    assert.equal(render().some(node => node.props?.role === 'listbox'), false)
  } finally {globalThis.document = original}
})
