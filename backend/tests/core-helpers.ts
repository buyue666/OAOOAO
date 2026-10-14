import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import type { AppConfig } from '../src/core.js';
import { migrate } from '../src/migrate.js';

export async function testDatabaseUrl():Promise<string|undefined>{
  if(process.env.TEST_DATABASE_URL)return process.env.TEST_DATABASE_URL;
  try{return JSON.parse(await readFile(new URL('../.private/test-db.json',import.meta.url),'utf8')).databaseUrl;}catch{return undefined;}
}
export async function createTestDatabase(){
  const url=await testDatabaseUrl();if(!url)throw new Error('TEST_DATABASE_URL or isolated .private/test-db.json fixture is required');
  const schema=`test_${randomUUID().replaceAll('-','')}`;
  if(!/^test_[a-f0-9]{32}$/.test(schema))throw new Error('Unsafe test schema identifier');
  const admin=new pg.Pool({connectionString:url,max:2});await admin.query(`CREATE SCHEMA "${schema}"`);
  const db=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`,max:10});
  const mediaRoot=await mkdtemp(join(tmpdir(),'oaooao-test-'));
  const config:AppConfig={databaseUrl:url,origin:'http://localhost:3000',allowedOrigins:['http://localhost:3000'],production:false,sessionCookieName:'oaooao_session',sessionTtlSeconds:3600,encryptionKey:randomBytes(32).toString('base64'),mediaRoot,host:'127.0.0.1',port:3001,workerEnabled:false};
  const cleanup=async()=>{await db.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();if(!resolve(mediaRoot).startsWith(resolve(tmpdir()))||!mediaRoot.includes('oaooao-test-'))throw new Error('Unsafe fixture directory');await rm(mediaRoot,{recursive:true,force:true});};
  try{await migrate(db);}catch(error){await cleanup();throw error;}
  return {db,config,schema,cleanup};
}
