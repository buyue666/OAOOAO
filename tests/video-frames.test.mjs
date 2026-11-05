import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
function evaluate(source,bindings={}) {
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
  const module={exports:{}}
  new Function('module','exports',...Object.keys(bindings),code)(module,module.exports,...Object.values(bindings))
  return module.exports
}
const helpers=evaluate(read('../lib/studio/video-references.ts'))
const policy=evaluate(read('../lib/studio/video-policy.ts'))
const source=read('../components/studio/workspaces.tsx')
const parsed=ts.createSourceFile('workspace.tsx',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX)
const workspace=parsed.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='VideoWorkspace')
const declarations=workspace.body.statements.filter(ts.isVariableStatement).flatMap(node=>[...node.declarationList.declarations])
const declaration=name=>declarations.find(node=>node.name.getText(parsed)===name)
const statement=name=>workspace.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(parsed)
const names=['frameMode','frameReferenceTypes','acceptsImageReferences','acceptsVideoReferences','acceptsAudioReferences','referenceKind','activeSelectedRefs','frameCount','reservedFrameCount','referenceUploadCounts','referenceUploadTotal','frameSlotLimit','durationMode']
const derived=names.map(name=>`const ${declaration(name).getText(parsed)}`).join('\n')
const asset=(id,kind='image')=>({id,title:id,kind,src:`https://example.invalid/${id}`})
const state=()=>{
  const feature={frameReferenceTypes:['image','audio'],supportsVideoReference:true,supportsAudioReference:true,referenceLimits:{image:9,video:3,audio:3}}
  const capabilities={firstFrame:true,lastFrame:true,maxReferences:15,videoPolicy:feature,privateVideo:feature}
  return{mode:'frames',capabilities,model:{capabilities},videoPolicy:feature,privateVideo:feature,isVideoFrameMode:helpers.isVideoFrameMode,videoReferenceLimit:policy.videoReferenceLimit,
    firstFrameRef:[asset('first')],lastFrameRef:[asset('last')],firstFrameUploads:[],lastFrameUploads:[],sourceVideoUploads:[],sourceVideoRef:[],uploads:[],videoRefUploads:[],audioRefUploads:[],selectedRefs:[asset('image'),asset('audio','audio'),asset('video','video')]}
}
const derive=env=>({...env,...evaluate(`${derived}\nmodule.exports={${names.join(',')}}`,env)})
const all=node=>node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).flatMap(all)]:[]

test('one frame mode allows a first image alone or an optional tail plus images and audio, never video',()=>{
  const ref=(id,type='image')=>({id,type,url:`https://example.invalid/${id}`})
  const input={mode:'frames',first:[ref('first')],last:[],source:[],references:[],maxReferences:15,frameReferenceTypes:['image','audio']}
  assert.deepEqual(helpers.buildVideoReferences(input).map(item=>item.role),['first_frame'])
  input.last=[ref('last')];input.references=[ref('image'),ref('audio','audio')]
  assert.deepEqual(helpers.buildVideoReferences(input).map(item=>item.role),['first_frame','last_frame','reference','reference'])
  assert.throws(()=>helpers.buildVideoReferences({...input,references:[ref('video','video')]}),/不支持参考视频/)
  assert.throws(()=>helpers.buildVideoReferences({...input,first:[ref('video','video')]}),/首帧图片/)
  assert.throws(()=>helpers.buildVideoReferences({...input,first:[]}),/首帧图片/)
  assert.throws(()=>helpers.buildVideoReferences({...input,maxReferences:3}),/最多 3/)
  assert.throws(()=>helpers.buildVideoReferences({...input,frameReferenceTypes:[]}),/不支持首尾帧搭配/)
})

test('real workspace resolution excludes hidden video drafts, preserves image/audio roles and counts frames in limits',async()=>{
  const env=derive(state())
  assert.equal(env.acceptsVideoReferences,false)
  assert.deepEqual(env.activeSelectedRefs.map(item=>item.id),['image','audio'])
  assert.equal(env.frameCount,2);assert.equal(env.durationMode,'ends')
  const resolve=evaluate(`${statement('resolveVideoReferences')}\nmodule.exports=resolveVideoReferences`,{...env,buildVideoReferences:helpers.buildVideoReferences,publishUploads:async()=>[]})
  const references=await resolve()
  assert.deepEqual(references.map(item=>[item.url.split('/').at(-1),item.type,item.role]),[['first','image','first_frame'],['last','image','last_frame'],['image','image','reference'],['audio','audio','reference']])
  assert.ok(env.selectedRefs.some(item=>item.kind==='video'),'switching modes retains an inactive video draft')
  const constrained=derive({...state(),capabilities:{...env.capabilities,maxReferences:3},model:{capabilities:{...env.capabilities,maxReferences:3}}})
  const invalid=evaluate(`${statement('resolveVideoReferences')}\nmodule.exports=resolveVideoReferences`,{...constrained,buildVideoReferences:helpers.buildVideoReferences,publishUploads:async()=>[]})
  await assert.rejects(invalid,/合计最多 3/)
  assert.equal(policy.videoReferenceUploadLimit(env.model,'image',env.activeSelectedRefs,env.referenceUploadCounts,2),6)
  assert.equal(policy.videoLibrarySelectionLimit(env.model,'image',env.activeSelectedRefs,env.referenceUploadCounts,2),7)
})

test('each actual library candidate pool has one media kind; frame dialogs never contain videos or audio',()=>{
  for(const target of ['first','last','image','video','source','audio']){
    const env={libraryTarget:target,serverLibrary:{state:'ready'},serverReferenceAssets:[asset('image'),asset('scene','scene'),asset('video','video'),asset('audio','audio')],videoPickerKind:helpers.videoPickerKind,useMemo:fn=>fn()}
    const result=evaluate(`module.exports=${declaration('referencePool').initializer.getText(parsed)}`,env)
    const expected=helpers.videoPickerKind(target)
    assert.ok(result.length>0)
    assert.ok(result.every(item=>expected==='image'?['image','scene'].includes(item.kind):item.kind===expected),target)
  }
})

test('additional references reserve the required first-frame slot even when the tail was selected first',()=>{
  const initial=state(),capabilities={...initial.capabilities,maxReferences:3}
  const env=derive({...initial,capabilities,model:{capabilities},firstFrameRef:[],selectedRefs:[asset('image')]})
  assert.equal(env.frameCount,1)
  assert.equal(env.reservedFrameCount,2)
  assert.equal(env.frameSlotLimit('first'),1)
  assert.equal(policy.videoReferenceUploadLimit(env.model,'image',env.activeSelectedRefs,env.referenceUploadCounts,env.reservedFrameCount),0)
})

test('actual frame UI has library buttons for each role, no permanent library lists, and no video uploader',()=>{
  const env=derive(state()),opened=[]
  let section
  const visit=node=>{if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(parsed)==='ParamSection'&&node.openingElement.attributes.properties.some(prop=>prop.name?.text==='title'&&prop.initializer?.getText(parsed)==='{referenceLabel}'))section=node;ts.forEachChild(node,visit)}
  visit(workspace)
  const jsx=(type,props)=>({type,props})
  const bindings={...env,require:()=>({jsx,jsxs:jsx}),ParamSection:'ParamSection',ReferenceUploader:'Uploader',ReferenceLibraryDialog:'LibraryDialog',referenceLabel:'首尾帧与参考素材',referenceHint:'4/15',referenceSelectionLimit:15,libraryTarget:null,pickerKind:'image',isFramePicker:false,pickerSelected:[],pickerLimit:7,referencePool:[],serverLibrary:{state:'ready',remaining:0},openReferenceLibrary:value=>opened.push(value),videoReferenceUploadLimit:policy.videoReferenceUploadLimit,
    setFirstFrameUploads(){},setLastFrameUploads(){},setFirstFrameRef(){},setLastFrameRef(){},setSourceVideoRef(){},setSourceVideoUploads(){},setUploads(){},setVideoRefUploads(){},setAudioRefUploads(){},setSelectedRefs(){},setLibraryTarget(){},setLibraryKeyword(){},pickLibraryReference(){},refreshSources(){}}
  const tree=evaluate(`module.exports=(${section.getText(parsed)})`,bindings)
  const uploaders=all(tree).filter(node=>node.type==='Uploader')
  assert.deepEqual(uploaders.map(node=>node.props.label),['首帧图片','尾帧图片（可选）','参考图片（可选）','参考音频（可选）'])
  for(const node of uploaders)node.props.onPickFromLibrary()
  assert.deepEqual(opened,['first','last','image','audio'])
  assert.equal(all(tree).find(node=>node.type==='LibraryDialog').props.open,false)
  assert.ok(!all(tree).some(node=>node.type==='ReferencePicker'))
})

test('mode options expose one combined frame choice and legacy frame modes can still normalize',()=>{
  const env=derive(state())
  const options=evaluate(`module.exports=${declaration('modeOptions').initializer.getText(parsed)}`,{...env,quality:'720p',useMemo:fn=>fn(),selectableVideoDurations:()=>['4 秒','6 秒']})
  assert.equal(options.filter(item=>['first','ends','mixed','frames'].includes(item.value)).length,1)
  assert.equal(options.find(item=>item.value==='frames').label,'首尾帧')
})
