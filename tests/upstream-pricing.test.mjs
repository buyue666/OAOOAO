import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source=readFileSync(new URL('../lib/studio/upstream-pricing.ts',import.meta.url),'utf8')
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const module={exports:{}}
new Function('module','exports',code)(module,module.exports)
const {upstreamPricePeers,upstreamPricingSnapshot,upstreamPricingConflicts,synchronizeUpstreamPricing}=module.exports
const channels=[
  {id:'one',baseUrl:'https://provider.example.invalid/v1/',apiFormat:'openai'},
  {id:'two',baseUrl:'https://PROVIDER.example.invalid/v1',apiFormat:'openai'},
  {id:'other',baseUrl:'https://other.example.invalid/v1',apiFormat:'openai'},
  {id:'path',baseUrl:'https://provider.example.invalid/other',apiFormat:'openai'},
  {id:'protocol',baseUrl:'https://provider.example.invalid/v1',apiFormat:'responses'},
]
const fixture=()=>({id:'logical',capability:'video',bindings:channels.map((channel,index)=>({id:channel.id,channelId:channel.id,upstreamModel:'video-model',requestAlias:`route-${channel.id}`,priority:index+1,weight:index+2,enabled:true,capabilityProfile:{supportsFirstFrame:index===0,maxReferences:index+4,concurrencyLimit:index+1,videoQualities:['720p'],videoBillingUnit:'second',videoPricingTemplate:'standard',videoReferenceRules:{image:{maxCount:index+2,freeCount:index}},videoPricing:{resolutionPricing:{'720p':{generationRate:index+1,referenceVideoGenerationRate:index+2}}}}}))})

test('price groups match endpoint, protocol and upstream model within the current logical model',()=>{
  const model=fixture()
  assert.deepEqual(upstreamPricePeers(model,model.bindings[0],channels).map(binding=>binding.id),['one','two'])
  model.bindings[1].upstreamModel='Video-Model'
  assert.deepEqual(upstreamPricePeers(model,model.bindings[0],channels).map(binding=>binding.id),['one'])
})

test('unifying prices includes free quotas and fallback rates while preserving routing and limits',()=>{
  const model=fixture(),before=structuredClone(model),costs={logical:9,'route-one':0,'route-two':7,'route-other':12}
  assert.equal(upstreamPricingConflicts(model,channels,costs).length,1)
  const result=synchronizeUpstreamPricing(model,'one',channels,costs)
  const [one,two,...others]=result.model.bindings
  assert.equal(upstreamPricingConflicts(result.model,channels,result.costs).length,0)
  assert.equal(result.costs['route-two'],0,'free is a valid explicit rate')
  assert.deepEqual(two.capabilityProfile.videoPricing,one.capabilityProfile.videoPricing)
  assert.equal(two.capabilityProfile.videoReferenceRules.image.freeCount,0)
  for(const key of ['supportsFirstFrame','maxReferences','concurrencyLimit'])assert.equal(two.capabilityProfile[key],before.bindings[1].capabilityProfile[key])
  assert.equal(two.capabilityProfile.videoReferenceRules.image.maxCount,before.bindings[1].capabilityProfile.videoReferenceRules.image.maxCount)
  for(const key of ['priority','weight','channelId','upstreamModel','requestAlias','enabled'])assert.equal(two[key],before.bindings[1][key])
  assert.deepEqual(others,before.bindings.slice(2))
  assert.deepEqual(model,before,'editing a draft never changes the stored source')
  assert.equal(costs['route-two'],7)
  two.capabilityProfile.videoPricing.resolutionPricing['720p'].generationRate=99
  assert.equal(one.capabilityProfile.videoPricing.resolutionPricing['720p'].generationRate,1,'copied prices are not shared mutable objects')
})

test('cleared source pricing removes old peer overrides and uses the model fallback',()=>{
  const model=fixture()
  delete model.bindings[0].capabilityProfile.videoPricing
  delete model.bindings[0].capabilityProfile.videoReferenceRules.image.freeCount
  const result=synchronizeUpstreamPricing(model,'one',channels,{logical:5})
  assert.equal(result.model.bindings[1].capabilityProfile.videoPricing,undefined)
  assert.equal(result.model.bindings[1].capabilityProfile.videoReferenceRules.image.freeCount,undefined)
  assert.equal(upstreamPricingSnapshot(result.model,result.model.bindings[0],result.costs),upstreamPricingSnapshot(result.model,result.model.bindings[1],result.costs))
})
