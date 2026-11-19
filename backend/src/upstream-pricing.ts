import {httpError} from './core.js';
import {sameSetting} from './settings-diff.js';

type Json=Record<string,any>;
function stable(value:any):any{
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,stable(value[key])]));
  return value;
}

function pricingRows(settings:Json,model:Json){
  const costs=settings.modelPointCosts||{};
  return (model.bindings||[]).flatMap((binding:Json)=>{
      const channel=settings.systemChannels.find((item:Json)=>item.id===binding.channelId);
      if(!channel)return [];
      const url=new URL(channel.baseUrl),endpoint=url.origin+url.pathname.replace(/\/+$/,'')+url.search;
      const key=JSON.stringify([endpoint,channel.advancedConfig?.protocol||channel.apiFormat||'openai',binding.upstreamModel.trim()]);
      const profile=binding.capabilityProfile||{};
      const signature=JSON.stringify(stable({
        base:(binding.requestAlias?costs[binding.requestAlias.trim()]:undefined)??costs[binding.upstreamModel]??costs[model.id],
        ...(model.capability==='video'?{videoBillingUnit:profile.videoBillingUnit,videoPricingTemplate:profile.videoPricingTemplate,videoPricing:profile.videoPricing,freeCounts:['image','video','audio'].map(type=>profile.videoReferenceRules?.[type]?.freeCount)}:{}),
      }));
      return [{key,signature}];
  }).sort((a:{key:string;signature:string},b:{key:string;signature:string})=>a.key.localeCompare(b.key)||a.signature.localeCompare(b.signature));
}

/** Validate changed price dependencies, including endpoint and upstream changes. */
export function validateUpstreamPricing(settings:Json,previous?:Json){
  for(const model of settings.logicalModels||[]){
    const rows=pricingRows(settings,model),old=previous?.logicalModels?.find((item:Json)=>item.id===model.id);
    const oldRows=old?pricingRows(previous!,old):[];
    const groups=new Map<string,string>();
    for(const {key,signature} of rows){
      if(old&&sameSetting(rows.filter((row:{key:string})=>row.key===key),oldRows.filter((row:{key:string})=>row.key===key)))continue;
      if(groups.has(key)&&groups.get(key)!==signature)throw httpError(400,`「${model.name||model.id}」同上游渠道价格不一致，请选择一个渠道点击“以此渠道价格统一”后保存。`);
      groups.set(key,signature);
    }
  }
}
