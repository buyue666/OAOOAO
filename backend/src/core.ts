import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import type { FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';

export const ADMIN_PERMISSIONS = ['analytics.read','users.read','users.manage','administrators.manage','generation.read','generation.manage','upstream.manage','commerce.manage','billing.read','billing.manage','system.manage','content.manage','audit.read'] as const;
export interface AppConfig {
  databaseUrl: string; origin: string; allowedOrigins: string[]; production: boolean;
  sessionCookieName: string; sessionTtlSeconds: number; encryptionKey: string;
  mediaRoot: string; host: string; port: number; workerEnabled: boolean;
  trustedProxies?: string[];
}
export interface AppUser {
  id: string; username: string; email: string | null; displayName: string;
  role: string; adminPermissions: string[]; enabled: boolean;
  bio?: string; avatarUrl?: string; emailVerified?: boolean; planId?: string;
  createdAt?: string; updatedAt?: string; lastLoginAt?: string;
}
export interface AuditRecord {
  actorId?: string; action: string; targetType?: string; targetId?: string;
  metadata?: unknown; status?: string;
}
export interface Context {
  db: Pool; config: AppConfig;
  requireUser(request: FastifyRequest, permission?: string): Promise<AppUser>;
  audit(record: AuditRecord, client?: PoolClient): Promise<void>;
  encrypt(plaintext: string): string; decrypt(ciphertext: string): string;
}
export function httpError(statusCode: number, message: string, outcome?: string) {
  return Object.assign(new Error(message), { statusCode, outcome, expose: true });
}
export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'Expected a JSON object');
  return value as Record<string, any>;
}
export function string(value: unknown, name: string, max = 200, optional = false): string {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) throw httpError(400, `Invalid ${name}`);
  return value.trim();
}
export function pagination(query: unknown) {
  const q = (query || {}) as Record<string, unknown>;
  const page = Math.max(1, Math.min(100000, Number(q.page) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(q.pageSize) || 20));
  if (!Number.isInteger(page) || !Number.isInteger(pageSize)) throw httpError(400, 'Invalid pagination');
  return { page, pageSize, offset: (page - 1) * pageSize };
}
export function iso(value: unknown): string | undefined {
  return value ? new Date(value as string).toISOString() : undefined;
}
export function userFromRow(row: Record<string, any>): AppUser {
  return {id: row.id, username: row.username, email: row.email, displayName: row.display_name,
    role: row.role, adminPermissions: row.admin_permissions || [], enabled: row.enabled,
    bio: row.bio, avatarUrl: row.avatar_url, emailVerified: row.email_verified, planId: row.plan_id,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), lastLoginAt: iso(row.last_login_at)};
}
export async function transaction<T>(db: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
export function codeHash(ctx: Context, value: string) { return createHmac('sha256', Buffer.from(ctx.config.encryptionKey,'base64')).update(value).digest('hex'); }
export function hasPermission(user: AppUser, permission: string): boolean {
  return user.enabled && user.role === 'admin' && user.adminPermissions.includes(permission);
}
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,/password|secret|token|api.?key|authorization|cookie|credential|access.?key/i.test(key) ? '[redacted]' : redact(item)]));
  return value;
}
export function createContext(db: Pool, config: AppConfig): Context {
  const key = Buffer.from(config.encryptionKey, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  const ctx: Context = {
    db, config,
    async requireUser(request, permission) {
      const token = request.cookies?.[config.sessionCookieName];
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw httpError(401, 'Authentication required');
      const { rows } = await db.query('SELECT u.* FROM oaooao_sessions s JOIN oaooao_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.enabled=true',[hashToken(token)]);
      if (!rows[0]) throw httpError(401, 'Session expired');
      const user = userFromRow(rows[0]);
      if (permission && !hasPermission(user,permission)) throw httpError(403, 'Permission denied');
      return user;
    },
    async audit(record, client) {
      await (client || db).query('INSERT INTO oaooao_audit_logs(id,actor_id,action,target_type,target_id,status,metadata) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[randomUUID(),record.actorId || null,record.action,record.targetType || null,record.targetId || null,record.status || 'success',JSON.stringify(redact(record.metadata || {}))]);
    },
    encrypt(plaintext) {
      if (!plaintext) return '';
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm',key,iv);
      const payload = Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);
      return `enc:v1:${Buffer.concat([iv,cipher.getAuthTag(),payload]).toString('base64')}`;
    },
    decrypt(ciphertext) {
      if (!ciphertext) return '';
      if (!ciphertext.startsWith('enc:v1:')) throw httpError(503, 'Stored integration secret has invalid encoding');
      try {
        const data = Buffer.from(ciphertext.slice(7),'base64');
        const decipher = createDecipheriv('aes-256-gcm',key,data.subarray(0,12)); decipher.setAuthTag(data.subarray(12,28));
        return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8');
      } catch { throw httpError(503, 'Stored integration secret cannot be decrypted'); }
    }
  };
  return ctx;
}
export async function rateLimit(ctx: Context, key: string, limit: number, seconds: number) {
  const {rows} = await ctx.db.query(`INSERT INTO oaooao_rate_limits(key,count,expires_at) VALUES($1,1,now()+make_interval(secs=>$2))
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN oaooao_rate_limits.expires_at<now() THEN 1 ELSE oaooao_rate_limits.count+1 END,
    expires_at=CASE WHEN oaooao_rate_limits.expires_at<now() THEN now()+make_interval(secs=>$2) ELSE oaooao_rate_limits.expires_at END RETURNING count`,[hashToken(key),seconds]);
  if (rows[0].count > limit) throw httpError(429, 'Too many requests; try again later');
}
export function isPublicAddress(address: string): boolean {
  try { const parsed = ipaddr.process(address); return parsed.range() === 'unicast'; } catch { return false; }
}
export async function publicAddress(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g,'');
  const records = isIP(host) ? [{address:host,family:isIP(host)}] : await lookup(host,{all:true,verbatim:true});
  if (!records.length || records.some(record => !isPublicAddress(record.address))) throw httpError(400,'Private or reserved network destinations are prohibited');
  return records[0];
}
export async function safeFetch(input: string | URL, init: {method?: string;headers?: Record<string,string>;body?: string | Buffer;timeoutMs?: number;maxBytes?: number} = {}): Promise<Response> {
  let url: URL;
  try { url = new URL(input); } catch { throw httpError(400,'Invalid upstream URL'); }
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw httpError(400,'Invalid upstream URL');
  const address = await publicAddress(url.hostname);
  return new Promise((resolve,reject) => {
    const request = (url.protocol==='https:' ? httpsRequest : httpRequest)(url,{
      method:init.method || 'GET',headers:init.headers,
      lookup:((_hostname: unknown, options: any, callback: any) => options?.all ? callback(null,[address]) : callback(null,address.address,address.family)) as any,
    },response => {
      const status = response.statusCode || 502;
      if (status>=300 && status<400) { response.resume(); reject(httpError(502,'Upstream redirects are not allowed')); return; }
      const chunks: Buffer[]=[]; let length=0;
      response.on('data',(chunk:Buffer) => {length+=chunk.length;if(length>(init.maxBytes || 10*1024*1024)){request.destroy();reject(httpError(502,'Upstream response too large'));}else chunks.push(chunk);});
      response.on('end',() => { const headers=new Headers(); for(const [name,value] of Object.entries(response.headers)) if(value) headers.set(name,Array.isArray(value)?value.join(','):value); resolve(new Response(status===204 || status===304 ? null : Buffer.concat(chunks),{status,headers})); });
      response.on('error',() => reject(httpError(502,'Upstream response interrupted','unavailable')));
    });
    request.setTimeout(init.timeoutMs || 30000,() => {request.destroy();reject(httpError(504,'Upstream request timed out','unavailable'));});
    request.on('error',() => reject(httpError(502,'Upstream connection failed','unavailable')));
    if(init.body) request.write(init.body);request.end();
  });
}
