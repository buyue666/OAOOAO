/** Disposable, loopback-only browser fixture. No production data or external calls. */
import {randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import {createTestDatabase} from '../tests/core-helpers.js';
import {buildApp} from '../src/app.js';
import {ADMIN_PERMISSIONS} from '../src/core.js';
import {adjustWallet} from '../src/wallet.js';
import {completeManualOrder} from '../src/commerce.js';
import {processNextJob} from '../src/worker.js';
import {saveMedia} from '../src/media.js';
import {ProviderFailure} from '../src/providers.js';
const fixture=await createTestDatabase();
const port=Number(process.env.OAOAO_FIXTURE_PORT||3470);
if(![3470,3472].includes(port))throw new Error('Only designated loopback fixture ports are allowed');
fixture.config.origin=port===3472?'http://127.0.0.1:3462':'http://localhost:3460';
fixture.config.allowedOrigins=[fixture.config.origin,`http://127.0.0.1:${port}`];
fixture.config.port=port;
const password=process.env.OAOAO_TEST_PASSWORD;
if(!password)throw new Error('OAOAO_TEST_PASSWORD is required for the disposable fixture');
const userId=randomUUID();
await fixture.db.query('INSERT INTO oaooao_users(id,username,password_hash,display_name,role,admin_permissions,email) VALUES($1,$2,$3,$4,$5,$6,$7)',[userId,'admin',await bcrypt.hash(password,12),'隔离验收管理员','admin',JSON.stringify(ADMIN_PERMISSIONS),'admin@example.test']);
await fixture.db.query("UPDATE oaooao_settings SET value=$1 WHERE id='global'",[{operationMode:'commercial',registrationEnabled:true,site:{title:'OAOOAO',termsUrl:'/terms',privacyUrl:'/privacy',termsVersion:'fixture',privacyVersion:'fixture',termsContent:'隔离验收服务条款。',privacyContent:'隔离验收隐私政策。',commercePolicy:{status:'published',version:'fixture',refundPolicy:'测试订单仅用于隔离验收。',pointsExpiryPolicy:'购买积分永久有效。',renewalPolicy:'不自动续费。',invoicePolicy:'测试服务不产生真实交易。',supportUrl:'https://example.test/support'}}}]);
await fixture.db.query("INSERT INTO oaooao_payment_configs(provider_id,enabled,public_values) VALUES('manual',true,$1)",[{instructions:'隔离验收订单；请勿支付任何真实款项。'}]);
await fixture.db.query("INSERT INTO oaooao_products(id,product_kind,name,description,amount_cents,points_amount,enabled) VALUES('fixture-credits','points','验收积分包','仅用于隔离测试',100,100,true)");
const app=await buildApp({db:fixture.db,config:fixture.config});
const advanced=process.env.OAOAO_FIXTURE_SCENARIO==='acceptance';
if(process.env.OAOAO_FIXTURE_SCENARIO==='acceptance'){
  await fixture.db.query("UPDATE oaooao_settings SET value=value || $1::jsonb WHERE id='global'",[JSON.stringify({checkIn:{enabled:true,rewardPoints:10},entitlements:{plans:['standard','advanced','premium','luxury','ultimate'].map(id=>({id,enabled:true,name:id,dailyPoints:0,limits:{}}))}})]);
  for(const [index,tone] of ['standard','advanced','premium','luxury','ultimate'].entries()) await fixture.db.query("INSERT INTO oaooao_products(id,product_kind,plan_id,name,description,amount_cents,points_amount,daily_points,period_days,enabled,sort_order,metadata) VALUES($1,'plan',$2,$3,'仅用于隔离配色验收',990,500,0,30,true,$4,$5)",['fixture-'+tone,tone,'验收'+['松石','星空','鸢尾','玫瑰','琥珀'][index]+'会员',index,JSON.stringify({membership:{tone}})]);
}

if(advanced){
  const models=['text','image','video'].map(kind=>({id:`fixture-${kind}`,name:`隔离${kind==='image'?'图像':kind==='video'?'视频':'文本'}模型（合成）`,capability:kind,enabled:true,bindings:[{id:`fixture-${kind}-binding`,channelId:'fixture',upstreamModel:`fixture-${kind}`,enabled:true,priority:1,capabilityProfile:{aspectRatios:['1:1','16:9','9:16'],durationSeconds:[4,8],maxBatchCount:4,maxReferenceImages:4}}]}));
  await fixture.db.query("UPDATE oaooao_settings SET value=value || $1::jsonb WHERE id='global'",[JSON.stringify({systemChannels:[{id:'fixture',name:'隔离合成适配器（不联网）',baseUrl:'https://example.invalid/v1',enabled:true,apiFormat:'openai',apiKey:app.ctx.encrypt('synthetic-no-provider-credential'),models:models.map(m=>m.id)}],logicalModels:models,defaultModels:Object.fromEntries(models.map(m=>[m.capability+'Model',m.id])),modelPointCosts:Object.fromEntries(models.map(m=>[m.id,1])),generationDefaults:{imageQuality:'standard',imageSize:'1:1',imageCount:1,videoQuality:'standard',videoSeconds:4},generationPointMultipliers:{imageQuality:{auto:1,low:1,medium:1,standard:1,high:1,'2K':1,'4K':1},videoQuality:{standard:1,high:1},videoSeconds:{'4':1,'8':2}},generationConcurrency:{agent:5,image:5,text:5,video:5}})]);
  await fixture.db.query("INSERT INTO oaooao_announcements(id,title,content,enabled,popup_home,popup_after_login) VALUES('fixture-notice','隔离验收公告','用于验证公告展示、关闭和通知入口。此环境只有测试账号与测试积分。',true,true,true)");
}
await adjustWallet(app.ctx,userId,'fixture-opening','200',{type:'grant',description:'隔离验收初始积分'});
const orderId=randomUUID();
await fixture.db.query("INSERT INTO oaooao_orders(id,order_no,user_id,product_id,product_kind,subject,quantity,list_amount_cents,amount_cents,currency,points_amount,daily_points,period_days,provider,expires_at) VALUES($1,$2,$3,'fixture-credits','points','隔离退款验收（无真实款项）',1,100,100,'CNY',100,0,0,'manual',now()+interval '1 day')",[orderId,'FIXTURE-'+orderId.slice(0,8),userId]);
await completeManualOrder(app.ctx,orderId,userId,'Synthetic fixture receipt; no real funds');
await mkdir('.private',{recursive:true});await writeFile(`.private/browser-fixture${port===3472?'-acceptance':''}.json`,JSON.stringify({schema:fixture.schema,userId,origin:fixture.config.origin,backend:`http://127.0.0.1:${port}`,password}));
// Deterministic test outputs, never the real provider adapter. Keep this out of server.ts.
let working:Promise<unknown>|undefined;
const timer=advanced?setInterval(()=>{
  if(working)return;
  working=processNextJob(app.ctx,async(ctx,job)=>{
    if(String(job.input.prompt).includes('FIXTURE_FAIL'))throw new ProviderFailure('隔离验收：模拟上游明确失败',true);
    if(job.kind==='text')return{type:'complete',result:{content:job.input.context?.agentRole==='planner'?JSON.stringify({summary:'隔离测试创作计划',steps:[{id:'draft',title:'整理创作建议（合成）',type:'text',model:'fixture-text',prompt:'隔离验收建议',dependsOn:[],referenceAssetIds:[],referenceStepIds:[]}]}):'这是隔离环境的合成输出，仅验证保存与展示。'}};
    if(job.kind!=='image')throw new ProviderFailure('隔离验收未配置视频输出样本',true);
    const media=await saveMedia(ctx,job.user_id,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrGkAAAAASUVORK5CYII=','base64'));
    return{type:'complete',result:{url:media.url,results:[{url:media.url,mimeType:media.mimeType}]}};
  }).catch(()=>undefined).finally(()=>{working=undefined;});
},500):undefined;
let closing=false;async function close(){if(closing)return;closing=true;if(timer)clearInterval(timer);await working;await app.close();await fixture.cleanup();process.exit(0);}
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void close();});
await app.listen({host:'127.0.0.1',port});
console.log(`Disposable browser fixture listening on loopback port ${port}; synthetic outputs: ${advanced}`);
