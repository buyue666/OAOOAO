import { httpError, object } from './core.js';

export const TOOL_IDS = ['perler','remix','tryon','agent','drama','canvas','director'] as const;
export type ToolId = typeof TOOL_IDS[number];
export function toolEnabled(settings:Record<string,any>,id:ToolId) {
  return settings.creativeTools?.[id]?.enabled!==false&&(id!=='director'||settings.creativeTools?.canvas?.enabled!==false);
}
export function assertToolEnabled(settings:Record<string,any>,id:ToolId) {
  if(!toolEnabled(settings,id))throw httpError(403,'此创作工具暂未开放，请选择其他工具');
}
export function generationTools(input:Record<string,any>):ToolId[]{
  const tools=new Set<ToolId>(),context=input.context||{};
  if(context.tool==='ai-tryon')tools.add('tryon');
  if(['image-remix','remix'].includes(context.tool))tools.add('remix');
  if(input.source==='canvas')tools.add('canvas');
  if(input.source==='drama'||context.dramaStage)tools.add('drama');
  if(context.directorNodeId||context.directorProjectId||context.tool==='director')tools.add('director');
  if(context.agentRole==='planner')tools.add('agent');
  return [...tools];
}
function mediaUrl(value:unknown,name:string,optional=false) {
  if(optional&&(value===undefined||value===''))return;
  if(typeof value!=='string'||value.length>2048||/[\\\u0000-\u0020\u007f]/.test(value))throw httpError(400,`${name}应为有效的图片或视频链接`);
  let url:URL;try{url=new URL(value,'https://tool-display.invalid');}catch{throw httpError(400,`${name}无效`);}
  if(url.username||url.password||url.hash||!['https:'].includes(url.protocol)||value.startsWith('//'))throw httpError(400,`${name}须使用 HTTPS 或本站素材链接`);
  if(value.startsWith('/')){
    if(!/^\/(?:media\/|tool-showcase-\d{8}\/|api\/creative-tools\/media\/)/.test(value)||value.includes('..')||/%(?:2e|2f|5c)/i.test(value))throw httpError(400,`${name}不是公开展示素材链接`);
  }else if(!value.startsWith('https://'))throw httpError(400,`${name}须使用 HTTPS`);
}
/** Validate only the submitted tool rows; existing model/payment settings remain untouched. */
export function validateToolSettings(value:unknown) {
  const rows=object(value);
  for(const [id,raw] of Object.entries(rows)){
    if(!TOOL_IDS.includes(id as ToolId))throw httpError(400,'未知的创作工具');
    const row=object(raw);
    if(Object.keys(row).some(key=>!['enabled','title','description','order','effect','intervalMs','fit','media'].includes(key)))throw httpError(400,'未知的创作工具展示字段');
    if(row.enabled!==undefined&&typeof row.enabled!=='boolean')throw httpError(400,'工具开关必须为开启或关闭');
    for(const [key,max] of [['title',40],['description',240]] as const)if(row[key]!==undefined&&(typeof row[key]!=='string'||row[key].length>max||/[\u0000-\u001f]/.test(row[key])))throw httpError(400,`${key==='title'?'工具标题':'工具描述'}过长或格式无效`);
    if(row.order!==undefined&&(!Number.isInteger(row.order)||row.order<0||row.order>1000))throw httpError(400,'展示顺序应为 0–1000 的整数');
    if(row.effect!==undefined&&!['zoom','carousel','compare','video'].includes(row.effect))throw httpError(400,'不支持的展示效果');
    if(row.fit!==undefined&&!['cover','contain'].includes(row.fit))throw httpError(400,'不支持的图片适配方式');
    if(row.intervalMs!==undefined&&(!Number.isInteger(row.intervalMs)||row.intervalMs<2500||row.intervalMs>15000))throw httpError(400,'轮播间隔应为 2500–15000 毫秒');
    if(row.media!==undefined){
      if(!Array.isArray(row.media)||row.media.length>8)throw httpError(400,'每个工具最多配置 8 个媒体');
      for(const rawMedia of row.media){const media=object(rawMedia);
        if(Object.keys(media).some(key=>!['type','url','poster','label'].includes(key))||!['image','video'].includes(media.type))throw httpError(400,'展示媒体类型无效');
        mediaUrl(media.url,'媒体链接');mediaUrl(media.poster,'视频封面',true);
        if(media.label!==undefined&&(typeof media.label!=='string'||media.label.length>80||/[\u0000-\u001f]/.test(media.label)))throw httpError(400,'媒体说明最多 80 字');
      }
      if(row.effect==='compare'&&(row.media.length<2||row.media.slice(0,2).some((m:any)=>m.type!=='image')))throw httpError(400,'前后对比需要至少两张图片');
      if(row.effect==='carousel'&&row.media.length<2)throw httpError(400,'轮播需要至少两个媒体');
      if(row.effect==='video'&&!row.media.some((m:any)=>m.type==='video'))throw httpError(400,'悬浮视频需要配置视频');
    }
  }
}
