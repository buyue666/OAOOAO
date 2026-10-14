import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import type { Context } from './core.js';
import { httpError, object, pagination, string } from './core.js';
import { adjustWallet, creditDecimal, creditUnits, getWallet, syncDailyEntitlement, walletTransaction } from './wallet.js';
import { resolveCommercePolicy } from './commerce-policy.js';
export { resolveCommercePolicy } from './commerce-policy.js';

type Row = Record<string, any>;
const timestamp = (value: unknown) => value ? new Date(value as string).toISOString() : undefined;
const numericColumns = new Set(['amount_cents','list_amount_cents','promotion_discount_cents','coupon_discount_cents','points_amount','daily_points','discount_value','min_amount_cents','max_discount_cents','points','clicks']);
function view(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !['request_fingerprint','request_key'].includes(key)).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value instanceof Date ? value.toISOString() : numericColumns.has(key) ? Number(value) : value]));
}
function integer(value: unknown, name: string, min = 0, max = 1_000_000_000): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw httpError(400, `Invalid ${name}`);
  return value;
}
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw httpError(400, `Invalid ${name}`);
  return value;
}
function decimal(value: unknown, name: string): string {
  if (typeof value !== 'number' && typeof value !== 'string') throw httpError(400, `Invalid ${name}`);
  const units = creditUnits(value);
  if (units < 0n) throw httpError(400, `${name} cannot be negative`);
  return creditDecimal(units);
}
function date(value: unknown, name: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(new Date(value).getTime())) throw httpError(400, `Invalid ${name}`);
  return new Date(value).toISOString();
}
function dateWindow(input: Row) {
  const starts = date(input.startsAt, 'startsAt'); const ends = date(input.endsAt, 'endsAt');
  if (starts && ends && starts >= ends) throw httpError(400, 'endsAt must follow startsAt');
  return { starts, ends };
}
function params(request: FastifyRequest): Row { return request.params as Row; }
async function settings(ctx: Context, db: PoolClient | Context['db'] = ctx.db): Promise<Row> {
  return (await db.query("SELECT value FROM oaooao_settings WHERE id='global'")).rows[0]?.value ?? {};
}
export function purchaseReadiness(site: Row, policy: Row): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (policy.status !== 'published') missing.push('Purchase policy is not published');
  for (const key of ['version','refundPolicy','pointsExpiryPolicy','renewalPolicy','invoicePolicy']) if (typeof policy[key] !== 'string' || !policy[key].trim()) missing.push(`Missing ${key}`);
  const https = (value: unknown) => { try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(policy.supportEmail ?? '')) && !https(policy.supportUrl)) missing.push('Missing a valid support contact');
  for (const kind of ['terms','privacy']) {
    if (!site[`${kind}Version`]) missing.push(`Missing ${kind} version`);
    const path = site[`${kind}Url`];
    if (path === `/${kind}` ? !String(site[`${kind}Content`] ?? '').trim() : !https(path)) missing.push(`Missing ${kind} content or HTTPS URL`);
  }
  return { ready: missing.length === 0, missing };
}
const providerDefinitions = [
  { id: 'manual', name: 'Manual settlement', description: 'Checkout supplies instructions. An authorized administrator must confirm receipt before credits are granted. Before sending an external refund, prepare it to reserve purchased credits and settled referral rewards. Only after successful preparation, send and verify the refund outside this service, then confirm using the reservation identifier. Reservations do not expire automatically. Cancel only after verifying no money was sent. This service never transfers cash.', fields: [{ key: 'instructions', label: 'Settlement instructions', kind: 'textarea', required: true, secret: false }] },
  { id: 'alipay', name: 'Alipay', description: 'Protocol adapter unavailable in this version. Stored configuration is preserved; checkout and payment callbacks cannot succeed.', fields: [{ key: 'appId', label: 'Application ID', kind: 'text', secret: false }, { key: 'privateKey', label: 'Merchant private key', kind: 'secret', secret: true }, { key: 'alipayPublicKey', label: 'Alipay public key', kind: 'secret', secret: true }] },
  { id: 'wechat', name: 'WeChat Pay', description: 'Protocol adapter unavailable in this version. Stored configuration is preserved; checkout and payment callbacks cannot succeed.', fields: [{ key: 'appId', label: 'Application ID', kind: 'text', secret: false }, { key: 'mchId', label: 'Merchant ID', kind: 'text', secret: false }, { key: 'apiV3Key', label: 'API v3 key', kind: 'secret', secret: true }, { key: 'privateKey', label: 'Merchant private key', kind: 'secret', secret: true }] },
  { id: 'stripe', name: 'Stripe', description: 'Protocol adapter unavailable in this version. Stored configuration is preserved; checkout and payment callbacks cannot succeed.', fields: [{ key: 'secretKey', label: 'Secret key', kind: 'secret', secret: true }, { key: 'webhookSecret', label: 'Webhook secret', kind: 'secret', secret: true }] },
];
async function paymentConfig(ctx: Context, db: PoolClient | Context['db'] = ctx.db) {
  const saved = (await db.query('SELECT * FROM oaooao_payment_configs')).rows;
  const providers = providerDefinitions.map(def => {
    const config = saved.find(row => row.provider_id === def.id);
    const publicValues = config?.public_values ?? {};
    const secrets = config?.encrypted_secrets ? JSON.parse(ctx.decrypt(config.encrypted_secrets)) : {};
    const ready = def.id === 'manual' && config?.enabled === true && Boolean(String(publicValues.instructions ?? '').trim());
    return { id: def.id, name: def.name, description: def.description, checkoutKind: def.id === 'manual' ? 'manual' : 'unavailable', enabled: config?.enabled === true, ready, checkoutReady: ready, webhookReady: false, webhookOptional: def.id === 'manual', fields: def.fields.map(field => ({ ...field, configured: Boolean((field.secret ? secrets : publicValues)[field.key]), ...(!field.secret ? { value: String(publicValues[field.key] ?? '') } : {}) })), checkoutRequirements: [{ label: def.id === 'manual' ? 'Settlement instructions and administrator confirmation' : 'Implemented and verified provider protocol', configured: ready }], webhookRequirements: def.id === 'manual' ? [] : [{ label: 'Verified signed payment notifications', configured: false }] };
  });
  return { origin: ctx.config.origin, readyProviders: providers.filter(provider => provider.ready).length, providers, generatedAt: new Date().toISOString() };
}
async function assertManualReady(ctx: Context, db: PoolClient, provider: string) {
  if (provider !== 'manual') throw httpError(503, 'Payment provider protocol is unavailable; no payment has been initiated');
  const config = (await db.query("SELECT * FROM oaooao_payment_configs WHERE provider_id='manual'")).rows[0];
  if (!config?.enabled || !String(config.public_values.instructions ?? '').trim()) throw httpError(503, 'Manual payment instructions are not configured');
  return config.public_values.instructions as string;
}
function productInput(input: Row, previous?: Row): Row {
  const value = { ...(previous ? view(previous) : {}), ...input };
  const kind = value.productKind ?? 'points';
  if (!['points','plan'].includes(kind)) throw httpError(400, 'Invalid productKind');
  const planId = value.planId ? string(value.planId, 'planId', 120) : null;
  const result = { product_kind: kind, plan_id: planId, name: string(value.name, 'name', 200), description: string(value.description ?? '', 'description', 10000, true), amount_cents: integer(value.amountCents, 'amountCents'), currency: string(value.currency ?? 'CNY','currency',3).toUpperCase(), points_amount: decimal(value.pointsAmount ?? 0,'pointsAmount'), daily_points: decimal(value.dailyPoints ?? 0,'dailyPoints'), period_days: integer(value.periodDays ?? 0,'periodDays',0,3650), enabled: boolean(value.enabled ?? false,'enabled'), sort_order: integer(value.sortOrder ?? 0,'sortOrder',-100000,100000), metadata: object(value.metadata ?? {}) };
  if (!/^[A-Z]{3}$/.test(result.currency)) throw httpError(400, 'Invalid currency');
  if (kind === 'plan' && (!planId || result.period_days < 1)) throw httpError(400, 'Plan products require planId and a positive periodDays');
  if (kind === 'points' && (creditUnits(result.daily_points) > 0n || result.period_days > 0)) throw httpError(400, 'Daily entitlements require a plan product');
  return result;
}
function assertPlanAvailable(config:Row,product:Row):void {
  if(product.product_kind!=='plan')return;
  if(config.entitlements?.enabled!==true)throw httpError(503,'Plan purchases are unavailable until entitlement settings are enabled');
  if(!Array.isArray(config.entitlements.plans)||!config.entitlements.plans.some((plan:Row)=>plan.id===product.plan_id&&plan.enabled===true))throw httpError(503,'Plan purchases are unavailable until the referenced entitlement plan is configured and enabled');
}
async function insertRecord(db: PoolClient, table: string, values: Row) {
  const entries = Object.entries(values);
  // Table and column identifiers below only originate in this module.
  return (await db.query(`INSERT INTO ${table}(${entries.map(([key]) => key).join(',')}) VALUES(${entries.map((_, index) => `$${index + 1}`).join(',')}) RETURNING *`, entries.map(([, value]) => typeof value === 'object' && value !== null && !(value instanceof Date) ? JSON.stringify(value) : value))).rows[0]!;
}
async function updateRecord(db: PoolClient, table: string, id: string, values: Row) {
  const entries = Object.entries(values);
  return (await db.query(`UPDATE ${table} SET ${entries.map(([key], index) => `${key}=$${index + 2}`).join(',')},updated_at=greatest(date_trunc('milliseconds',clock_timestamp()),updated_at+interval '1 millisecond') WHERE id=$1 RETURNING *`, [id, ...entries.map(([, value]) => typeof value === 'object' && value !== null && !(value instanceof Date) ? JSON.stringify(value) : value)])).rows[0]!;
}
async function lockRecord(db: PoolClient, table: string, id: string, expected?: unknown) {
  const row = (await db.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id])).rows[0];
  if (!row) throw httpError(404, 'Record not found');
  if (expected !== undefined && (typeof expected !== 'string' || timestamp(row.updated_at) !== expected)) throw httpError(409, 'The record changed; reload before saving');
  return row;
}
async function priceProduct(db: PoolClient | Context['db'], product: Row) {
  const campaigns = (await db.query('SELECT * FROM oaooao_promotions WHERE enabled AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now()) ORDER BY id')).rows;
  let price = Number(product.amount_cents); let promotion: Row | undefined;
  for (const campaign of campaigns) {
    const offer = campaign.products.find((entry: Row) => entry.productId === product.id);
    if (offer && offer.promotionalAmountCents < price) { price = offer.promotionalAmountCents; promotion = { id: campaign.id, label: campaign.label || campaign.name }; }
  }
  return { listUnitAmountCents: Number(product.amount_cents), saleUnitAmountCents: price, discountCents: Number(product.amount_cents) - price, ...(promotion ? { promotion } : {}) };
}
async function orderList(ctx: Context, request: FastifyRequest, userId?: string) {
  const query = (request.query ?? {}) as Row;
  const page = pagination(query);
  const values: unknown[] = []; const filters: string[] = [];
  const add = (sql: string, value: unknown) => { values.push(value); filters.push(sql.replace('?', `$${values.length}`)); };
  if (userId) add('o.user_id=?', userId);
  else if (query.userId) add('o.user_id=?', string(query.userId,'userId',200));
  if (query.status) add('o.status=?', string(query.status,'status',30));
  if (query.productId) add('o.product_id=?', string(query.productId,'productId',200));
  if (query.keyword) add("(o.order_no || ' ' || o.subject || ' ' || u.username) ILIKE ?", `%${string(query.keyword,'keyword',100)}%`);
  const clause = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
  const base = ' FROM oaooao_orders o JOIN oaooao_users u ON u.id=o.user_id';
  const total = Number((await ctx.db.query(`SELECT count(*) ${base}${clause}`, values)).rows[0]!.count);
  const rows = (await ctx.db.query(`SELECT o.*,u.username AS user_username,u.display_name AS user_display_name ${base}${clause} ORDER BY o.created_at DESC,o.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, page.pageSize, page.offset])).rows;
  return { orders: rows.map(view), total, page: page.page, pageSize: page.pageSize };
}
function couponDiscount(template: Row, amount: number): number {
  if (amount < Number(template.min_amount_cents)) throw httpError(409, 'Coupon minimum purchase amount was not met');
  const result = template.discount_type === 'fixed' ? BigInt(template.discount_value) : BigInt(amount) * BigInt(template.discount_value) / 100n;
  const cap = Number(template.max_discount_cents) > 0 ? BigInt(template.max_discount_cents) : BigInt(amount);
  return Number(result < cap ? (result < BigInt(amount) ? result : BigInt(amount)) : (cap < BigInt(amount) ? cap : BigInt(amount)));
}
async function createOrder(ctx: Context, userId: string, input: Row, headerKey?: string) {
  const productId = string(input.productId,'productId',200);
  const quantity = integer(input.quantity ?? 1,'quantity',1,100);
  const provider = string(input.provider ?? 'manual','provider',40);
  const couponId = input.couponId ? string(input.couponId,'couponId',200) : null;
  const key = headerKey || (input.idempotencyKey ? string(input.idempotencyKey,'idempotencyKey',160) : null);
  if (key && key.length > 160) throw httpError(400, 'Idempotency key is too long');
  const fingerprint = createHash('sha256').update(JSON.stringify({ productId, quantity, provider, couponId })).digest('hex');
  return walletTransaction(ctx, undefined, async db => {
    if (key) {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`order:${userId}:${key}`]);
      const existing = (await db.query('SELECT * FROM oaooao_orders WHERE user_id=$1 AND request_key=$2',[userId,key])).rows[0];
      if (existing) { if (existing.request_fingerprint !== fingerprint) throw httpError(409,'Idempotency key already used for different order instructions'); return view(existing); }
    }
    const config = await settings(ctx, db); const policy=resolveCommercePolicy(config);const readiness = purchaseReadiness(config.site ?? {}, policy ?? {});
    if (config.operationMode !== 'commercial' || !readiness.ready) throw httpError(409,'Purchasing is not enabled or the published purchase policy is incomplete');
    await assertManualReady(ctx, db, provider);
    const product = (await db.query('SELECT * FROM oaooao_products WHERE id=$1 AND enabled FOR SHARE',[productId])).rows[0];
    if (!product) throw httpError(404,'Product not found');
    assertPlanAvailable(config,product);
    if (product.product_kind === 'plan' && quantity !== 1) throw httpError(400,'Plan purchases require quantity 1');
    const pricing = await priceProduct(db, product);
    const list = integer(pricing.listUnitAmountCents * quantity,'order amount',0,100_000_000_000);
    const promotional = pricing.saleUnitAmountCents * quantity;
    let coupon: Row | undefined; let discount = 0;
    if (couponId) {
      coupon = (await db.query(`SELECT c.*,t.name,t.discount_type,t.discount_value,t.min_amount_cents,t.max_discount_cents,t.product_ids FROM oaooao_coupons c JOIN oaooao_coupon_templates t ON t.id=c.template_id WHERE c.id=$1 AND c.user_id=$2 AND c.reserved_order_id IS NULL AND c.redeemed_at IS NULL AND t.enabled AND (t.starts_at IS NULL OR t.starts_at<=now()) AND (t.ends_at IS NULL OR t.ends_at>now()) FOR UPDATE OF c`, [couponId,userId])).rows[0];
      if (!coupon || (coupon.product_ids.length && !coupon.product_ids.includes(productId))) throw httpError(409,'Coupon is unavailable for this purchase');
      discount = couponDiscount(coupon,promotional);
    }
    const id = randomUUID();
    const order = await insertRecord(db,'oaooao_orders',{ id, order_no: `OA${Date.now()}${randomBytes(5).toString('hex').toUpperCase()}`, user_id:userId, product_id:product.id, product_kind:product.product_kind,plan_id:product.plan_id,subject:product.name,quantity,list_amount_cents:list,promotion_discount_cents:list-promotional,coupon_discount_cents:discount,amount_cents:promotional-discount,currency:product.currency,points_amount:creditDecimal(creditUnits(product.points_amount)*BigInt(quantity)),daily_points:product.daily_points,period_days:product.period_days,provider,request_key:key,request_fingerprint:fingerprint,expires_at:new Date(Date.now()+30*60*1000),pricing_snapshot:{...pricing,coupon:coupon?{id:coupon.id,templateId:coupon.template_id,label:coupon.name}:undefined,policyVersion:policy?.version},metadata:{} });
    if (coupon) await db.query('UPDATE oaooao_coupons SET reserved_order_id=$2 WHERE id=$1',[coupon.id,id]);
    return view(order);
  });
}
async function closeOrder(ctx: Context, orderId: string, actorId: string, status: 'closed'|'canceled', reason: string, ownerId?: string) {
  return walletTransaction(ctx,undefined,async db => {
    const order = await lockRecord(db,'oaooao_orders',orderId);
    if (ownerId && order.user_id !== ownerId) throw httpError(404,'Order not found');
    if (order.status === status) return view(order);
    if (order.status !== 'pending') throw httpError(409,'Only pending orders can be closed');
    const result = await updateRecord(db,'oaooao_orders',orderId,{status,closed_at:new Date(),metadata:{...order.metadata,closeReason:reason}});
    await db.query('UPDATE oaooao_coupons SET reserved_order_id=NULL WHERE reserved_order_id=$1 AND redeemed_at IS NULL',[orderId]);
    await ctx.audit({actorId,action:`billing.order.${status}`,targetType:'order',targetId:orderId,metadata:{reason}},db);
    return view(result);
  });
}
/** Manual completion records an administrator's explicit confirmation of external receipt. */
export async function completeManualOrder(ctx: Context, orderId: string, actorId: string, reason: string) {
  return walletTransaction(ctx,undefined,async db => {
    const order = await lockRecord(db,'oaooao_orders',orderId);
    if (order.status === 'paid') return view(order);
    if (order.status !== 'pending') throw httpError(409,'Only pending orders may be settled');
    if (order.provider !== 'manual') throw httpError(503,'This provider requires a verified payment protocol before settlement');
    assertPlanAvailable(await settings(ctx,db),order);
    if (order.expires_at.getTime() <= Date.now()) throw httpError(409,'Order expired; create a new order before accepting payment');
    await adjustWallet(ctx,order.user_id,`order:${order.id}:settle`,order.points_amount,{kind:'order_purchase',orderId:order.id,actorId,reason},db);
    if (order.product_kind === 'plan') {
      // Wallet lock acquired above also serializes simultaneous plan purchases.
      const tail = (await db.query('SELECT greatest(now(),coalesce(max(expires_at),now())) AS starts FROM oaooao_plan_grants WHERE user_id=$1 AND plan_id=$2 AND revoked_at IS NULL',[order.user_id,order.plan_id])).rows[0]!.starts;
      await db.query(`INSERT INTO oaooao_plan_grants(id,user_id,order_id,plan_id,daily_points,starts_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$6::timestamptz+make_interval(days=>$7))`,[randomUUID(),order.user_id,order.id,order.plan_id,order.daily_points,tail,order.period_days]);
      await db.query('UPDATE oaooao_users SET plan_id=$2,updated_at=now() WHERE id=$1',[order.user_id,order.plan_id]);
      await syncDailyEntitlement(ctx,order.user_id,`order:${order.id}:daily-start`,db);
    }
    await insertRecord(db,'oaooao_payments',{id:randomUUID(),order_id:order.id,provider:'manual',provider_payment_id:`manual:${order.id}`,amount_cents:order.amount_cents,currency:order.currency,status:'succeeded',confirmation:{kind:'administrator_confirmed_external_receipt',actorId,reason}});
    const result = await updateRecord(db,'oaooao_orders',order.id,{status:'paid',paid_at:new Date(),provider_order_id:`manual:${order.id}`});
    await db.query('UPDATE oaooao_coupons SET redeemed_at=now() WHERE reserved_order_id=$1',[order.id]);
    await qualifyReferral(ctx,db,result);
    await ctx.audit({actorId,action:'billing.order.confirm_external_payment',targetType:'order',targetId:order.id,metadata:{amountCents:Number(order.amount_cents),currency:order.currency,reason}},db);
    return view(result);
  });
}
type RefundHold = {userId:string;operationId:string;points:string;rewardId?:string};
function reservationView(row:Row) {return {id:row.id,status:row.status,amountCents:Number(row.amount_cents),currency:row.currency,preparedAt:timestamp(row.prepared_at),reason:row.reason};}
async function confirmedPayment(db:PoolClient,order:Row) {
  const payment=(await db.query('SELECT * FROM oaooao_payments WHERE order_id=$1 FOR UPDATE',[order.id])).rows[0];
  if(!payment||payment.status!=='succeeded'||payment.provider!=='manual'||String(payment.amount_cents)!==String(order.amount_cents)||payment.currency!==order.currency)throw httpError(409,'Confirmed matching original payment is missing; reconciliation required before an external refund');
  return payment;
}
/** Reserve recoverable credits BEFORE an administrator sends any money externally. */
export async function prepareManualRefund(ctx:Context,orderId:string,actorId:string,reason:string) {
  return walletTransaction(ctx,undefined,async db=>{
    const order=await lockRecord(db,'oaooao_orders',orderId);
    if(order.provider!=='manual')throw httpError(503,'Provider refund protocol is unavailable; no refund has been sent');
    if(order.status==='refunding'){
      const existing=(await db.query("SELECT * FROM oaooao_refund_reservations WHERE order_id=$1 AND status='prepared'",[orderId])).rows[0];
      if(!existing)throw httpError(409,'Refund reservation is missing; reconciliation required');
      return {order:view(order),reservation:reservationView(existing)};
    }
    if(order.status!=='paid')throw httpError(409,'Only paid manual orders can prepare a refund');
    await confirmedPayment(db,order);
    const relation=(await db.query('SELECT * FROM oaooao_referrals WHERE qualifying_order_id=$1 FOR UPDATE',[orderId])).rows[0];
    const rewards=relation?(await db.query("SELECT * FROM oaooao_referral_rewards WHERE relationship_id=$1 AND status='settled' ORDER BY user_id,id FOR UPDATE",[relation.id])).rows:[];
    await db.query('SELECT id FROM oaooao_users WHERE id=ANY($1::text[]) ORDER BY id FOR NO KEY UPDATE',[[order.user_id,...rewards.map(row=>row.user_id)]]);
    const id=randomUUID(),holds:RefundHold[]=[];
    if(creditUnits(order.points_amount)>0n)holds.push({userId:order.user_id,operationId:`refund:${id}:purchase`,points:creditDecimal(creditUnits(order.points_amount))});
    for(const reward of rewards)if(creditUnits(reward.points)>0n)holds.push({userId:reward.user_id,operationId:`refund:${id}:reward:${reward.id}`,points:creditDecimal(creditUnits(reward.points)),rewardId:reward.id});
    for(const hold of holds)await adjustWallet(ctx,hold.userId,hold.operationId,creditDecimal(-creditUnits(hold.points)),{kind:'order_refund_reserve',bucket:'permanent',orderId,reservationId:id,actorId,reason,description:'Credits reserved pending verified external refund'},db);
    const reservation=(await db.query("INSERT INTO oaooao_refund_reservations(id,order_id,status,amount_cents,currency,holds,reason,prepared_by) VALUES($1,$2,'prepared',$3,$4,$5,$6,$7) RETURNING *",[id,orderId,order.amount_cents,order.currency,JSON.stringify(holds),reason,actorId])).rows[0];
    const result=await updateRecord(db,'oaooao_orders',orderId,{status:'refunding',metadata:{...order.metadata,refundReservation:reservationView(reservation)}});
    await ctx.audit({actorId,action:'billing.order.prepare_external_refund',targetType:'order',targetId:orderId,metadata:{reservationId:id,amountCents:Number(order.amount_cents),currency:order.currency,reason}},db);
    return {order:view(result),reservation:reservationView(reservation)};
  });
}
export async function cancelManualRefund(ctx:Context,orderId:string,actorId:string,reason:string,reservationId:string,confirmExternalRefundNotSent=false) {
  if(!confirmExternalRefundNotSent)throw httpError(409,'Explicitly confirm that no external refund was sent before releasing reserved credits');
  return walletTransaction(ctx,undefined,async db=>{
    const order=await lockRecord(db,'oaooao_orders',orderId);
    const reservation=(await db.query('SELECT * FROM oaooao_refund_reservations WHERE id=$1 AND order_id=$2 FOR UPDATE',[reservationId,orderId])).rows[0];
    if(!reservation)throw httpError(409,'Refund reservation does not match this order');
    if(reservation.status==='canceled')return {order:view(order),reservation:reservationView(reservation)};
    if(reservation.status!=='prepared'||order.status!=='refunding')throw httpError(409,'Only a prepared, unconfirmed refund can be canceled');
    const holds=reservation.holds as RefundHold[];
    await db.query('SELECT id FROM oaooao_users WHERE id=ANY($1::text[]) ORDER BY id FOR NO KEY UPDATE',[[order.user_id,...holds.map(hold=>hold.userId)]]);
    for(const hold of holds)await adjustWallet(ctx,hold.userId,`${hold.operationId}:release`,hold.points,{kind:'order_refund_release',refundOf:hold.operationId,orderId,reservationId,actorId,reason,description:'Refund canceled without external transfer; reserved credits restored'},db);
    const released=(await db.query("UPDATE oaooao_refund_reservations SET status='canceled',resolved_by=$2,resolved_at=now(),resolution_reason=$3 WHERE id=$1 RETURNING *",[reservationId,actorId,reason])).rows[0];
    const result=await updateRecord(db,'oaooao_orders',orderId,{status:'paid',metadata:{...order.metadata,refundReservation:reservationView(released)}});
    await ctx.audit({actorId,action:'billing.order.cancel_external_refund',targetType:'order',targetId:orderId,metadata:{reservationId,reason,confirmExternalRefundNotSent:true}},db);
    return {order:view(result),reservation:reservationView(released)};
  });
}
export async function refundManualOrder(ctx: Context, orderId: string, actorId: string, reason: string, confirmExternalRefund = false,reservationId?:string) {
  if (!confirmExternalRefund) throw httpError(409,'Prepare a refund first, then send and verify the external refund and explicitly confirmExternalRefund=true; this service never transfers cash');
  if(!reservationId)throw httpError(409,'A prepared reservationId is required before confirming an external refund');
  return walletTransaction(ctx,undefined,async db => {
    const order = await lockRecord(db,'oaooao_orders',orderId);
    if (order.provider !== 'manual') throw httpError(503,'Provider refund protocol is unavailable; no refund has been sent');
    const reservation=(await db.query('SELECT * FROM oaooao_refund_reservations WHERE id=$1 AND order_id=$2 FOR UPDATE',[reservationId,orderId])).rows[0];
    if(!reservation)throw httpError(409,'Refund reservation does not match this order');
    if(order.status==='refunded'&&reservation.status==='confirmed')return view(order);
    if(order.status!=='refunding'||reservation.status!=='prepared')throw httpError(409,'Refund must have an active prepared reservation');
    await confirmedPayment(db,order);
    const holds=reservation.holds as RefundHold[];
    await db.query('SELECT id FROM oaooao_users WHERE id=ANY($1::text[]) ORDER BY id FOR NO KEY UPDATE',[[order.user_id,...holds.map(hold=>hold.userId)]]);
    await db.query('UPDATE oaooao_plan_grants SET revoked_at=now() WHERE order_id=$1',[order.id]);
    if (order.product_kind === 'plan') await syncDailyEntitlement(ctx,order.user_id,`order:${order.id}:daily-revoke`,db);
    const currentPlan = (await db.query('SELECT plan_id FROM oaooao_plan_grants WHERE user_id=$1 AND revoked_at IS NULL AND starts_at<=now() AND expires_at>now() ORDER BY starts_at DESC LIMIT 1',[order.user_id])).rows[0]?.plan_id;
    if (order.product_kind === 'plan') await db.query('UPDATE oaooao_users SET plan_id=$2,updated_at=now() WHERE id=$1',[order.user_id,currentPlan ?? null]);
    await revokeReferral(ctx,db,order.id,holds);
    const payment = await db.query("UPDATE oaooao_payments SET status='refunded',refunded_at=now(),confirmation=confirmation || $2::jsonb WHERE order_id=$1 AND status='succeeded' RETURNING id",[order.id,JSON.stringify({refund:{kind:'administrator_confirmed_external_refund',actorId,reason}})]);
    if (!payment.rowCount) throw httpError(409,'Confirmed original payment is missing; reconciliation required');
    const confirmed=(await db.query("UPDATE oaooao_refund_reservations SET status='confirmed',resolved_by=$2,resolved_at=now(),resolution_reason=$3 WHERE id=$1 RETURNING *",[reservationId,actorId,reason])).rows[0];
    const result = await updateRecord(db,'oaooao_orders',order.id,{status:'refunded',refunded_at:new Date(),metadata:{...order.metadata,refundReason:reason,refundReservation:reservationView(confirmed)}});
    await ctx.audit({actorId,action:'billing.order.confirm_external_refund',targetType:'order',targetId:order.id,metadata:{amountCents:Number(order.amount_cents),currency:order.currency,reason}},db);
    return view(result);
  });
}

const defaultReferral = { id:'default',enabled:false,inviterPoints:0,inviteeRewardType:'points',inviteePoints:0,minimumPaidCents:0,coolingOffDays:7,inviterMonthlyLimit:100,campaignTotalLimit:10000,autoFreezeRisk:false };
async function referralProgram(ctx: Context, db: PoolClient | Context['db'] = ctx.db): Promise<typeof defaultReferral> {
  return { ...defaultReferral, ...((await db.query("SELECT value FROM oaooao_settings WHERE id='referrals'")).rows[0]?.value ?? {}) };
}
export async function recordReferral(ctx: Context, inviteeUserId: string, referralCode: string, client?: PoolClient): Promise<void> {
  if (!referralCode) return;
  await walletTransaction(ctx,client,async db => {
    const program = await referralProgram(ctx,db);
    if (!program.enabled) throw httpError(409,'Referral program is disabled');
    const inviter = (await db.query('SELECT c.user_id FROM oaooao_referral_codes c JOIN oaooao_users u ON u.id=c.user_id WHERE c.code=$1 AND u.enabled',[referralCode])).rows[0];
    if (!inviter || inviter.user_id === inviteeUserId) throw httpError(400,'Invalid referral code');
    await db.query('INSERT INTO oaooao_referrals(id,inviter_user_id,invitee_user_id) VALUES($1,$2,$3) ON CONFLICT(invitee_user_id) DO NOTHING',[randomUUID(),inviter.user_id,inviteeUserId]);
  });
}
async function qualifyReferral(ctx: Context, db: PoolClient, order: Row) {
  const program = await referralProgram(ctx,db);
  if (!program.enabled || Number(order.amount_cents) < program.minimumPaidCents) return;
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('referral-qualification',0))");
  const relationship = (await db.query("SELECT * FROM oaooao_referrals WHERE invitee_user_id=$1 AND status='registered' FOR UPDATE",[order.user_id])).rows[0];
  if (!relationship) return;
  // Imported risk-screening settings must never silently bypass unavailable screening.
  if(program.autoFreezeRisk){await db.query("UPDATE oaooao_referrals SET status='frozen' WHERE id=$1",[relationship.id]);return;}
  const counts = (await db.query("SELECT count(*) FILTER(WHERE inviter_user_id=$1 AND qualified_at>=date_trunc('month',now())) AS monthly,count(*) AS campaign FROM oaooao_referrals WHERE qualified_at IS NOT NULL AND status<>'revoked'",[relationship.inviter_user_id])).rows[0]!;
  const limited = (program.inviterMonthlyLimit > 0 && Number(counts.monthly) >= program.inviterMonthlyLimit) || (program.campaignTotalLimit > 0 && Number(counts.campaign) >= program.campaignTotalLimit);
  if (limited) { await db.query("UPDATE oaooao_referrals SET status='frozen' WHERE id=$1",[relationship.id]); return; }
  await db.query("UPDATE oaooao_referrals SET status='qualified',qualifying_order_id=$2,qualified_at=now() WHERE id=$1",[relationship.id,order.id]);
  for (const [role,userId,amount] of [['inviter',relationship.inviter_user_id,program.inviterPoints],['invitee',relationship.invitee_user_id,program.inviteePoints]] as const) {
    if (creditUnits(amount) === 0n || (role === 'invitee' && program.inviteeRewardType === 'none')) continue;
    await db.query(`INSERT INTO oaooao_referral_rewards(id,relationship_id,user_id,role,points,due_at) VALUES($1,$2,$3,$4,$5,now()+make_interval(days=>$6)) ON CONFLICT(relationship_id,role) DO NOTHING`,[randomUUID(),relationship.id,userId,role,decimal(amount,'referral points'),program.coolingOffDays]);
  }
}
async function revokeReferral(ctx: Context, db: PoolClient, orderId: string, holds:RefundHold[]) {
  const relationship = (await db.query('SELECT * FROM oaooao_referrals WHERE qualifying_order_id=$1 FOR UPDATE',[orderId])).rows[0];
  if (!relationship) return;
  const rewards = (await db.query('SELECT * FROM oaooao_referral_rewards WHERE relationship_id=$1 ORDER BY user_id,id FOR UPDATE',[relationship.id])).rows;
  for (const reward of rewards) {
    if (reward.status === 'settled'&&creditUnits(reward.points)>0n&&!holds.some(hold=>hold.rewardId===reward.id&&hold.userId===reward.user_id&&creditUnits(hold.points)===creditUnits(reward.points)))throw httpError(409,'Referral reward reservation is inconsistent; reconciliation required');
    await db.query("UPDATE oaooao_referral_rewards SET status='revoked' WHERE id=$1",[reward.id]);
  }
  await db.query("UPDATE oaooao_referrals SET status='revoked' WHERE id=$1",[relationship.id]);
}
/** Durable rewards are claimed only after their paid order survives the cooling-off period. */
export async function settleReferralRewards(ctx: Context, limit = 100): Promise<number> {
  let settled = 0;
  if((await referralProgram(ctx)).autoFreezeRisk)return settled;
  const candidates = (await ctx.db.query("SELECT DISTINCT r.qualifying_order_id AS order_id FROM oaooao_referral_rewards w JOIN oaooao_referrals r ON r.id=w.relationship_id WHERE w.status='pending' AND w.due_at<=now() LIMIT $1",[Math.max(1,Math.min(100,limit))])).rows;
  for (const candidate of candidates) await walletTransaction(ctx,undefined,async db => {
    // Same order -> relationship -> wallet lock sequence as a refund.
    const order = await lockRecord(db,'oaooao_orders',candidate.order_id);
    const relation = (await db.query('SELECT * FROM oaooao_referrals WHERE qualifying_order_id=$1 FOR UPDATE',[order.id])).rows[0];
    if (!relation || !['qualified','settled'].includes(relation.status) || order.status !== 'paid') return;
    const rewards = (await db.query("SELECT * FROM oaooao_referral_rewards WHERE relationship_id=$1 AND status='pending' AND due_at<=now() ORDER BY user_id,id FOR UPDATE",[relation.id])).rows;
    if(rewards.length)await db.query('SELECT id FROM oaooao_users WHERE id=ANY($1::text[]) ORDER BY id FOR NO KEY UPDATE',[rewards.map(reward=>reward.user_id)]);
    for (const reward of rewards) {
      await adjustWallet(ctx,reward.user_id,`referral:${reward.id}:settle`,reward.points,{kind:'referral_reward',relationshipId:relation.id},db);
      await db.query("UPDATE oaooao_referral_rewards SET status='settled',settled_at=now() WHERE id=$1",[reward.id]); settled++;
    }
    if (!(await db.query("SELECT 1 FROM oaooao_referral_rewards WHERE relationship_id=$1 AND status='pending' LIMIT 1",[relation.id])).rowCount) await db.query("UPDATE oaooao_referrals SET status='settled' WHERE id=$1",[relation.id]);
  });
  return settled;
}
/** Call from a durable scheduler; each pending order is rechecked under its row lock. */
export async function runCommerceMaintenance(ctx: Context, limit=100): Promise<{expiredOrders:number;settledRewards:number}> {
  let expiredOrders=0;
  const expired=(await ctx.db.query("SELECT id FROM oaooao_orders WHERE status='pending' AND expires_at<=now() ORDER BY expires_at LIMIT $1",[Math.max(1,Math.min(100,limit))])).rows;
  for(const candidate of expired)await walletTransaction(ctx,undefined,async db=>{
    const order=await lockRecord(db,'oaooao_orders',candidate.id);
    if(order.status!=='pending' || order.expires_at.getTime()>Date.now())return;
    await updateRecord(db,'oaooao_orders',order.id,{status:'closed',closed_at:new Date(),metadata:{...order.metadata,closeReason:'Order expired before confirmed payment'}});
    await db.query('UPDATE oaooao_coupons SET reserved_order_id=NULL WHERE reserved_order_id=$1 AND redeemed_at IS NULL',[order.id]);expiredOrders++;
  });
  return {expiredOrders,settledRewards:await settleReferralRewards(ctx,limit)};
}
async function referralStats(ctx: Context, userId?: string) {
  const scope = userId ? ' WHERE inviter_user_id=$1' : '';
  const values = userId ? [userId] : [];
  const rows = (await ctx.db.query(`SELECT count(*) AS registrations,count(*) FILTER(WHERE qualified_at IS NOT NULL) AS qualified,count(*) FILTER(WHERE status='qualified') AS pending,count(*) FILTER(WHERE status='settled') AS settled,count(*) FILTER(WHERE status='revoked') AS revoked,count(*) FILTER(WHERE status='frozen') AS risky FROM oaooao_referrals${scope}`,values)).rows[0]!;
  const clicks = Number((await ctx.db.query(`SELECT coalesce(sum(clicks),0) AS clicks FROM oaooao_referral_codes${userId?' WHERE user_id=$1':''}`,values)).rows[0]!.clicks);
  return { clicks, ...Object.fromEntries(Object.entries(rows).map(([key,value]) => [key,Number(value)])) };
}
async function listReferrals(ctx: Context, query: Row, kind: 'relationships'|'rewards', userId?: string) {
  const page = pagination(query);
  const table = kind === 'relationships' ? 'oaooao_referrals' : 'oaooao_referral_rewards';
  const column = kind === 'relationships' ? 'inviter_user_id' : 'user_id';
  const scope = userId ? ` WHERE ${column}=$1` : '';
  const values = userId ? [userId] : [];
  const total = Number((await ctx.db.query(`SELECT count(*) FROM ${table}${scope}`,values)).rows[0]!.count);
  const items = (await ctx.db.query(`SELECT * FROM ${table}${scope} ORDER BY created_at DESC,id LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,page.pageSize,page.offset])).rows.map(row => ({...view(row),...(kind==='rewards'?{inviterUserId:row.role==='inviter'?row.user_id:undefined}: {})}));
  return {items,total,page:page.page,pageSize:page.pageSize};
}
function campaignInput(input: Row, previous?: Row) {
  const value = { ...(previous ? view(previous) : {}), ...input }; const window = dateWindow(value);
  if (!Array.isArray(value.products) || value.products.length > 500) throw httpError(400,'Invalid promotion products');
  const seen = new Set<string>();
  const products = value.products.map((item: unknown) => { const product = object(item); const productId = string(product.productId,'productId',200); if (seen.has(productId)) throw httpError(400,'Repeated promotion product'); seen.add(productId); return {productId,promotionalAmountCents:integer(product.promotionalAmountCents,'promotionalAmountCents')}; });
  return {name:string(value.name,'name',200),label:string(value.label ?? '','label',200,true),enabled:boolean(value.enabled ?? false,'enabled'),starts_at:window.starts,ends_at:window.ends,products};
}
function couponInput(input: Row, previous?: Row) {
  const value = { ...(previous ? view(previous) : {}), ...input }; const window = dateWindow(value);
  const type = value.discountType ?? 'fixed';
  if (!['fixed','percentage'].includes(type)) throw httpError(400,'Supported discountType values are fixed (cents) and percentage (1–100 percent off)');
  const productIds = value.productIds ?? [];
  if (!Array.isArray(productIds) || productIds.length > 500 || productIds.some(id => typeof id !== 'string' || !id || id.length > 200)) throw httpError(400,'Invalid productIds');
  const total = integer(value.totalQuantity ?? 0,'totalQuantity');
  if (total > 0 && total < Number(previous?.claimed_quantity ?? 0)) throw httpError(409,'Total quantity cannot be smaller than the quantity already granted');
  return {name:string(value.name,'name',200),discount_type:type,discount_value:integer(value.discountValue,'discountValue',1,type==='percentage'?100:1_000_000_000),min_amount_cents:integer(value.minAmountCents ?? 0,'minAmountCents'),max_discount_cents:integer(value.maxDiscountCents ?? 0,'maxDiscountCents'),total_quantity:total,per_user_limit:integer(value.perUserLimit ?? 1,'perUserLimit',1,10000),enabled:boolean(value.enabled ?? false,'enabled'),starts_at:window.starts,ends_at:window.ends,product_ids:[...new Set(productIds)]};
}
async function financeSummary(ctx: Context) {
  // Read a consistent financial snapshot even while settlements run.
  return walletTransaction(ctx,undefined,async db => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const raw = (await db.query(`SELECT count(*) AS total,count(*) FILTER(WHERE status='pending') AS pending,count(*) FILTER(WHERE status IN ('paid','refunding')) AS paid,count(*) FILTER(WHERE status='closed') AS closed,count(*) FILTER(WHERE status='canceled') AS canceled,count(*) FILTER(WHERE status='refunded') AS refunded,coalesce(sum(amount_cents),0) AS gross_amount_cents,coalesce(sum(amount_cents) FILTER(WHERE status IN ('paid','refunding')),0) AS paid_amount_cents,coalesce(sum(amount_cents) FILTER(WHERE status='pending'),0) AS pending_amount_cents,coalesce(sum(amount_cents) FILTER(WHERE status='refunded'),0) AS refunded_amount_cents FROM oaooao_orders`)).rows[0]!;
    const numbers = (row: Row) => Object.fromEntries(Object.entries(view(row)).map(([key,value])=>[key,Number(value)]));
    const orders = numbers(raw);
    const payments = numbers((await db.query(`SELECT count(*) FILTER(WHERE status='succeeded') AS succeeded,count(*) FILTER(WHERE status='refunded') AS refunded,coalesce(sum(amount_cents) FILTER(WHERE status='succeeded'),0) AS succeeded_amount_cents,coalesce(sum(amount_cents) FILTER(WHERE status='refunded'),0) AS refunded_amount_cents FROM oaooao_payments`)).rows[0]!);
    const commerce = numbers((await db.query(`SELECT count(*) FILTER(WHERE status IN ('paid','refunding','refunded')) AS converted_orders,count(*) FILTER(WHERE promotion_discount_cents>0) AS promotion_orders,count(*) FILTER(WHERE promotion_discount_cents>0 AND status IN ('paid','refunding','refunded')) AS promotion_converted_orders,coalesce(sum(promotion_discount_cents) FILTER(WHERE status IN ('paid','refunding')),0) AS promotion_discount_cents,count(*) FILTER(WHERE coupon_discount_cents>0) AS coupon_orders,count(*) FILTER(WHERE coupon_discount_cents>0 AND status IN ('paid','refunding','refunded')) AS coupon_converted_orders,coalesce(sum(coupon_discount_cents) FILTER(WHERE status IN ('paid','refunding')),0) AS coupon_discount_cents FROM oaooao_orders`)).rows[0]!);
    const providers = (await db.query(`SELECT provider,count(*) AS total_orders,count(*) FILTER(WHERE status='pending') AS pending_orders,count(*) FILTER(WHERE status IN ('paid','refunding')) AS paid_orders,count(*) FILTER(WHERE status='refunded') AS refunded_orders,coalesce(sum(amount_cents) FILTER(WHERE status IN ('paid','refunding')),0) AS paid_amount_cents,coalesce(sum(amount_cents) FILTER(WHERE status='refunded'),0) AS refunded_amount_cents FROM oaooao_orders GROUP BY provider ORDER BY provider`)).rows.map(row=>({...numbers({...row,provider:undefined}),provider:row.provider}));
    const reconciliation = numbers((await db.query(`SELECT (SELECT count(*) FROM oaooao_orders o WHERE o.status IN ('paid','refunding') AND NOT EXISTS(SELECT 1 FROM oaooao_payments p WHERE p.order_id=o.id AND p.status='succeeded')) AS paid_orders_without_succeeded_payment,(SELECT count(*) FROM oaooao_payments p JOIN oaooao_orders o ON o.id=p.order_id WHERE p.status='succeeded' AND o.status NOT IN ('paid','refunding')) AS succeeded_payments_without_paid_order,(SELECT count(*) FROM oaooao_payments p JOIN oaooao_orders o ON o.id=p.order_id WHERE p.amount_cents<>o.amount_cents OR p.currency<>o.currency) AS amount_mismatch_payments`)).rows[0]!);
    return {orders,payments,commerce,providers,reconciliation};
  });
}

export async function registerCommerce(app: FastifyInstance, ctx: Context): Promise<void> {
  app.get('/api/points',async request=>{
    const user=await ctx.requireUser(request);const query=(request.query ?? {}) as Row;const page=pagination(query);
    if(query.direction && !['credit','debit'].includes(query.direction))throw httpError(400,'Invalid ledger direction');
    await getWallet(ctx,user.id); // Settle due batches before exposing the corresponding expiry ledger.
    const filter=`user_id=$1 AND metadata->>'kind' IS DISTINCT FROM 'normalized_transfer' AND metadata->>'kind' IS DISTINCT FROM 'admin_plan_assignment'${query.direction==='credit'?' AND permanent_delta+daily_delta+timed_delta>=0':query.direction==='debit'?' AND permanent_delta+daily_delta+timed_delta<0':''}`;
    const total=Number((await ctx.db.query(`SELECT count(*) FROM oaooao_wallet_operations WHERE ${filter}`,[user.id])).rows[0]!.count);
    const records=(await ctx.db.query(`SELECT * FROM oaooao_wallet_operations WHERE ${filter} ORDER BY created_at DESC,operation_id LIMIT $2 OFFSET $3`,[user.id,page.pageSize,page.offset])).rows.map(row=>{
      const meta=row.metadata ?? {};const amount=Number(creditDecimal(creditUnits(row.permanent_delta)+creditUnits(row.daily_delta)+creditUnits(row.timed_delta)));
      const kind=meta.kind;const type=meta.type || (row.refund_of?'refund':kind==='generation'?'consume':kind==='order_purchase'?'recharge':kind==='order_refund'?'refund':['daily_expiration','timed_expiration'].includes(kind)?'expire':['daily_grant','referral_reward','check_in'].includes(kind)?'grant':'adjust');
      return {id:row.operation_id,type,kind,direction:amount<0?'debit':'credit',amount,permanentAmount:Number(row.permanent_delta),dailyAmount:Number(row.daily_delta),timedAmount:Number(row.timed_delta),balanceAfter:Number(creditDecimal(creditUnits(row.permanent_after)+creditUnits(row.daily_after)+creditUnits(row.timed_after))),permanentBalanceAfter:Number(row.permanent_after),dailyBalanceAfter:Number(row.daily_after),timedBalanceAfter:Number(row.timed_after),expiresAt:typeof meta.expiresAt==='string'?meta.expiresAt:null,expiredRefundPoints:meta.expiredRefundPoints===undefined?undefined:Number(meta.expiredRefundPoints),description:meta.description || meta.reason || kind || '',model:meta.model,idempotencyKey:meta.idempotencyKey || row.operation_id,sourceRecordId:meta.sourceRecordId || row.refund_of || undefined,sourceDate:meta.sourceDate,createdAt:timestamp(row.created_at)};
    });return {records,total,page:page.page,pageSize:page.pageSize};
  });
  app.get('/api/billing/products',async () => {
    const config = await settings(ctx); const payments = await paymentConfig(ctx);
    const policy=resolveCommercePolicy(config);const readiness = purchaseReadiness(config.site ?? {},policy ?? {});
    const products = await Promise.all((await ctx.db.query('SELECT * FROM oaooao_products WHERE enabled ORDER BY sort_order,id')).rows.map(async row=>({...view(row),pricing:await priceProduct(ctx.db,row)})));
    const available = payments.providers.filter(provider=>provider.ready).map(provider=>provider.id);
    return {products,paymentProviders:available,billing:{mode:config.operationMode==='commercial'?'commercial':'self_use',rechargeEnabled:config.operationMode==='commercial'&&readiness.ready&&available.length>0,purchaseReadiness:readiness},commercePolicy:policy};
  });
  app.get('/api/billing/orders',async request => orderList(ctx,request,(await ctx.requireUser(request)).id));
  app.post('/api/billing/orders',async request => ({order:await createOrder(ctx,(await ctx.requireUser(request)).id,object(request.body),typeof request.headers['idempotency-key']==='string'?request.headers['idempotency-key']:undefined)}));
  app.get('/api/billing/orders/:id',async request => {
    const user = await ctx.requireUser(request);
    const row = (await ctx.db.query('SELECT * FROM oaooao_orders WHERE id=$1 AND user_id=$2',[params(request).id,user.id])).rows[0];
    if (!row) throw httpError(404,'Order not found'); return {order:view(row)};
  });
  app.post('/api/billing/orders/:id/cancel',async request => { const user = await ctx.requireUser(request); return {order:await closeOrder(ctx,params(request).id,user.id,'canceled',string(object(request.body ?? {}).reason ?? '','reason',2000,true),user.id)}; });
  app.post('/api/billing/orders/:id/checkout',async request => {
    const user = await ctx.requireUser(request); const input = object(request.body ?? {});
    return walletTransaction(ctx,undefined,async db=>{
      const order = await lockRecord(db,'oaooao_orders',params(request).id);
      if (order.user_id !== user.id) throw httpError(404,'Order not found');
      if (order.status !== 'pending' || order.expires_at.getTime() <= Date.now()) throw httpError(409,'Order cannot be checked out');
      assertPlanAvailable(await settings(ctx,db),order);
      if (input.provider && input.provider !== order.provider) throw httpError(409,'Checkout provider must match the order');
      const instructions = await assertManualReady(ctx,db,order.provider);
      const checkout = {provider:'manual',orderId:order.id,orderNo:order.order_no,kind:'manual',instructions,expiresAt:timestamp(order.expires_at)};
      return {code:0,data:{checkout},checkout};
    });
  });
  app.get('/api/admin/billing/payment-config',async request=>{await ctx.requireUser(request,'billing.manage');return {paymentConfig:await paymentConfig(ctx)};});
  app.patch('/api/admin/billing/payment-config',async request=>{
    const actor = await ctx.requireUser(request,'billing.manage'); const input = object(request.body);
    const def = providerDefinitions.find(provider=>provider.id===input.providerId);
    if (!def) throw httpError(400,'Unknown payment provider');
    const enabled = boolean(input.enabled,'enabled'); const values = object(input.values ?? {});
    await walletTransaction(ctx,undefined,async db=>{
      await db.query('INSERT INTO oaooao_payment_configs(provider_id) VALUES($1) ON CONFLICT DO NOTHING',[def.id]);
      const previous = (await db.query('SELECT * FROM oaooao_payment_configs WHERE provider_id=$1 FOR UPDATE',[def.id])).rows[0]!;
      const publicValues = {...previous.public_values}; const secrets = previous.encrypted_secrets ? JSON.parse(ctx.decrypt(previous.encrypted_secrets)) : {};
      for (const [key,value] of Object.entries(values)) {
        const field = def.fields.find(field=>field.key===key); if (!field) throw httpError(400,`Unknown provider field: ${key}`);
        const text = string(value,key,16000,true);
        if (field.secret) { if (text) secrets[key]=text; } else publicValues[key]=text;
      }
      if (enabled && def.id==='manual' && !publicValues.instructions) throw httpError(400,'Manual settlement requires instructions');
      await db.query('UPDATE oaooao_payment_configs SET enabled=$2,public_values=$3,encrypted_secrets=$4,updated_at=now() WHERE provider_id=$1',[def.id,enabled,publicValues,Object.keys(secrets).length?ctx.encrypt(JSON.stringify(secrets)):null]);
      await ctx.audit({actorId:actor.id,action:'billing.provider.update',targetType:'payment_provider',targetId:def.id,metadata:{enabled,changedFields:Object.keys(values)}},db);
    });
    return {paymentConfig:await paymentConfig(ctx)};
  });
  app.get('/api/admin/billing/products',async request=>{await ctx.requireUser(request,'commerce.manage');const enabled=(request.query as Row)?.enabled==='1';return {products:(await ctx.db.query(`SELECT * FROM oaooao_products${enabled?' WHERE enabled':''} ORDER BY sort_order,id`)).rows.map(view)};});
  for (const method of ['POST','PATCH'] as const) app.route({method,url:method==='POST'?'/api/admin/billing/products':'/api/admin/billing/products/:id',handler:async request=>{
    const actor=await ctx.requireUser(request,'commerce.manage');const input=object(request.body);
    return walletTransaction(ctx,undefined,async db=>{
      const previous=method==='PATCH'?await lockRecord(db,'oaooao_products',params(request).id,input.expectedUpdatedAt):undefined;
      const value=productInput(input,previous);
      if(value.enabled)assertPlanAvailable(await settings(ctx,db),value);
      const product=previous?await updateRecord(db,'oaooao_products',previous.id,value):await insertRecord(db,'oaooao_products',{id:randomUUID(),...value});
      await ctx.audit({actorId:actor.id,action:`billing.product.${method==='POST'?'create':'update'}`,targetType:'product',targetId:product.id},db);
      return {product:view(product)};
    });
  }});
  app.get('/api/admin/billing/orders',async request=>{await ctx.requireUser(request,'billing.read');return orderList(ctx,request);});
  app.get('/api/admin/billing/summary',async request=>{await ctx.requireUser(request,'billing.read');return {summary:await financeSummary(ctx)};});
  app.post('/api/admin/billing/orders/:id/close',async request=>{const actor=await ctx.requireUser(request,'billing.manage');return {order:await closeOrder(ctx,params(request).id,actor.id,'closed',string(object(request.body ?? {}).reason ?? '','reason',2000,true))};});
  app.post('/api/admin/billing/orders/:id/complete',async request=>{const actor=await ctx.requireUser(request,'billing.manage');return {order:await completeManualOrder(ctx,params(request).id,actor.id,string(object(request.body ?? {}).reason ?? 'Administrator confirmed external receipt','reason',2000))};});
  app.post('/api/admin/billing/orders/:id/refund/prepare',async request=>{const actor=await ctx.requireUser(request,'billing.manage');const input=object(request.body);return prepareManualRefund(ctx,params(request).id,actor.id,string(input.reason,'reason',2000));});
  app.post('/api/admin/billing/orders/:id/refund/cancel',async request=>{const actor=await ctx.requireUser(request,'billing.manage');const input=object(request.body);return cancelManualRefund(ctx,params(request).id,actor.id,string(input.reason,'reason',2000),string(input.reservationId,'reservationId',200),input.confirmExternalRefundNotSent===true);});
  app.post('/api/admin/billing/orders/:id/refund',async request=>{const actor=await ctx.requireUser(request,'billing.manage');const input=object(request.body);return {order:await refundManualOrder(ctx,params(request).id,actor.id,string(input.reason,'reason',2000),input.confirmExternalRefund===true,input.reservationId===undefined?undefined:string(input.reservationId,'reservationId',200))};});
  app.get('/api/admin/billing/promotions',async request=>{await ctx.requireUser(request,'commerce.manage');return {code:0,data:{campaigns:(await ctx.db.query('SELECT * FROM oaooao_promotions ORDER BY created_at DESC,id')).rows.map(view)}};});
  for (const method of ['POST','PATCH'] as const) app.route({method,url:method==='POST'?'/api/admin/billing/promotions':'/api/admin/billing/promotions/:id',handler:async request=>{
    const actor=await ctx.requireUser(request,'commerce.manage');const input=object(request.body);
    return walletTransaction(ctx,undefined,async db=>{
      const previous=method==='PATCH'?await lockRecord(db,'oaooao_promotions',params(request).id,input.expectedUpdatedAt):undefined;
      const value=campaignInput(input,previous);
      for (const product of value.products) {
        const existing=(await db.query('SELECT amount_cents FROM oaooao_products WHERE id=$1',[product.productId])).rows[0];
        if (!existing || product.promotionalAmountCents>Number(existing.amount_cents)) throw httpError(400,'Promotion products must exist and promotional prices cannot exceed list prices');
      }
      const campaign=previous?await updateRecord(db,'oaooao_promotions',previous.id,value):await insertRecord(db,'oaooao_promotions',{id:randomUUID(),...value});
      await ctx.audit({actorId:actor.id,action:'billing.promotion.save',targetType:'promotion',targetId:campaign.id},db);
      return {code:0,data:{campaign:view(campaign)}};
    });
  }});
  app.delete('/api/admin/billing/promotions/:id',async request=>{const actor=await ctx.requireUser(request,'commerce.manage');return walletTransaction(ctx,undefined,async db=>{const campaign=await lockRecord(db,'oaooao_promotions',params(request).id);await db.query('DELETE FROM oaooao_promotions WHERE id=$1',[campaign.id]);await ctx.audit({actorId:actor.id,action:'billing.promotion.delete',targetType:'promotion',targetId:campaign.id},db);return {code:0,data:{campaign:view(campaign)}};});});
  app.get('/api/admin/billing/coupon-templates',async request=>{await ctx.requireUser(request,'commerce.manage');return {code:0,data:{templates:(await ctx.db.query('SELECT * FROM oaooao_coupon_templates ORDER BY created_at DESC,id')).rows.map(view)}};});
  for (const method of ['POST','PATCH'] as const) app.route({method,url:method==='POST'?'/api/admin/billing/coupon-templates':'/api/admin/billing/coupon-templates/:id',handler:async request=>{
    const actor=await ctx.requireUser(request,'commerce.manage');const input=object(request.body);
    return walletTransaction(ctx,undefined,async db=>{
      const previous=method==='PATCH'?await lockRecord(db,'oaooao_coupon_templates',params(request).id,input.expectedUpdatedAt):undefined;const value=couponInput(input,previous);
      if (value.product_ids.length && (await db.query('SELECT id FROM oaooao_products WHERE id=ANY($1::text[])',[value.product_ids])).rowCount!==value.product_ids.length) throw httpError(400,'Coupon product does not exist');
      const template=previous?await updateRecord(db,'oaooao_coupon_templates',previous.id,value):await insertRecord(db,'oaooao_coupon_templates',{id:randomUUID(),...value});
      await ctx.audit({actorId:actor.id,action:'billing.coupon_template.save',targetType:'coupon_template',targetId:template.id},db);return {code:0,data:{template:view(template)}};
    });
  }});
  app.post('/api/admin/billing/coupons/grant',async request=>{
    const actor=await ctx.requireUser(request,'commerce.manage');const input=object(request.body);const quantity=integer(input.quantity ?? 1,'quantity',1,100);
    return walletTransaction(ctx,undefined,async db=>{
      const template=await lockRecord(db,'oaooao_coupon_templates',string(input.templateId,'templateId',200));
      if (!template.enabled || (template.ends_at && template.ends_at<=new Date())) throw httpError(409,'Coupon template is unavailable');
      const user=(await db.query(`SELECT id FROM oaooao_users WHERE ${input.userId?'id=$1':'lower(username)=lower($1)'} AND enabled`,[string(input.userId || input.username,'user',200)])).rows[0];if (!user) throw httpError(404,'User not found');
      const count=Number((await db.query('SELECT count(*) FROM oaooao_coupons WHERE template_id=$1 AND user_id=$2',[template.id,user.id])).rows[0]!.count);
      if (count+quantity>template.per_user_limit || (template.total_quantity>0 && template.claimed_quantity+quantity>template.total_quantity)) throw httpError(409,'Coupon grant limit reached');
      const coupons=[];for(let n=0;n<quantity;n++) coupons.push(view(await insertRecord(db,'oaooao_coupons',{id:randomUUID(),template_id:template.id,user_id:user.id})));
      await db.query('UPDATE oaooao_coupon_templates SET claimed_quantity=claimed_quantity+$2,updated_at=now() WHERE id=$1',[template.id,quantity]);
      await ctx.audit({actorId:actor.id,action:'billing.coupon.grant',targetType:'user',targetId:user.id,metadata:{templateId:template.id,quantity}},db);return {code:0,data:{coupons}};
    });
  });
  app.get('/api/billing/coupons',async request=>{const user=await ctx.requireUser(request);return {coupons:(await ctx.db.query('SELECT c.*,t.name,t.discount_type,t.discount_value,t.min_amount_cents,t.max_discount_cents,t.ends_at FROM oaooao_coupons c JOIN oaooao_coupon_templates t ON t.id=c.template_id WHERE c.user_id=$1 ORDER BY c.created_at DESC,c.id',[user.id])).rows.map(view)};});
  app.get('/api/referrals',async request=>{
    const user=await ctx.requireUser(request);const query=(request.query ?? {}) as Row;
    await settleReferralRewards(ctx,20);
    await ctx.db.query('INSERT INTO oaooao_referral_codes(user_id,code) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING',[user.id,randomBytes(12).toString('base64url')]);
    const code=(await ctx.db.query('SELECT code FROM oaooao_referral_codes WHERE user_id=$1',[user.id])).rows[0]!.code;
    const referrals=await listReferrals(ctx,{page:query.referralsPage,pageSize:query.pageSize},'relationships',user.id);
    const rewards=await listReferrals(ctx,{page:query.rewardsPage,pageSize:query.pageSize},'rewards',user.id);
    return {code:0,data:{program:await referralProgram(ctx),code,link:`${ctx.config.origin}/register?ref=${encodeURIComponent(code)}`,stats:await referralStats(ctx,user.id),referrals:referrals.items,referralsTotal:referrals.total,rewards:rewards.items,rewardsTotal:rewards.total}};
  });
  app.get('/api/admin/referrals',async request=>{await ctx.requireUser(request,'commerce.manage');return {code:0,data:{program:await referralProgram(ctx),stats:await referralStats(ctx)}};});
  app.patch('/api/admin/referrals',async request=>{
    const actor=await ctx.requireUser(request,'commerce.manage');const input=object(request.body);
    const result=await walletTransaction(ctx,undefined,async db=>{
      await db.query("INSERT INTO oaooao_settings(id,value) VALUES('referrals',$1) ON CONFLICT DO NOTHING",[defaultReferral]);
      const previous=(await db.query("SELECT value FROM oaooao_settings WHERE id='referrals' FOR UPDATE")).rows[0]!.value;
      const value={...defaultReferral,...previous,...input};
      if (!['points','none'].includes(value.inviteeRewardType)) throw httpError(400,'Only points or none invitee rewards are supported');
      if (value.autoFreezeRisk===true) throw httpError(503,'Automatic fraud scoring is not configured; review and freeze rewards manually');
      const program={id:'default',enabled:boolean(value.enabled,'enabled'),inviterPoints:Number(decimal(value.inviterPoints,'inviterPoints')),inviteeRewardType:value.inviteeRewardType,inviteePoints:Number(decimal(value.inviteePoints,'inviteePoints')),minimumPaidCents:integer(value.minimumPaidCents,'minimumPaidCents'),coolingOffDays:integer(value.coolingOffDays,'coolingOffDays',0,365),inviterMonthlyLimit:integer(value.inviterMonthlyLimit,'inviterMonthlyLimit'),campaignTotalLimit:integer(value.campaignTotalLimit,'campaignTotalLimit'),autoFreezeRisk:false};
      await db.query("UPDATE oaooao_settings SET value=$1,updated_at=now() WHERE id='referrals'",[program]);
      await ctx.audit({actorId:actor.id,action:'referrals.program.update',targetType:'referral_program',targetId:'default'},db);return program;
    });return {code:0,data:{program:result}};
  });
  for (const kind of ['relationships','rewards'] as const) app.get(`/api/admin/referrals/${kind}`,async request=>{await ctx.requireUser(request,'commerce.manage');return {code:0,data:await listReferrals(ctx,(request.query ?? {}) as Row,kind)};});
}
