import { createHash } from 'node:crypto';
import { httpError, object } from './core.js';
import { footerUrl } from './site-footer.js';

const pngPrefix='data:image/png;base64,';
const publicPath='/api/site/wechat-qr';
const maxPngBytes=220*1024;
const defaults={enabled:false,imageUrl:'',caption:''};
const signature=Buffer.from('89504e470d0a1a0a','hex');

export function uploadedWechatPng(value:unknown):Buffer|undefined {
  if(typeof value!=='string'||!value.startsWith(pngPrefix)||value.length>pngPrefix.length+Math.ceil(maxPngBytes/3)*4)return;
  const encoded=value.slice(pngPrefix.length),png=Buffer.from(encoded,'base64');
  if(png.length<45||png.length>maxPngBytes||png.toString('base64')!==encoded||!png.subarray(0,8).equals(signature)
    ||png.readUInt32BE(8)!==13||png.toString('ascii',12,16)!=='IHDR'||png.toString('ascii',png.length-8,png.length-4)!=='IEND')return;
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
  if(width<1||height<1||width>512||height>512)return;
  return png;
}
export const wechatQrVersion=(png:Buffer)=>createHash('sha256').update(png).digest('hex').slice(0,24);

export function validateWechatContact(value:unknown) {
  const input=object(value), data={...defaults,...input};
  if(Object.keys(input).some(key=>!Object.hasOwn(defaults,key))||typeof data.enabled!=='boolean'||typeof data.imageUrl!=='string'
    ||typeof data.caption!=='string'||data.caption.length>100||/[\u0000-\u001f\u007f]/.test(data.caption))throw httpError(400,'微信二维码配置有误');
  let imageUrl=data.imageUrl.trim();
  if(imageUrl.startsWith('data:')){
    if(!uploadedWechatPng(imageUrl))throw httpError(400,'请重新上传不大于 220 KB 的二维码图片');
  }else{
    try{imageUrl=footerUrl(imageUrl);}catch{throw httpError(400,'请填写有效的二维码图片地址');}
    if(imageUrl.split(/[?#]/,1)[0].replace(/\/$/,'')===publicPath)throw httpError(400,'请重新上传二维码，或使用其他图片地址');
  }
  if(data.enabled&&!imageUrl)throw httpError(400,'请先上传二维码图片或填写图片地址，再开启微信入口');
  return {enabled:data.enabled,imageUrl,caption:data.caption.trim()};
}

export function visibleWechatContact(value:unknown,admin=false){
  try{
    const config=validateWechatContact(value);
    if(!admin&&!config.enabled)return {...defaults};
    const png=uploadedWechatPng(config.imageUrl);
    return {...config,...(png?{imageUrl:`${publicPath}?v=${wechatQrVersion(png)}`,...(admin?{uploaded:true}:{})}:{})};
  }catch{return {...defaults};}
}
