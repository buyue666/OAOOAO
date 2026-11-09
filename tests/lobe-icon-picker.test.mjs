import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function load(path,imports={}) {
  const module={exports:{}}
  const source=readFileSync(new URL(path,import.meta.url),'utf8')
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
  new Function('require','module','exports',code)(name=>{assert.ok(name in imports,`Unexpected import ${name}`);return imports[name]},module,module.exports)
  return module.exports
}
const all=node=>node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).flatMap(all)]:[]
const text=node=>typeof node==='string'?node:node&&typeof node==='object'?[node.props?.children].flat(Infinity).map(text).join(''):''
const imports={'@/lib/studio/model-icon-style':load('../lib/studio/model-icon-style.ts'),react:{},'react-dom':{},'react/jsx-runtime':{},'lucide-react':{},'@/lib/utils':{cn:(...values)=>values.filter(Boolean).join(' ')},'./admin-kit':{AdminInput:'Input'}}
const picker=load('../components/studio/lobe-icon-picker.tsx',imports)

test('icon surface aligns to the trigger end within drawer and viewport bounds, flipping above near the bottom',()=>{
  const bounds={left:752,right:1920,top:0,bottom:920}
  const position=picker.iconPickerPosition({left:1500,right:1690,top:465,bottom:501},bounds)
  assert.equal(position.left,1260)
  assert.equal(position.top,507)
  assert.ok(position.left>=bounds.left+12&&position.left+position.width<=bounds.right-12)
  assert.ok(position.top+position.maxHeight<=bounds.bottom-12)
  const above=picker.iconPickerPosition({left:1500,right:1690,top:780,bottom:816},bounds)
  assert.ok(above.top+above.maxHeight<780)
  assert.ok(above.top>=12)
  const mobile=picker.iconPickerPosition({left:210,right:350,top:340,bottom:380},{left:0,right:375,top:0,bottom:667})
  assert.equal(mobile.width,351)
  assert.equal(mobile.left,12)
  assert.ok(mobile.top+mobile.maxHeight<=655)
})

function harness(value) {
  const previous={window:globalThis.window,document:globalThis.document}
  const events=new Map(),timers=new Map(),slots=[],effects=[],changes=[],focus=[]
  let cursor=0,sequence=0,scrollLeft=0
  const rect={left:1500,right:1690,top:465,bottom:501}
  const bounds={left:752,right:1920,top:0,bottom:920}
  const attach=(name,event,callback)=>events.set(name+':'+event,callback)
  const detach=(name,event,callback)=>{if(events.get(name+':'+event)===callback)events.delete(name+':'+event)}
  const doc={body:{name:'body'},addEventListener:(event,callback)=>attach('document',event,callback),removeEventListener:(event,callback)=>detach('document',event,callback)}
  globalThis.document=doc
  globalThis.window={innerWidth:1920,innerHeight:920,addEventListener:(event,callback)=>attach('window',event,callback),removeEventListener:(event,callback)=>detach('window',event,callback),setTimeout:callback=>{timers.set(++sequence,callback);return sequence},clearTimeout:id=>timers.delete(id)}
  const focusable=name=>({focus:options=>{focus.push({name,options});if(!options?.preventScroll)scrollLeft=300}})
  const trigger={...focusable('trigger'),getBoundingClientRect:()=>rect,closest:()=>({getBoundingClientRect:()=>bounds}),contains:target=>target===trigger}
  const search={...focusable('search')}
  const panel={contains:target=>target===panel||target===search}
  const effect=(callback,deps)=>{const i=cursor++;const old=slots[i];if(!old||deps.some((value,index)=>!Object.is(old.deps[index],value)))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:callback()}})}
  const react={useId:()=>{cursor++;return 'icon-panel'},useRef:initial=>{const i=cursor++;return slots[i]||=( {current:initial})},useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]},useMemo:fn=>fn(),useLayoutEffect:effect,useEffect:effect}
  const jsx=(type,props)=>({type,props})
  const api=load('../components/studio/lobe-icon-picker.tsx',{...imports,react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-dom':{createPortal:(node,target)=>({type:'portal',props:{children:node,target}})}})
  const render=()=>{
    cursor=0
    const tree=api.LobeIconPicker({value,onChange:next=>{changes.push(next);value=next}})
    for(const node of all(tree))if(node.props?.ref)node.props.ref.current=node.props['data-lobe-icon-popover']!==undefined?panel:node.props['aria-label']==='搜索图标'?search:trigger
    effects.splice(0).forEach(run=>run())
    return all(tree)
  }
  return{render,changes,focus,timers,events,trigger,panel,search,rect,scrollLeft:()=>scrollLeft,cleanup:()=>{for(const slot of slots)slot?.cleanup?.();globalThis.window=previous.window;globalThis.document=previous.document}}
}

test('an unset default icon shows a placeholder instead of falsely selecting the first catalog item',()=>{
  const h=harness()
  try {
    const trigger=h.render().find(node=>node.props?.['aria-haspopup']==='dialog')
    assert.match(text(trigger),/选择图标/)
    assert.doesNotMatch(text(trigger),/OpenAI/)
    assert.equal(trigger.props['aria-expanded'],false)
  } finally {h.cleanup()}
})

test('real icon picker renders outside the drawer and focuses and restores focus without horizontal scrolling',()=>{
  const h=harness()
  try {
    h.render().find(node=>node.props?.['aria-haspopup']==='dialog').props.onClick()
    h.render()
    const tree=h.render(),portal=tree.find(node=>node.type==='portal'),panel=tree.find(node=>node.props?.['data-lobe-icon-popover']!==undefined)
    assert.equal(portal.props.target,globalThis.document.body)
    assert.match(panel.props.className,/fixed/)
    assert.equal(panel.props.style.left,1260)
    assert.equal(tree.find(node=>node.props?.['aria-label']==='搜索图标').props.autoFocus,undefined)
    assert.deepEqual(h.focus[0],{name:'search',options:{preventScroll:true}})
    assert.match(text(panel),/保存路由配置后生效/)
    tree.find(node=>node.type==='button'&&node.props.title==='MiniMax · 模型').props.onClick()
    assert.match(h.changes[0],/minimax-color\.svg$/)
    assert.deepEqual(h.focus.at(-1),{name:'trigger',options:{preventScroll:true}})
    assert.equal(h.render().some(node=>node.type==='portal'),false)
    assert.equal(h.scrollLeft(),0)
    assert.equal(h.events.size,0)
    assert.equal(h.timers.size,0)
  } finally {h.cleanup()}
})

test('Escape closes only the picker and pointer dismissal does not return focus to the trigger',()=>{
  const h=harness()
  const open=()=>{h.render().find(node=>node.props?.['aria-haspopup']==='dialog').props.onClick();h.render();h.render()}
  try {
    open()
    const event={key:'Escape',preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true}}
    h.events.get('document:keydown')(event)
    assert.equal(event.prevented,true);assert.equal(event.stopped,true)
    assert.equal(h.render().some(node=>node.type==='portal'),false)
    assert.equal(h.scrollLeft(),0)
    open()
    h.events.get('document:pointerdown')({target:h.search})
    assert.ok(h.render().some(node=>node.type==='portal'))
    const focusCount=h.focus.length
    h.events.get('document:pointerdown')({target:{}})
    assert.equal(h.render().some(node=>node.type==='portal'),false)
    assert.equal(h.focus.length,focusCount)
    assert.deepEqual(h.changes,[])
  } finally {h.cleanup()}
})

test('scrolling and resizing move the floating surface instead of changing the form layout',()=>{
  const h=harness()
  try {
    h.render().find(node=>node.props?.['aria-haspopup']==='dialog').props.onClick();h.render()
    h.rect.top=780;h.rect.bottom=816
    h.events.get('window:scroll')({target:{}})
    const surface=h.render().find(node=>node.props?.['data-lobe-icon-popover']!==undefined)
    assert.ok(surface.props.style.top+surface.props.style.maxHeight<780)
    assert.equal(h.scrollLeft(),0)
    h.rect.top=-80;h.rect.bottom=-44
    h.events.get('window:scroll')({target:{}})
    assert.equal(h.render().some(node=>node.type==='portal'),false)
  } finally {h.cleanup()}
})

test('all front-end entries use the model default and ignore legacy binding overrides',()=>{
  const {modelsFromSession}=load('../lib/studio/studio-models.ts')
  const binding={id:'route',channelId:'provider',requestAlias:'video-account-one',upstreamModel:'video-model',enabled:true,priority:1,iconUrl:'https://example.invalid/route.svg'}
  const model={id:'video',name:'视频',capability:'video',enabled:true,iconUrl:'https://example.invalid/default.svg',bindings:[binding,{...binding,id:'other',channelId:'other',requestAlias:'video-account-two',iconUrl:'https://example.invalid/other.svg'}]}
  const results=()=>modelsFromSession({logicalModels:[model]})
  assert.ok(results().length>=2)
  assert.ok(results().every(item=>item.iconUrl===model.iconUrl))
  model.iconUrl='https://example.invalid/changed.svg'
  assert.ok(results().every(item=>item.iconUrl===model.iconUrl))
  delete model.iconUrl;assert.ok(results().every(item=>item.iconUrl===undefined))
})
