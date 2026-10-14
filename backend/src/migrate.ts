import { access, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import pg, {type Pool} from 'pg';
import { transaction } from './core.js';
export async function readMigrations(){
  let directory=fileURLToPath(new URL('../migrations/',import.meta.url));
  try{await access(directory);}catch{directory=fileURLToPath(new URL('../../migrations/',import.meta.url));}
  const files=(await readdir(directory)).filter(f=>/^\d+-.+\.sql$/.test(f)).sort();
  if(!files.length)throw new Error('No packaged database migrations were found');
  return Promise.all(files.map(async name=>{const sql=await readFile(resolve(directory,name),'utf8');return {name,sql,checksum:createHash('sha256').update(sql).digest('hex')};}));
}
export async function migrate(db:Pool){
  const migrations=await readMigrations();
  await transaction(db,async client=>{await client.query('SELECT pg_advisory_xact_lock(193147,2)');await client.query('CREATE TABLE IF NOT EXISTS oaooao_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const {name,sql,checksum} of migrations){const {rows}=await client.query('SELECT checksum FROM oaooao_migrations WHERE name=$1',[name]);if(rows[0]){if(rows[0].checksum!==checksum)throw new Error(`Migration checksum changed: ${name}`);continue;}await client.query(sql);await client.query('INSERT INTO oaooao_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');const db=new pg.Pool({connectionString:process.env.DATABASE_URL});try{await migrate(db);console.log('Migrations applied successfully');}finally{await db.end();}}
