import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function load(path, imports = {}) {
  const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require','module','exports',code)(name => { assert.ok(name in imports, name); return imports[name] },module,module.exports)
  return module.exports
}
const jsx = { jsx:(type,props)=>({type,props}), jsxs:(type,props)=>({type,props}) }
const all = node => node && typeof node === 'object' ? [node,...[node.props?.children].flat(Infinity).flatMap(all)] : []
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const membership = load('lib/studio/membership.ts')
const models = load('lib/studio/studio-models.ts')
const team = load('lib/studio/team-generation.ts',{'./studio-models':models})
const draft = load('lib/studio/product-draft.ts')
function hooks() {
  const states=[];let index=0
  return { react:{useState(initial){const key=index++;if(!(key in states))states[key]=typeof initial==='function'?initial():initial;return[states[key],value=>{states[key]=typeof value==='function'?value(states[key]):value}]},useId:()=> 'synthetic-id',useMemo:fn=>fn()},render(fn){index=0;return fn()} }
}

test('every solid and gradient palette survives product save conversion and cycle-specific display without changing automatic colors', () => {
  assert.equal(membership.allPlanTones.length,12);assert.equal(membership.gradientPlanTones.length,4)
  const product={id:'plan',name:'Synthetic',productKind:'plan',planId:'pro',amountCents:9900,currency:'CNY',pointsAmount:100,dailyPoints:0,periodDays:30,enabled:true,sortOrder:0}
  for(const tone of membership.allPlanTones){
    const value=draft.productToDraft({...product,metadata:{membership:{tone}}})
    const saved=draft.draftToPayload(value)
    assert.equal(saved.metadata.membership.tone,tone)
    const view=membership.toMembershipPlans([{...product,...saved}])[0]
    assert.equal(membership.resolveTierDisplay(view.tiers[0],'monthly').tone,tone)
  }
  const automatic=draft.draftToPayload(draft.productToDraft(product))
  assert.equal(Object.hasOwn(automatic.metadata.membership,'tone'),false)
  assert.deepEqual(membership.tones,['standard','advanced','premium','luxury','ultimate'])
})

test('the shared palette selector exposes all choices with selected state and applies a gradient through the same handler',()=>{
  let chosen='ultimate'
  const style=new Proxy({},{get:(_,key)=>key})
  const picker=load('components/studio/plan-tone-picker.tsx',{'react/jsx-runtime':jsx,'lucide-react':{Check:'Check'},'@/lib/studio/membership':membership,'@/components/membership/membership.module.css':{default:style},'./admin-kit':{AdminSelect:'AdminSelect'}})
  const render=()=>picker.PlanTonePicker({value:chosen,allowAutomatic:true,onChange:value=>{chosen=value}})
  const buttons=all(render()).filter(node=>node.type==='button')
  assert.equal(buttons.length,12);assert.equal(buttons.filter(node=>node.props['aria-pressed']).length,1)
  buttons.find(node=>node.props['data-tone']==='sunset').props.onClick()
  assert.equal(chosen,'sunset');assert.equal(all(render()).find(node=>node.props['data-tone']==='sunset').props['aria-pressed'],true)
})

test('model scope controls distinguish all, selected and none while retaining missing historical selections',()=>{
  const h=hooks();let value
  const control=load('components/studio/plan-model-control.tsx',{react:h.react,'react/jsx-runtime':jsx,'lucide-react':{Search:'Search'},'./ui':{ControlButton:'ControlButton'},'./admin-kit':{AdminInput:'AdminInput',AdminSelect:'AdminSelect'}})
  const render=()=>h.render(()=>control.PlanModelControl({models:[{id:'a',name:'Alpha',capability:'image',enabled:true},{id:'b',name:'Beta',capability:'video',enabled:true}],value,onChange:next=>{value=next}}))
  all(render()).find(node=>node.type==='AdminSelect').props.onChange({target:{value:'selected'}})
  assert.deepEqual(value,[])
  all(render()).find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}})
  assert.deepEqual(value,['a'])
  value=['a','removed']
  assert.ok(text(render()).includes('已移除的模型'))
  all(render()).find(node=>node.type==='ControlButton'&&text(node)==='清空选择').props.onClick()
  assert.deepEqual(value,[])
  all(render()).find(node=>node.type==='AdminSelect').props.onChange({target:{value:'all'}})
  assert.equal(value,undefined)
})

test('personal model restrictions filter every request alias but never reduce the independent team catalog',()=>{
  const catalog=['a','b'].map(id=>({id,name:id,enabled:true,capability:'image',bindings:[{id,enabled:true,requestAlias:id+'-route',channelId:'fixture',upstreamModel:id,priority:0}]}))
  const settings={logicalModels:catalog,personalModelIds:['a']}
  const personal=models.modelsFromSession(settings)
  assert.deepEqual(personal.map(item=>item.id),['a-route'])
  assert.deepEqual(team.availableTeamModels(personal,['b'],settings).map(item=>item.id),['b-route'])
  assert.deepEqual(models.modelsFromSession({...settings,personalModelIds:[]}),[])
})
