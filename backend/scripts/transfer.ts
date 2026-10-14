import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {migrate} from '../src/migrate.js';
import {importTransfer,verifyTransfer,type TransferBundle} from '../src/transfer.js';
const [action,file]=process.argv.slice(2);
if(!['import','verify'].includes(action)||!file||!process.env.DATABASE_URL)throw new Error('Usage: DATABASE_URL=<fresh destination> tsx scripts/transfer.ts import|verify <private normalized JSON>');
const bundle=JSON.parse(await readFile(file,'utf8')) as TransferBundle;
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{if(action==='import'){await migrate(db);console.log(JSON.stringify(await importTransfer(db,bundle)));}else console.log(JSON.stringify(await verifyTransfer(db,bundle)));}
finally{await db.end();}
