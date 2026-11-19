import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { httpError, object, safeFetch } from './core.js';

export const BALANCE_NOTIFY_PATH='/api/billing/webhooks/ciyuan_balance';
export const BALANCE_RETURN_PATH='/api/billing/ciyuan/return';
export const BALANCE_FIELDS=[
  {key:'gatewayUrl',label:'New API 网站地址',kind:'url',required:true,secret:false},
  {key:'merchantId',label:'商户标识',kind:'text',required:true,secret:false},
  {key:'secret',label:'商户签名密钥',kind:'secret',required:true,secret:true},
];
export type BalanceConfig={gatewayUrl:string;merchantId:string;secret:string;nonce?:string};
type Row=Record<string,any>;
export function balanceConfig(values:Row,secrets:Row):BalanceConfig {
  let gateway:URL;
  try{gateway=new URL(values.gatewayUrl);}catch{throw httpError(400,'请填写有效的 New API 网站地址');}
  if(gateway.protocol!=='https:'||gateway.username||gateway.password||gateway.search||gateway.hash||gateway.pathname!=='/'||(gateway.port&&gateway.port!=='443'))throw httpError(400,'New API 网站地址必须为 HTTPS 根地址');
  if(typeof values.merchantId!=='string'||! /^[A-Za-z0-9_-]{1,64}$/.test(values.merchantId))throw httpError(400,'商户标识须为 1–64 位字母、数字、下划线或短横线');
  if(typeof secrets.secret!=='string'||secrets.secret.length<32||secrets.secret.length>2048||/[\u0000-\u0020\u007f]/.test(secrets.secret))throw httpError(400,'商户签名密钥至少需要 32 位且不能包含空白');
  return {gatewayUrl:gateway.origin+'/',merchantId:values.merchantId,secret:secrets.secret};
}
export function balanceSign(secret:string,fields:readonly (string|number)[]):string {
  return createHmac('sha256',secret).update(fields.join('\n')).digest('hex');
}
export function balanceCheckout(config:BalanceConfig,order:Row) {
  if(!config.nonce)throw httpError(500,'余额支付凭据尚未固定');
  const input={merchant_id:config.merchantId,order_id:order.id,order_no:order.order_no,amount_cents:Number(order.amount_cents),currency:order.currency,subject:String(order.subject).trim(),expires_at:Math.floor(new Date(order.expires_at).getTime()/1000),nonce:config.nonce};
  if(input.currency!=='CNY'||!Number.isSafeInteger(input.amount_cents)||input.amount_cents<=0||input.amount_cents>10_000_000||Array.from(input.subject).length>200||/[\r\n\u0000]/.test(input.subject))throw httpError(400,'余额支付仅支持金额大于零、最多十万元的人民币订单，商品名称不能包含换行');
  const signature=balanceSign(config.secret,['v1','checkout',input.merchant_id,input.order_id,input.order_no,input.amount_cents,input.currency,input.subject,input.expires_at,input.nonce]);
  const url=new URL('/ciyuan-balance-pay',config.gatewayUrl);
  url.search=new URLSearchParams(Object.entries({...input,signature}).map(([k,v])=>[k,String(v)])).toString();
  return {provider:'ciyuan_balance',orderId:order.id,orderNo:order.order_no,kind:'redirect' as const,url:url.href,expiresAt:new Date(order.expires_at).toISOString()};
}
export function balanceCallbackFields(input:Row):(string|number)[] {
  return ['v1','callback',input.event_id,input.event_type,input.merchant_id,input.order_id,input.order_no,input.transaction_id,input.amount_cents,input.currency,input.status,input.paid_at];
}
export function verifyBalanceCallback(config:BalanceConfig,input:unknown,signature:unknown):Row {
  const value=object(input);
  for(const key of ['event_id','event_type','merchant_id','order_id','order_no','transaction_id','currency','status','paid_at']) {
    if(typeof value[key]!=='string'||!value[key]||value[key].length>240||/[\u0000-\u001f\u007f]/.test(value[key]))throw httpError(400,'余额支付通知格式无效');
  }
  if(value.merchant_id!==config.merchantId||value.event_type!=='payment.succeeded'||value.status!=='succeeded'||value.currency!=='CNY'||!Number.isSafeInteger(value.amount_cents)||value.amount_cents<=0||!Number.isFinite(Date.parse(value.paid_at)))throw httpError(400,'余额支付通知内容无效');
  if(typeof signature!=='string'||! /^[a-f\d]{64}$/i.test(signature)||!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(balanceSign(config.secret,balanceCallbackFields(value)),'hex')))throw httpError(400,'余额支付通知签名无效');
  return value;
}
/** The cashier authorizes debits. This client only queries receipts or refunds a reserved order. */
export async function balanceAction(config:BalanceConfig,action:'query'|'refund',order:Row,transactionId='',transport:typeof safeFetch=safeFetch):Promise<Row|null> {
  const input={merchant_id:config.merchantId,order_no:order.order_no,transaction_id:transactionId,amount_cents:action==='refund'?Number(order.amount_cents):0,currency:action==='refund'?'CNY':'',timestamp:Math.floor(Date.now()/1000),nonce:randomBytes(24).toString('hex')};
  const signature=balanceSign(config.secret,['v1',action,input.merchant_id,input.order_no,input.transaction_id,input.amount_cents,input.currency,input.timestamp,input.nonce]);
  const response=await transport(new URL('/api/vozeb-balance/'+action,config.gatewayUrl),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...input,signature}),timeoutMs:10000,maxBytes:16384});
  if(action==='query'&&response.status===404)return null;
  let payload:Row;
  try{payload=object(await response.json());}catch{throw httpError(502,'余额支付服务未返回有效回执');}
  if(!response.ok||payload.success!==true)throw httpError(502,'余额支付结果尚未确认，请稍后核对，勿重复操作');
  const result=object(payload.data);
  if(result.merchant_id!==config.merchantId||result.order_id!==order.id||result.order_no!==order.order_no||result.amount_cents!==Number(order.amount_cents)||result.currency!==order.currency||typeof result.transaction_id!=='string'||!result.transaction_id||result.transaction_id.length>160||!['paid','refunded'].includes(result.status)||(transactionId&&result.transaction_id!==transactionId))throw httpError(502,'余额支付回执与本站订单不一致，请联系管理员对账');
  if(action==='refund'&&result.status!=='refunded')throw httpError(502,'余额退款结果尚未确认，积分继续预留');
  return result;
}
