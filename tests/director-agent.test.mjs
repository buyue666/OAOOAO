import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require=createRequire(import.meta.url)
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8')
function module(path,mocks={}){
  const out={exports:{}}
  new Function('require','module','exports',ts.transpileModule(source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),out,out.exports)
  return out.exports
}
const types=module('../components/free-canvas/types.ts'), factory=module('../components/free-canvas/node-factory.ts'), catalog=module('../components/free-canvas/director/catalog.ts')
const timeline=module('../components/free-canvas/director/timeline.ts')
const agent=module('../components/free-canvas/director/agent-plan.ts',{'../types':types,'./catalog':catalog,'./timeline':timeline})
const codec=module('../components/free-canvas/board-codec.ts',{'./types':types,'./node-factory':factory,'./director/catalog':catalog})
const base=()=>structuredClone(factory.DEFAULT_DIRECTOR_SCENE)
const proposal=(operations,generation)=>JSON.stringify({summary:'将人物和机位排列为可审核的分镜',operations,...(generation?{generation}:{})})

test('director Agent applies real poses, movement keys, camera motion and generation drafts without mutating the original scene',()=>{
  const scene=base(), original=structuredClone(scene)
  const plan=agent.parseDirectorAgentPlan(proposal([
    {type:'scene',duration:8,aspect:'9:16'},
    {type:'actor',action:'update',id:'actor-1',pose:'wave',x:-1,joints:{rightElbow:30}},
    {type:'actor-key',id:'actor-2',time:0,x:1},
    {type:'actor-key',id:'actor-2',time:8,x:3},
    {type:'camera',action:'update',id:'camera-1',active:true,targetActorId:'actor-2',motion:'follow'},
  ],{kind:'video',prompt:'两人挥手，镜头跟随女生向右移动。'}),scene)
  assert.deepEqual(scene,original)
  assert.equal(plan.scene.aspect,'9:16')
  assert.equal(plan.scene.actors[0].posePreset,'wave')
  assert.equal(plan.scene.actors[0].poseControls.rightElbow,30)
  assert.equal(timeline.sampleActor(plan.scene.actors[1],8).x,3)
  assert.equal(plan.scene.cameras[0].keys.length,17)
  assert.ok(Math.abs(timeline.sampleCamera(plan.scene.cameras[0],8).x-2)<.001)
  assert.equal(plan.generation.kind,'video')
  assert.ok(plan.changes.some(item=>item.includes('挥手')))
})

test('director Agent supports new actors and cameras, removes old objects explicitly and always leaves a camera',()=>{
  const plan=agent.parseDirectorAgentPlan(proposal([
    {type:'actor',action:'add',id:'new-man',model:'male',pose:'sit',color:'#abcdef'},
    {type:'camera',action:'add',id:'new-camera',active:true,fov:35},
    {type:'actor',action:'remove',id:'actor-1'},
    {type:'camera',action:'remove',id:'camera-1'},
  ]),base())
  assert.equal(plan.scene.actors.at(-1).posePreset,'sit')
  assert.equal(plan.scene.activeCameraId,'new-camera')
  assert.equal(plan.scene.cameras.length,1)
  assert.throws(()=>agent.parseDirectorAgentPlan(proposal([{type:'camera',action:'remove',id:'camera-1'}]),base()),/至少保留/)
})

test('untrusted model output cannot use arbitrary tools, remote model URLs, unknown keys or non-finite/out-of-range transforms',()=>{
  const cases=[
    {type:'eval',id:'actor-1',code:'throw 1'},
    {type:'actor',action:'update',id:'actor-1',modelUrl:'https://example.invalid/model.glb'},
    {type:'actor',action:'update',id:'actor-1',pose:'javascript'},
    {type:'actor',action:'update',id:'actor-1',x:100000},
    {type:'actor',action:'update',id:'actor-1',scale:0},
    {type:'actor',action:'update',id:'actor-1',joints:{__unknown:5}},
    {type:'camera',action:'update',id:'camera-1',targetActorId:'unowned'},
    {type:'camera',action:'update',id:'camera-1',fov:0},
    {type:'actor-key',id:'actor-1',time:30,x:1},
    {type:'scene',duration:3.1},
  ]
  for(const op of cases)assert.throws(()=>agent.parseDirectorAgentPlan(proposal([op]),base()))
  assert.throws(()=>agent.parseDirectorAgentPlan('{"summary":"bad","operations":[{"type":"actor","id":"actor-1","action":"update","x":1e400}]}',base()),/范围/)
  assert.throws(()=>agent.parseDirectorAgentPlan(proposal([],{kind:'shell',prompt:'x'}),base()),/仅支持/)
})

test('object and operation bounds reject oversized plans and dangling keyframe targets',()=>{
  const many=Array.from({length:7},(_,i)=>({type:'actor',action:'add',id:`extra-${i}`}))
  assert.throws(()=>agent.parseDirectorAgentPlan(proposal(many),base()),/上限/)
  assert.throws(()=>agent.parseDirectorAgentPlan(proposal(Array(33).fill({type:'scene',grid:true})),base()),/32/)
  assert.throws(()=>agent.parseDirectorAgentPlan(proposal([{type:'actor-key',id:'missing',time:0}]),base()),/不存在/)
  assert.throws(()=>agent.parseDirectorAgentPlan(proposal([{type:'actor',action:'add',id:'actor-1'}]),base()),/已变化/)
  assert.throws(()=>agent.parseDirectorAgentPlan(proposal([{type:'camera',action:'add',id:'actor-1'}]),base()),/已变化/)
})

test('changing a tracked transform explicitly replaces the old track instead of an invisible ineffective edit',()=>{
  const scene=base();scene.actors[0]=timeline.recordActorKey(timeline.recordActorKey(scene.actors[0],0),5,{x:4})
  const plan=agent.parseDirectorAgentPlan(proposal([{type:'actor',action:'update',id:'actor-1',x:2}]),scene)
  assert.equal(plan.scene.actors[0].keys,undefined)
  assert.equal(timeline.sampleActor(plan.scene.actors[0],2).x,2)
  assert.ok(plan.changes.some(item=>item.includes('重置走位')))
})

test('canonical scene comparison survives board serialization and still detects hand edits',()=>{
  const node=factory.createDirectorNode({x:0,y:0})
  const key=agent.directorSceneKey(node.data.scene)
  const restored=codec.readBoard(codec.writeBoard([node],[])).nodes[0]
  assert.equal(agent.directorSceneKey(restored.data.scene),key)
  restored.data.scene.actors[0].x+=1
  assert.notEqual(agent.directorSceneKey(restored.data.scene),key)
})

test('saved planning requests preserve immutable identity and input, and interrupted submissions can recover without new charges',()=>{
  const node=factory.createDirectorNode({x:0,y:0})
  const job={requestId:'director-synthetic-0001',model:'synthetic-text',system:agent.DIRECTOR_AGENT_SYSTEM,user:JSON.stringify({instruction:'挥手',scene:node.data.scene}),baseScene:structuredClone(node.data.scene),phase:'submitting',approvedCost:1}
  node.data.assistant={prompt:'挥手',model:'synthetic-text',job}
  const reload=()=>codec.readBoard(codec.writeBoard([node],[])).nodes[0].data.assistant
  let saved=reload()
  assert.equal(saved.job.phase,'unconfirmed')
  assert.equal(saved.job.requestId,job.requestId)
  assert.equal(saved.job.user,job.user)
  assert.equal(saved.job.approvedCost,1)
  node.data.assistant.job.taskId='synthetic-task'
  saved=reload();assert.equal(saved.job.phase,'pending')
  node.data.assistant.job={...job,phase:'ready',content:proposal([{type:'actor',action:'update',id:'actor-1',pose:'wave'}]),applied:true}
  saved=reload();assert.equal(saved.job.phase,'ready');assert.equal(saved.job.applied,true)
  assert.equal(agent.parseDirectorAgentPlan(saved.job.content,saved.job.baseScene).scene.actors[0].posePreset,'wave')
})
