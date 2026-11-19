import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const compiled=ts.transpileModule(readFileSync(new URL('../lib/studio/model-display.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const module={exports:{}};new Function('module','exports',compiled)(module,module.exports)
const {publicModelLabel}=module.exports
const settings={logicalModels:[{id:'private-video-route',name:'Public Video Model',aliases:['legacy-private-route'],bindings:[{upstreamModel:'upstream-secret',requestAlias:'Public Pro'}]}]}

test('internal model IDs, upstream names and historical aliases use public catalog labels',()=>{
  for(const name of ['private-video-route','legacy-private-route','upstream-secret','Public Video Model'])assert.equal(publicModelLabel(name,settings),'Public Video Model')
  assert.equal(publicModelLabel('Public Pro',settings),'Public Pro')
  assert.equal(publicModelLabel('removed-internal-model',settings),'历史模型')
  assert.equal(publicModelLabel(''),'未记录模型')
  assert.equal(publicModelLabel('private-video-route'),'历史模型')
})

test('ambiguous upstream routing never leaks an ID or picks an arbitrary public name',()=>{
  const ambiguous={logicalModels:[...settings.logicalModels,{id:'other-private',name:'Other Public Model',bindings:[{upstreamModel:'upstream-secret'}]}]}
  assert.equal(publicModelLabel('upstream-secret',ambiguous),'历史模型')
  assert.equal(publicModelLabel('private-video-route',ambiguous),'Public Video Model')
})

test('the actual all-results tile displays the public label while downloading with the original URL',()=>{
  const source=readFileSync(new URL('../components/studio/workspaces.tsx',import.meta.url),'utf8')
  const start=source.indexOf('function ResultTile('),end=source.indexOf('\nfunction getMediaRatio',start)
  const code=ts.transpileModule(source.slice(start,end)+'\nexport {ResultTile}',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
  const exports={};const jsx=(type,props)=>({type,props})
  const api={'react/jsx-runtime':{jsx,jsxs:jsx}}
  const dependencies=['useUiText','useStudio','cn','ratioToCss','MediaThumb','Check','Tooltip','IconAction','Maximize2','MediaDownloadButton','MoreHorizontal','publicModelLabel']
  const values=[()=>s=>s,()=>({state:{sessionSettings:settings}}),(...v)=>v.filter(Boolean).join(' '),()=>1,'MediaThumb','Check','Tooltip','IconAction','Maximize2','MediaDownloadButton','MoreHorizontal',publicModelLabel]
  new Function('require','exports',...dependencies,code)(name=>api[name],exports,...values)
  const work={id:'result-1',src:'/api/reference-assets/12345678-1234-1234-1234-123456789abc',kind:'video',title:'Video',model:'private-video-route',ratio:'16:9'}
  const tree=exports.ResultTile({work,ratio:'16:9',selected:false,onSelect(){},onOpen(){},label:'结果 1'})
  const all=n=>n&&typeof n==='object'?[n,...[n.props?.children].flat(Infinity).flatMap(all)]:[]
  const nodes=all(tree),texts=nodes.flatMap(n=>[n.props?.children].flat(Infinity)).filter(v=>typeof v==='string')
  assert.ok(texts.includes('Public Video Model'));assert.ok(!texts.includes('private-video-route'))
  assert.equal(nodes.find(n=>n.type==='MediaDownloadButton').props.media.url,work.src)
})
