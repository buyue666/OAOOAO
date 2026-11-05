import test from 'node:test';
import assert from 'node:assert/strict';
import {videoBaseCost,videoReferenceCost,validateVideoPolicySettings} from '../src/video-policy.js';
import {resolveProvider} from '../src/providers.js';
import {DEFAULT_SETTINGS} from '../src/settings.js';

const prices={resolutionPricing:{'480p':{generationRate:1,referencePrices:{referenceVideoPerSecond:2,extraImage:0}},'1080p':{generationRate:3,referencePrices:{referenceVideoPerSecond:5,extraImage:2}}}};
test('input video prices follow output resolution, and explicit zero remains free',()=>{
  const metadata=[{type:'video',duration:2.5},{type:'image',duration:0}];
  const profile={videoPricing:prices};
  assert.equal(videoReferenceCost(metadata,profile,{quality:'480p',seconds:10}),50000n);
  assert.equal(videoReferenceCost(metadata,profile,{quality:'1080p',seconds:10}),145000n);
  assert.equal(videoBaseCost(undefined,profile,'480p',10),100000n);
  assert.equal(videoBaseCost(undefined,profile,'1080p',10),300000n);
});

test('output-duration tiers override reference prices without a second legacy multiplier',()=>{
  const profile={videoPricing:{resolutionPricing:{'480p':{referenceDurationTiers:[{maxSeconds:15,prices:{referenceVideoPerSecond:2}},{maxSeconds:30,prices:{referenceVideoPerSecond:4}}]}}}};
  const refs=[{type:'video',duration:3}];
  assert.equal(videoReferenceCost(refs,profile,{quality:'480p',seconds:15,multiplier:2}),60000n);
  assert.equal(videoReferenceCost(refs,profile,{quality:'480p',seconds:16,multiplier:2}),120000n);
  assert.throws(()=>videoReferenceCost(refs,profile,{quality:'480p',seconds:31}),/输入素材价格/);
});

test('cleared prices cannot silently inherit a legacy price or become free',()=>{
  const profile={videoPricing:{referenceVideoPerSecond:8,resolutionRates:{'480p':4},resolutionPricing:{'480p':{generationRate:null,referencePrices:{}}}}};
  assert.throws(()=>videoBaseCost(10000n,profile,'480p',4),/生成价格/);
  assert.throws(()=>videoReferenceCost([{type:'video',duration:2}],profile,{quality:'480p',seconds:4}),/配置/);
  assert.throws(()=>videoBaseCost(undefined,{},'480p',4),/生成价格/);
  assert.equal(videoBaseCost(undefined,{videoPricing:{resolutionPricing:{'480p':{generationRate:0}}}},'480p',4),0n);
});

test('legacy price tables remain compatible and input duration uses wallet precision',()=>{
  assert.equal(videoBaseCost(10000n,{videoBillingUnit:'second'},'480p',6),60000n);
  assert.equal(videoReferenceCost([{type:'video',duration:1.001}],{videoPricing:{referenceVideoPerSecond:0.0001}},{quality:'480p',seconds:16,multiplier:2}),3n);
  assert.equal(videoBaseCost(undefined,{videoBillingUnit:'duration',videoPricing:{resolutionPricing:{'480p':{generationDurationRates:{'6':7}}}}},'480p',6),70000n);
});

test('invalid resolution, price and tier structures are rejected before persistence',()=>{
  validateVideoPolicySettings({videoPricing:prices});
  for(const value of [null,0,'invalid',[]])assert.throws(()=>validateVideoPolicySettings({videoPricing:value}),/视频价格配置无效/);
  for(const row of [[],{generationRate:-1},{generationRate:0.00001},{referencePrices:{referenceVideoPerSecond:'2'}},{referenceDurationTiers:[]},{referenceDurationTiers:[{maxSeconds:15,prices:{}},{maxSeconds:10,prices:{}}]}])assert.throws(()=>validateVideoPolicySettings({videoPricing:{resolutionPricing:{'480p':row}}}));
});

test('the submission resolver uses resolution prices without a model-wide fallback rate',async()=>{
  const profile={videoBillingUnit:'second',durationSeconds:[4,6],videoQualities:['480p','1080p'],videoPricing:prices,supportsReferenceImage:true,maxReferenceImages:8,videoReferenceRules:{image:{freeCount:0}}};
  const settings={...structuredClone(DEFAULT_SETTINGS),systemChannels:[{id:'provider',enabled:true,apiKey:'synthetic',baseUrl:'https://provider.example.invalid/v1',apiFormat:'openai-video'}],logicalModels:[{id:'video',name:'Video',capability:'video',enabled:true,bindings:[{id:'binding',channelId:'provider',upstreamModel:'upstream',priority:1,enabled:true,capabilityProfile:profile}]}]};
  const ctx={config:{origin:'https://studio.example.invalid'},db:{query:async(sql:string)=>({rows:sql.includes("id='object-storage'")?[]:[{value:settings}]})}} as any;
  const image={type:'image',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII='};
  assert.equal((await resolveProvider(ctx,'video',{config:{model:'video',videoSeconds:6,vquality:'480p'},references:[image]},undefined,'synthetic-user')).cost,'6.0000');
  assert.equal((await resolveProvider(ctx,'video',{config:{model:'video',videoSeconds:6,vquality:'1080p'},references:[image]},undefined,'synthetic-user')).cost,'20.0000');
});

test('reference video changes the output rate without charging its own duration or count',()=>{
  const profile={videoPricingTemplate:'reference-video-output',videoBillingUnit:'second',videoPricing:{resolutionPricing:{'480p':{generationRate:1,referenceVideoGenerationRate:2,referencePrices:{extraVideo:100,referenceVideoPerSecond:100}}}}};
  validateVideoPolicySettings(profile);
  assert.equal(videoBaseCost(undefined,profile,'480p',10),100000n);
  assert.equal(videoBaseCost(undefined,profile,'480p',10,{hasReferenceVideo:true}),200000n);
  for(const metadata of [[{type:'video',duration:1}],[{type:'video',duration:12}],[{type:'video',duration:1},{type:'video',duration:2}]])assert.equal(videoReferenceCost(metadata,profile,{quality:'480p',seconds:10}),0n);
  assert.throws(()=>videoBaseCost(10000n,{...profile,videoPricing:{resolutionPricing:{'480p':{generationRate:1}}}},'480p',10,{hasReferenceVideo:true}),/参考视频生成/);
  assert.equal(videoBaseCost(undefined,{...profile,videoPricing:{resolutionPricing:{'480p':{referenceVideoGenerationRate:0}}}},'480p',10,{hasReferenceVideo:true}),0n);
  for(const row of [{referenceVideoGenerationRate:-1},{referenceVideoGenerationRate:'2'}])assert.throws(()=>validateVideoPolicySettings({videoPricing:{resolutionPricing:{'480p':row}}}));
});

test('the original short-band reference rate is reused as an output rate without mutating stored prices',()=>{
  const profile={videoPricingTemplate:'reference-video-output',videoBillingUnit:'second',videoPricing:{resolutionPricing:{'480p':{generationRate:1,referenceDurationTiers:[{maxSeconds:15,prices:{referenceVideoPerSecond:2}},{maxSeconds:30,prices:{referenceVideoPerSecond:4}}]}}}};
  const before=structuredClone(profile);
  assert.equal(videoBaseCost(undefined,profile,'480p',16,{hasReferenceVideo:true}),320000n);
  assert.deepEqual(profile,before);
});
