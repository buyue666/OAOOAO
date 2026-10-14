import {randomUUID} from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import {ADMIN_PERMISSIONS,createContext,transaction} from './core.js';
import {loadConfig} from './app.js';
import {validatePassword,validateUsername} from './auth.js';
import {migrate} from './migrate.js';

const config=loadConfig();
const username=validateUsername(process.env.BOOTSTRAP_ADMIN_USERNAME);
const password=validatePassword(process.env.BOOTSTRAP_ADMIN_PASSWORD);
const db=new pg.Pool({connectionString:config.databaseUrl});
try{
  await migrate(db);const ctx=createContext(db,config);const hash=await bcrypt.hash(password,12);
  await transaction(db,async client=>{
    await client.query('SELECT pg_advisory_xact_lock(193147,1)');
    if((await client.query("SELECT id FROM oaooao_users WHERE role='admin' AND enabled=true LIMIT 1")).rowCount)throw new Error('An active administrator already exists; use administrator management instead');
    const id=randomUUID();await client.query("INSERT INTO oaooao_users(id,username,display_name,password_hash,role,admin_permissions) VALUES($1,$2,$2,$3,'admin',$4::jsonb)",[id,username,hash,JSON.stringify(ADMIN_PERMISSIONS)]);
    await ctx.audit({actorId:id,action:'administrator.bootstrap',targetType:'user',targetId:id},client);
  });console.log('Initial administrator created. Remove bootstrap credentials from your environment.');
}finally{delete process.env.BOOTSTRAP_ADMIN_PASSWORD;await db.end();}
