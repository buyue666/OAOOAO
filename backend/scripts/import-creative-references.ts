/** Operator-only importer. Never downloads code or accepts a manifest from users. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import pg from 'pg';
import { loadConfig } from '../src/app.js';
import { createContext } from '../src/core.js';
import { storageConfig, putObject, assertStorageConfigured, type ObjectLocation } from '../src/object-storage.js';
import { sniffMedia, MAX_MEDIA_BYTES } from '../src/media.js';
import { creativeReferenceId } from '../src/creative-reference-store.js';

const args=process.argv.slice(2), manifestFile=args[0], mediaRoot=args[1], checkpoint=args[2];
if(!manifestFile||!mediaRoot||!checkpoint)throw new Error('Usage: import-creative-references manifest.json media-root checkpoint.json [--stage-only]');
const stageOnly=args.includes('--stage-only');
const config=loadConfig(),db=new pg.Pool({connectionString:config.databaseUrl,max:4}),ctx=createContext(db,config);
try {
  const storage=await storageConfig(ctx);assertStorageConfigured(storage);
  if(!storage.enabled||storage.provider==='vercel-blob')throw new Error('An enabled S3-compatible catalog store is required');
  const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
  if(manifest.version!==1||!Array.isArray(manifest.items)||manifest.items.length>10000)throw new Error('Invalid catalog manifest');
  const base=resolve(mediaRoot),seen=new Set<string>();
  for(const item of manifest.items){
    if(!creativeReferenceId.test(item.id)||seen.has(item.id)||!['person','garment','pose'].includes(item.role)||!creativeReferenceId.test(item.groupId)||typeof item.title!=='string'||item.title.length>250)throw new Error('Invalid catalog entry');
    seen.add(item.id);
    for(const part of ['image','thumbnail'])if(typeof item[part]!=='string'||!resolve(base,item[part]).startsWith(base+sep))throw new Error('Catalog file is outside media-root');
  }
  let staged:Record<string,any>={};
  try{staged=JSON.parse(await readFile(checkpoint,'utf8'));}catch{}
  let completed=0;
  for(let offset=0;offset<manifest.items.length;offset+=16){
    await Promise.all(manifest.items.slice(offset,offset+16).map(async(item:any)=>{
      const bytes=await readFile(resolve(base,item.image)),thumbnail=await readFile(resolve(base,item.thumbnail));
      const hash=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
      const sha256=hash(bytes),thumbnailSha256=hash(thumbnail);
      const known=staged[item.id];
      if(known?.sha256===sha256&&known?.thumbnailSha256===thumbnailSha256){completed++;return;}
      const mime=sniffMedia(bytes),thumbMime=sniffMedia(thumbnail);
      if(!mime.startsWith('image/')||!thumbMime.startsWith('image/')||bytes.length>MAX_MEDIA_BYTES||thumbnail.length>MAX_MEDIA_BYTES)throw new Error('Invalid catalog image: '+item.id);
      const location=(part:string,digest:string):ObjectLocation=>({endpoint:storage.endpoint,region:storage.region,bucket:storage.bucket,forcePathStyle:storage.forcePathStyle,key:[storage.prefix.replace(/^\/+|\/+$/g,''),'_catalog',item.id,part+'-'+digest.slice(0,24)].filter(Boolean).join('/')});
      const imageLocation=location('image',sha256),thumbLocation=sha256===thumbnailSha256?imageLocation:location('thumbnail',thumbnailSha256);
      await putObject(ctx,storage,imageLocation,bytes,mime);
      if(sha256!==thumbnailSha256)await putObject(ctx,storage,thumbLocation,thumbnail,thumbMime);
      staged[item.id]={...item,storageLocation:imageLocation,thumbnailLocation:thumbLocation,mimeType:mime,thumbnailMimeType:thumbMime,bytes:bytes.length,sha256,thumbnailSha256};completed++;
    }));
    if(offset%100===0||completed===manifest.items.length){await writeFile(checkpoint+'.tmp',JSON.stringify(staged));await rename(checkpoint+'.tmp',checkpoint);console.log(JSON.stringify({uploaded:completed,total:manifest.items.length}));}
  }
  if(!stageOnly){
    for(const item of manifest.items){const row=staged[item.id];await db.query(`INSERT INTO oaooao_creative_references(id,role,group_id,title,category,style,angle,tags,metadata,storage_location,thumbnail_location,mime_type,thumbnail_mime_type,byte_count,sha256,thumbnail_sha256)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT(id) DO UPDATE SET role=excluded.role,group_id=excluded.group_id,title=excluded.title,category=excluded.category,style=excluded.style,angle=excluded.angle,tags=excluded.tags,metadata=excluded.metadata,storage_location=excluded.storage_location,thumbnail_location=excluded.thumbnail_location,mime_type=excluded.mime_type,thumbnail_mime_type=excluded.thumbnail_mime_type,byte_count=excluded.byte_count,sha256=excluded.sha256,thumbnail_sha256=excluded.thumbnail_sha256,updated_at=now()`,[row.id,row.role,row.groupId,row.title,row.category||'',row.style||'',row.angle||'',JSON.stringify(row.tags||[]),row.metadata||{},row.storageLocation,row.thumbnailLocation,row.mimeType,row.thumbnailMimeType,row.bytes,row.sha256,row.thumbnailSha256]);}
  }
  console.log(JSON.stringify({stageOnly,completed,published:stageOnly?0:completed}));
}finally{await db.end();}
