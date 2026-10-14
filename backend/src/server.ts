import { buildApp, loadConfig } from './app.js';
const config=loadConfig();const app=await buildApp({config,logger:true});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
try{await app.listen({host:config.host,port:config.port});}catch{app.log.error('Backend startup failed; check database, schema, and configuration');await app.close();process.exitCode=1;}
