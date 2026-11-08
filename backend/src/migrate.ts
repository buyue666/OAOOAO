import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readMigrations } from './migration-files.js';
import pg, {type Pool} from 'pg';
import { transaction } from './core.js';
export { readMigrations } from './migration-files.js';
export async function migrate(db:Pool){
  const migrations=await readMigrations();
  await transaction(db,async client=>{await client.query('SELECT pg_advisory_xact_lock(193147,2)');await client.query('CREATE TABLE IF NOT EXISTS oaooao_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const {name,sql,checksum} of migrations){const {rows}=await client.query('SELECT checksum FROM oaooao_migrations WHERE name=$1',[name]);if(rows[0]){if(rows[0].checksum!==checksum)throw new Error(`Migration checksum changed: ${name}`);continue;}await client.query(sql);await client.query('INSERT INTO oaooao_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');const db=new pg.Pool({connectionString:process.env.DATABASE_URL});try{await migrate(db);console.log('Migrations applied successfully');}finally{await db.end();}}
