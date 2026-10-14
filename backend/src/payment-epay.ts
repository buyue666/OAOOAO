/** Independently implemented from published EPay wire-protocol documentation.
 * Checkout is a signed POST form; no provider HTML or remote code is executed. */
import { createHash, createPrivateKey, createPublicKey, sign, verify, timingSafeEqual, type KeyObject } from 'node:crypto';
import { isIP } from 'node:net';
import { httpError, isPublicAddress } from './core.js';

export const EPAY_FIELDS = [
  {key:'gatewayUrl',label:'易支付网关地址',kind:'url',required:true,secret:false},
  {key:'pid',label:'商户 ID',kind:'text',required:true,secret:false},
  {key:'protocol',label:'协议版本',kind:'select',required:true,secret:false,options:[{value:'v2_rsa',label:'V2 · RSA-SHA256'},{value:'v1_md5',label:'V1 · MD5（兼容旧网关）'}]},
  {key:'paymentType',label:'支付方式',kind:'select',required:true,secret:false,options:[{value:'cashier',label:'网关收银台选择'},{value:'alipay',label:'支付宝'},{value:'wxpay',label:'微信支付'}]},
  {key:'key',label:'V1 商户密钥',kind:'secret',secret:true},
  {key:'merchantPrivateKey',label:'V2 商户 RSA 私钥',kind:'textarea',secret:true},
  {key:'platformPublicKey',label:'V2 平台 RSA 公钥',kind:'textarea',secret:true},
];
export interface EpayConfig {gatewayUrl:string;pid:string;protocol:'v1_md5'|'v2_rsa';paymentType:'cashier'|'alipay'|'wxpay';key?:string;merchantPrivateKey?:string;platformPublicKey?:string;}
export const EPAY_NOTIFY_PATH='/api/billing/webhooks/epay';
export const EPAY_RETURN_PATH='/api/billing/epay/return';

function rsaKey(value:string, privateKey:boolean):KeyObject {
  try {
    let key:KeyObject;
    if(value.includes('-----BEGIN '))key=privateKey?createPrivateKey(value):createPublicKey(value);
    else {
      const raw=value.replace(/\s/g,'');
      if(!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))throw new Error();
      const der=Buffer.from(raw,'base64');
      if(privateKey){try{key=createPrivateKey({key:der,format:'der',type:'pkcs8'});}catch{key=createPrivateKey({key:der,format:'der',type:'pkcs1'});}}
      else {try{key=createPublicKey({key:der,format:'der',type:'spki'});}catch{key=createPublicKey({key:der,format:'der',type:'pkcs1'});}}
    }
    if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<2048)throw new Error();
    // A platform public key field must never silently accept a private key.
    if(!privateKey&&value.includes('PRIVATE KEY'))throw new Error();
    return key;
  }catch{throw httpError(400,privateKey?'易支付商户 RSA 私钥无效，至少需要 2048 位':'易支付平台 RSA 公钥无效，至少需要 2048 位');}
}
export function epayGateway(value:unknown):string {
  if(typeof value!=='string'||value.length>2048||!/^https:\/\/[^/]/i.test(value)||/[\u0000-\u0020\u007f\\]/.test(value))throw httpError(400,'易支付 HTTPS 网关地址无效');
  try {
    const url=new URL(value),host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase().replace(/\.$/,'');
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port&&url.port!=='443'||!host.includes('.')||host==='localhost'||/\.(localhost|local|internal|invalid)$/.test(host)||isIP(host)&&!isPublicAddress(host))throw new Error();
    if(/\/(submit\.php|mapi\.php|api\/pay\/submit)\/?$/i.test(url.pathname))throw new Error();
    return url.href.replace(/\/*$/,'/');
  }catch{throw httpError(400,'请填写 HTTPS 网关根地址，不要包含账号密码、查询参数、锚点或 submit.php 等支付接口路径');}
}
/** Validate even disabled drafts when a supplied field is nonempty; enabling needs every protocol-specific credential. */
export function validateEpayValues(values:Record<string,any>, secrets:Record<string,any>, complete:boolean):void {
  values.protocol=values.protocol||'v2_rsa';values.paymentType=values.paymentType||'cashier';
  if(!['v1_md5','v2_rsa'].includes(values.protocol))throw httpError(400,'易支付协议版本无效');
  if(!['cashier','alipay','wxpay'].includes(values.paymentType))throw httpError(400,'易支付支付方式无效');
  if(values.gatewayUrl)values.gatewayUrl=epayGateway(values.gatewayUrl);else if(complete)throw httpError(400,'请填写易支付网关地址');
  if(values.pid&&!/^[1-9]\d{0,19}$/.test(values.pid)||complete&&!values.pid)throw httpError(400,'易支付商户 ID 无效');
  if(secrets.key&&(typeof secrets.key!=='string'||secrets.key.length<8||secrets.key.length>512||/[\u0000-\u0020\u007f]/.test(secrets.key)))throw httpError(400,'易支付 V1 商户密钥无效');
  if(secrets.merchantPrivateKey)rsaKey(secrets.merchantPrivateKey,true);
  if(secrets.platformPublicKey)rsaKey(secrets.platformPublicKey,false);
  if(complete&&(values.protocol==='v1_md5'?!secrets.key:!secrets.merchantPrivateKey||!secrets.platformPublicKey))throw httpError(400,'请补齐所选易支付协议需要的密钥');
}
export function epayConfig(values:Record<string,any>,secrets:Record<string,any>):EpayConfig {
  const publicValues={...values};validateEpayValues(publicValues,secrets,true);return {...publicValues,...secrets} as EpayConfig;
}
export function epayCanonical(fields:Record<string,string>):string {
  return Object.keys(fields).filter(key=>key!=='sign'&&key!=='sign_type'&&fields[key]!=='').sort().map(key=>`${key}=${fields[key]}`).join('&');
}
export function epaySign(fields:Record<string,string>,config:EpayConfig):string {
  const canonical=epayCanonical(fields);
  return config.protocol==='v1_md5'?createHash('md5').update(canonical+config.key,'utf8').digest('hex'):sign('RSA-SHA256',Buffer.from(canonical),rsaKey(config.merchantPrivateKey!,true)).toString('base64');
}
export function epayVerify(fields:Record<string,string>,config:EpayConfig):boolean {
  try {
    if(config.protocol==='v1_md5'){
      if(fields.sign_type!=='MD5'||!/^[a-fA-F0-9]{32}$/.test(fields.sign??''))return false;
      return timingSafeEqual(Buffer.from(epaySign(fields,config),'hex'),Buffer.from(fields.sign,'hex'));
    }
    if(fields.sign_type!=='RSA'||!/^[A-Za-z0-9+/]+={0,2}$/.test(fields.sign??''))return false;
    return verify('RSA-SHA256',Buffer.from(epayCanonical(fields)),rsaKey(config.platformPublicKey!,false),Buffer.from(fields.sign,'base64'));
  }catch{return false;}
}
export function parseEpayNotification(raw:string):Record<string,string> {
  if(Buffer.byteLength(raw)>16384)throw httpError(400,'EPay notification is too large');
  const result:Record<string,string>=Object.create(null);
  for(const [key,value] of new URLSearchParams(raw)){
    // An ampersand inside a value makes the legacy unescaped signing format ambiguous.
    if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)||Object.hasOwn(result,key)||value.length>4096||/[\u0000-\u001f\u007f&]/.test(value))throw httpError(400,'Invalid or duplicate EPay notification parameter');
    result[key]=value;
    if(Object.keys(result).length>40)throw httpError(400,'Too many EPay notification parameters');
  }
  return result;
}
export function epayMoneyCents(value:string):bigint {
  if(!/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value??''))throw httpError(400,'Invalid EPay payment amount');
  const [whole,fraction='']=value.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
}
export function epayCheckout(config:EpayConfig,origin:string,order:{id:string;order_no:string;subject:string;amount_cents:string|number;currency:string;expires_at:Date},now=Date.now()) {
  const cents=BigInt(order.amount_cents);
  if(order.currency!=='CNY'||cents<=0n)throw httpError(400,'易支付只支持金额大于零的人民币订单');
  const fields:Record<string,string>={pid:config.pid,out_trade_no:order.order_no,notify_url:new URL(EPAY_NOTIFY_PATH,origin).href,return_url:new URL(EPAY_RETURN_PATH,origin).href,name:'OAOOAO '+order.order_no,money:`${cents/100n}.${String(cents%100n).padStart(2,'0')}`};
  if(config.paymentType!=='cashier')fields.type=config.paymentType;
  if(config.protocol==='v2_rsa')fields.timestamp=String(Math.floor(now/1000));
  fields.sign_type=config.protocol==='v1_md5'?'MD5':'RSA';fields.sign=epaySign(fields,config);
  return {provider:'epay',orderId:order.id,orderNo:order.order_no,kind:'form' as const,form:{action:new URL(config.protocol==='v1_md5'?'submit.php':'api/pay/submit',config.gatewayUrl).href,method:'POST',fields:Object.entries(fields).map(([name,value])=>({name,value}))},expiresAt:order.expires_at.toISOString()};
}
