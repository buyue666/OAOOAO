import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, HeadBucketCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PoolClient } from 'pg';
import { httpError, safeFetch, type Context } from './core.js';

export type StorageConfig = { enabled: boolean; provider?: string; endpoint: string; region: string; bucket: string; prefix: string; forcePathStyle: boolean; accessKeyId?: string; secretAccessKey?: string };
export type ObjectLocation = { endpoint: string; region: string; bucket: string; key: string; forcePathStyle: boolean };
export async function storageConfig(ctx: Context, client?:PoolClient): Promise<StorageConfig> {
  return { enabled:false, endpoint:'', region:'us-east-1', bucket:'', prefix:'oaooao', forcePathStyle:true,
    ...(await (client||ctx.db).query("SELECT value FROM oaooao_settings WHERE id='object-storage'"+(client?' FOR SHARE':''))).rows[0]?.value };
}
export function objectLocation(config: StorageConfig, userId: string, id: string): ObjectLocation {
  return { endpoint:config.endpoint, region:config.region, bucket:config.bucket, forcePathStyle:config.forcePathStyle,
    key:[config.prefix.replace(/^\/+|\/+$/g,''), encodeURIComponent(userId), id].filter(Boolean).join('/') };
}
export function assertStorageConfigured(config:StorageConfig) {
  if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey)
    throw httpError(503, '对象存储配置不完整，请联系管理员');
}
function clientFor(ctx: Context, config: StorageConfig, location?: ObjectLocation) {
  assertStorageConfigured(config);
  if (location && (location.endpoint !== config.endpoint || location.bucket !== config.bucket))
    throw httpError(503, '素材所在存储与当前配置不一致，请联系管理员迁移');
  const selected = location || config;
  return new S3Client({ endpoint:selected.endpoint, region:selected.region, forcePathStyle:selected.forcePathStyle,
    credentials:{accessKeyId:ctx.decrypt(config.accessKeyId!),secretAccessKey:ctx.decrypt(config.secretAccessKey!)}, maxAttempts:2,
    requestChecksumCalculation:'WHEN_REQUIRED', responseChecksumValidation:'WHEN_REQUIRED',
    requestHandler:{async handle(req: any) {
      const url = new URL(`${req.protocol}//${req.hostname}${req.port ? ':'+req.port : ''}${req.path}`);
      for (const [key,value] of Object.entries(req.query || {})) for (const v of Array.isArray(value)?value:[value]) url.searchParams.append(key,String(v));
      const response = await safeFetch(url,{method:req.method,headers:req.headers,body:req.body,timeoutMs:45000,maxBytes:201*1024*1024});
      return {response:{statusCode:response.status,headers:Object.fromEntries(response.headers),body:Readable.from(Buffer.from(await response.arrayBuffer()))}};
    }} });
}
export async function objectOperation<T>(ctx: Context, config: StorageConfig, location: ObjectLocation | undefined, work: (client: S3Client) => Promise<T>): Promise<T> {
  const client = clientFor(ctx,config,location);
  try { return await work(client); }
  catch (err) { if ((err as any).statusCode===503) throw err; throw httpError(502,'对象存储操作失败，请稍后重试或联系管理员','unavailable'); }
  finally { client.destroy(); }
}
export async function putObject(ctx: Context, config: StorageConfig, location: ObjectLocation, bytes: Buffer, mimeType: string) {
  return objectOperation(ctx,config,location,c=>c.send(new PutObjectCommand({Bucket:location.bucket,Key:location.key,Body:bytes,ContentType:mimeType})));
}
export async function getObject(ctx: Context, location: ObjectLocation) {
  return objectOperation(ctx,await storageConfig(ctx),location,async c=>{
    const result=await c.send(new GetObjectCommand({Bucket:location.bucket,Key:location.key}));
    if(!result.Body)throw httpError(502,'对象存储未返回素材');
    return Buffer.from(await result.Body.transformToByteArray());
  });
}
export async function headObject(ctx: Context, location: ObjectLocation) {
  return objectOperation(ctx,await storageConfig(ctx),location,c=>c.send(new HeadObjectCommand({Bucket:location.bucket,Key:location.key})));
}
export async function deleteObject(ctx: Context, location: ObjectLocation) {
  return objectOperation(ctx,await storageConfig(ctx),location,c=>c.send(new DeleteObjectCommand({Bucket:location.bucket,Key:location.key})));
}
export async function downloadObjectUrl(ctx: Context, location: ObjectLocation, lifetime=300) {
  return objectOperation(ctx,await storageConfig(ctx),location,c=>getSignedUrl(c,new GetObjectCommand({Bucket:location.bucket,Key:location.key}),{expiresIn:lifetime}));
}
export async function verifyStorage(ctx: Context, config: StorageConfig) {
  const location=objectLocation(config,'connection-check',randomUUID()),bytes=Buffer.from('OAOOAO storage verification');
  return objectOperation(ctx,config,location,async c=>{
    await c.send(new HeadBucketCommand({Bucket:location.bucket}));
    let uploaded=false;
    try {
      await c.send(new PutObjectCommand({Bucket:location.bucket,Key:location.key,Body:bytes,ContentType:'text/plain'}));uploaded=true;
      const read=await c.send(new GetObjectCommand({Bucket:location.bucket,Key:location.key}));
      if(!read.Body || !Buffer.from(await read.Body.transformToByteArray()).equals(bytes))throw Error('Storage content mismatch');
    } finally { if(uploaded)await c.send(new DeleteObjectCommand({Bucket:location.bucket,Key:location.key})); }
    try { await c.send(new HeadObjectCommand({Bucket:location.bucket,Key:location.key})); }
    catch(error) { if((error as any).$metadata?.httpStatusCode===404)return {ok:true,bucketAccessible:true,writeVerified:true,readVerified:true,deleteVerified:true};throw error; }
    throw Error('Storage deletion was not confirmed');
  });
}
