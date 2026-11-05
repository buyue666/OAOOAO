import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {hashToken} from '../src/core.js';
import {validateUpstreamPricing} from '../src/upstream-pricing.js';
import {createTestDatabase} from './core-helpers.js';

test('same-provider price validation is order independent and leaves distinct endpoints independent',()=>{
  const channel=(id:string,baseUrl:string)=>({id,baseUrl,apiFormat:'openai'});
  const binding=(channelId:string,rate:number)=>({channelId,upstreamModel:'video-model',capabilityProfile:{videoBillingUnit:'second',videoPricing:{resolutionPricing:{'720p':{generationRate:rate}}}}});
  const settings={systemChannels:[channel('one','https://provider.example.invalid/v1'),channel('two','https://provider.example.invalid/v1/'),channel('other','https://other.example.invalid/v1')],logicalModels:[{id:'logical',name:'合成模型',capability:'video',bindings:[binding('one',2),binding('two',2),binding('other',5)]}]};
  assert.doesNotThrow(()=>validateUpstreamPricing(settings));
  settings.logicalModels[0].bindings[1].capabilityProfile.videoPricing.resolutionPricing['720p'].generationRate=3;
  assert.throws(()=>validateUpstreamPricing(settings),/同上游渠道价格不一致/);
  settings.logicalModels[0].bindings.reverse();
  assert.throws(()=>validateUpstreamPricing(settings),/同上游渠道价格不一致/);
});

test('routing save rejects conflicting account prices atomically and both matching aliases quote the same amount',async t=>{
  const fixture=await createTestDatabase(),app=await buildApp({db:fixture.db,config:fixture.config});
  t.after(async()=>{await app.close();await fixture.cleanup();});
  const token=randomBytes(32).toString('base64url');
  await fixture.db.query("INSERT INTO oaooao_users(id,username,password_hash,role,admin_permissions) VALUES('price-admin','price-admin','synthetic-unused','admin',$1)",[JSON.stringify(['upstream.manage'])]);
  await fixture.db.query("INSERT INTO oaooao_sessions(token_hash,user_id,expires_at) VALUES($1,'price-admin',now()+interval '1 hour')",[hashToken(token)]);
  const headers={cookie:`oaooao_session=${token}`,origin:fixture.config.origin};
  const profile={videoBillingUnit:'second',videoQualities:['720p'],durationSeconds:[4],videoPricing:{resolutionPricing:{'720p':{generationRate:2}}}};
  const channels=['one','two'].map(id=>({id,name:id,baseUrl:'https://provider.example.invalid/v1',models:['video-model'],apiFormat:'openai-video',enabled:true,apiKey:'synthetic-key'}));
  const model={id:'video',name:'合成模型',capability:'video',enabled:true,bindings:channels.map((channel,index)=>({id:channel.id,channelId:channel.id,upstreamModel:'video-model',requestAlias:`video-${channel.id}`,enabled:true,priority:index+1,capabilityProfile:structuredClone(profile)}))};
  const save=()=>app.inject({method:'PATCH',url:'/api/admin/settings',headers,payload:{systemChannels:channels,logicalModels:[model]}});
  assert.equal((await save()).statusCode,200);
  const before=(await fixture.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value;
  model.bindings[1].capabilityProfile.videoPricing.resolutionPricing['720p'].generationRate=4;
  const mismatch=await save();assert.equal(mismatch.statusCode,400,mismatch.body);assert.match(mismatch.body,/同上游渠道价格不一致/);
  assert.deepEqual((await fixture.db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0].value,before);
  model.bindings[1].capabilityProfile=structuredClone(profile);
  assert.equal((await save()).statusCode,200);
  for(const name of ['video-one','video-two']){
    const quote=await app.inject({method:'POST',url:'/api/video-generation-tasks/quote',headers,payload:{prompt:'Synthetic quote',config:{model:name,vquality:'720p',videoSeconds:4,size:'16:9'}}});
    assert.equal(quote.statusCode,200,quote.body);assert.equal(quote.json().points,8);
  }
  assert.equal((await fixture.db.query('SELECT count(*) FROM oaooao_generation_jobs')).rows[0].count,'0');
  assert.equal((await fixture.db.query('SELECT count(*) FROM oaooao_wallet_operations')).rows[0].count,'0');
});
