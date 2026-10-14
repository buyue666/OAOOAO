import {createDecipheriv,createHash,timingSafeEqual} from 'node:crypto';
import {httpError,safeFetch} from './core.js';

/** A deliberately small flat-XML reader for the documented WeChat event envelope.
 * No DTD, entities, attributes, nested nodes, duplicate fields or recovery parsing. */
export function readWechatXml(input:unknown):Record<string,string>{
  if(typeof input!=='string'||Buffer.byteLength(input)>65536||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input))throw httpError(400,'Invalid WeChat message');
  const match=/^\s*(?:<\?xml version=["']1\.0["'](?: encoding=["']UTF-8["'])?\?>\s*)?<xml>\s*([\s\S]*?)\s*<\/xml>\s*$/i.exec(input);
  if(!match)throw httpError(400,'Invalid WeChat message');
  const result:Record<string,string>=Object.create(null);let rest=match[1];
  while(rest.trim()){
    const field=/^\s*<([A-Za-z][A-Za-z0-9_]*)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>\s*/.exec(rest);
    if(!field||Object.hasOwn(result,field[1]))throw httpError(400,'Invalid WeChat message');
    if(field[3]?.includes('&'))throw httpError(400,'WeChat XML entities are not supported');
    result[field[1]]=field[2]??field[3];rest=rest.slice(field[0].length);
  }
  return result;
}
export function verifyWechatSignature(token:string,query:Record<string,unknown>,encrypted?:string,now=Date.now()){
  const stamp=query.timestamp,nonce=query.nonce,signature=encrypted===undefined?query.signature:query.msg_signature;
  if(typeof stamp!=='string'||!/^\d{10}$/.test(stamp)||Math.abs(Number(stamp)*1000-now)>300000||typeof nonce!=='string'||!nonce||nonce.length>128||typeof signature!=='string'||!/^([a-f0-9]{40})$/i.test(signature))throw httpError(403,'Invalid WeChat signature');
  const expected=createHash('sha1').update([token,stamp,nonce,...(encrypted===undefined?[]:[encrypted])].sort().join('')).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))throw httpError(403,'Invalid WeChat signature');
}
export function decryptWechatMessage(encrypted:string,encodingKey:string,appId:string){
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted)||encrypted.length>90000||encrypted.length%4)throw httpError(400,'Invalid encrypted WeChat message');
  try{
    const key=Buffer.from(encodingKey+'=','base64'),bytes=Buffer.from(encrypted,'base64');
    if(key.length!==32||bytes.length%16||bytes.toString('base64')!==encrypted)throw new Error();
    const cipher=createDecipheriv('aes-256-cbc',key,key.subarray(0,16));cipher.setAutoPadding(false);
    let plain=Buffer.concat([cipher.update(bytes),cipher.final()]);const padding=plain.at(-1)!;
    if(!padding||padding>32||padding>plain.length||!plain.subarray(-padding).every(b=>b===padding))throw new Error();
    plain=plain.subarray(0,-padding);if(plain.length<20)throw new Error();const length=plain.readUInt32BE(16);
    if(length>65536||20+length>=plain.length||plain.subarray(20+length).toString('utf8')!==appId)throw new Error();
    return new TextDecoder('utf-8',{fatal:true}).decode(plain.subarray(20,20+length));
  }catch{throw httpError(403,'Invalid encrypted WeChat message');}
}
export type WechatQrProvider=(credentials:{appId:string;appSecret:string},scene:string,seconds:number)=>Promise<{ticket:string;expiresIn:number}>;
export function createWechatQrProvider(fetcher:typeof safeFetch=safeFetch):WechatQrProvider {
  let cache:{key:string;token:string;until:number}|undefined;let pending:{key:string;promise:Promise<string>}|undefined;
  async function token(appId:string,appSecret:string){
    const key=createHash('sha256').update(appId+'\0'+appSecret).digest('hex');
    if(cache?.key===key&&cache.until>Date.now())return cache.token;
    if(pending?.key===key)return pending.promise;
    const promise=(async()=>{
      const response=await fetcher('https://api.weixin.qq.com/cgi-bin/stable_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credential',appid:appId,secret:appSecret,force_refresh:false}),timeoutMs:10000,maxBytes:65536});
      const body=await response.json() as any;
      if(!response.ok||body.errcode||typeof body.access_token!=='string'||!body.access_token||body.access_token.length>4096||!Number.isFinite(body.expires_in)||body.expires_in<60)throw httpError(502,'微信凭据验证失败，请管理员检查服务号权限、IP白名单与密钥');
      cache={key,token:body.access_token,until:Date.now()+Math.min(body.expires_in-30,7000)*1000};return cache.token;
    })();pending={key,promise};try{return await promise;}finally{if(pending?.promise===promise)pending=undefined;}
  }
  return async(credentials,scene,seconds)=>{
    try{
      const accessToken=await token(credentials.appId,credentials.appSecret);
      const url=new URL('https://api.weixin.qq.com/cgi-bin/qrcode/create');url.searchParams.set('access_token',accessToken);
      const response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expire_seconds:seconds,action_name:'QR_STR_SCENE',action_info:{scene:{scene_str:scene}}}),timeoutMs:10000,maxBytes:65536});
      const body=await response.json() as any;
      if(!response.ok||body.errcode||typeof body.ticket!=='string'||!body.ticket||body.ticket.length>4096||!Number.isFinite(body.expire_seconds)||body.expire_seconds<=0){if([40001,40014,42001].includes(body.errcode))cache=undefined;throw new Error();}
      return {ticket:body.ticket,expiresIn:Math.min(seconds,Math.floor(body.expire_seconds))};
    }catch{throw httpError(502,'微信二维码暂不可用，请稍后重试或联系管理员检查服务号配置');}
  };
}
