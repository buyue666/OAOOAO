import {type Context,httpError,object} from './core.js';

export const WECHAT_CALLBACK_PATH='/api/integrations/wechat-official/callback';
export type WechatConfig={enabled:boolean;autoRegister:boolean;appId:string;appSecret:string;token:string;encodingAESKey:string};
export const DEFAULT_WECHAT:WechatConfig={enabled:false,autoRegister:false,appId:'',appSecret:'',token:'',encodingAESKey:''};
export function wechatConfig(value:unknown):WechatConfig {
  const raw=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
  return {enabled:raw.enabled===true,autoRegister:raw.autoRegister===true,appId:typeof raw.appId==='string'?raw.appId:'',
    appSecret:typeof raw.appSecret==='string'?raw.appSecret:'',token:typeof raw.token==='string'?raw.token:'',encodingAESKey:typeof raw.encodingAESKey==='string'?raw.encodingAESKey:''};
}
export function wechatConfigured(value:unknown){const c=wechatConfig(value);return /^wx[A-Za-z0-9]{16}$/.test(c.appId)&&[c.appSecret,c.token,c.encodingAESKey].every(s=>s.startsWith('enc:v1:'));}
export function publicWechatConfig(value:unknown,origin=''){
  const c=wechatConfig(value);return {enabled:c.enabled,autoRegister:c.autoRegister,appId:c.appId,hasAppSecret:Boolean(c.appSecret),hasToken:Boolean(c.token),hasEncodingAESKey:Boolean(c.encodingAESKey),configured:wechatConfigured(c),callbackUrl:origin+WECHAT_CALLBACK_PATH};
}
export function validateWechatConfig(ctx:Context,current:unknown,input:unknown):WechatConfig {
  const old=wechatConfig(current),patch=object(input),next={...old};
  const fields=['appSecret','token','encodingAESKey'] as const;
  const allowed=new Set(['enabled','autoRegister','appId',...fields,'clearAppSecret','clearToken','clearEncodingAESKey']);
  for(const key of Object.keys(patch))if(!allowed.has(key))throw httpError(400,'包含不支持的微信配置字段');
  for(const key of ['enabled','autoRegister'] as const)if(patch[key]!==undefined){if(typeof patch[key]!=='boolean')throw httpError(400,'微信登录开关的值无效');next[key]=patch[key];}
  if(patch.appId!==undefined){if(typeof patch.appId!=='string'||(patch.appId!==''&&!/^wx[A-Za-z0-9]{16}$/.test(patch.appId)))throw httpError(400,'公众号应用标识（AppID）格式无效');next.appId=patch.appId;}
  const changed=next.appId!==old.appId&&Boolean(old.appId);
  for(const key of fields){
    const clear='clear'+key[0].toUpperCase()+key.slice(1),value=patch[key];
    if(patch[clear]!==undefined&&typeof patch[clear]!=='boolean')throw httpError(400,'清除微信密钥的选项无效');
    if(value!==undefined&&typeof value!=='string')throw httpError(400,'微信密钥必须是文本');
    if(patch[clear]===true&&value)throw httpError(400,'同一微信密钥不能同时替换和清除');
    if(changed&&!value)throw httpError(400,'更换公众号应用标识时，需要重新填写应用密钥、验证令牌和消息加解密密钥');
    if(patch[clear]===true){next[key]='';continue;}
    if(!value)continue;
    const valid=key==='encodingAESKey'?/^[A-Za-z0-9]{43}$/.test(value)&&Buffer.from(value+'=','base64').length===32:key==='token'?/^[A-Za-z0-9]{3,32}$/.test(value):/^[A-Za-z0-9]{16,128}$/.test(value);
    if(!valid)throw httpError(400,key==='encodingAESKey'?'消息加解密密钥格式无效，应为微信提供的 43 位字母或数字':key==='token'?'验证令牌格式无效，应为 3 至 32 位字母或数字':'公众号应用密钥格式无效');
    next[key]=ctx.encrypt(value);
  }
  return next;
}
