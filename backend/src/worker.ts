import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { httpError, transaction, type Context } from './core.js';
import { adjustWallet } from './wallet.js';
import { invokeProvider, ProviderFailure, type Json, type ProviderResult } from './providers.js';

export async function jobEvent(client:PoolClient,jobId:string,type:string,data:Json){
  await client.query('INSERT INTO oaooao_agent_events(run_id,event_type,data) SELECT id,$2,$3 FROM oaooao_agent_runs WHERE job_id=$1 OR id IN (SELECT run_id FROM oaooao_agent_steps WHERE job_id=$1)',[jobId,type,data]);
}
export async function finishJob(ctx:Context,client:PoolClient,row:Json,status:'success'|'error'|'cancelled',result:Json|null,error:string|null){
  if(['success','error','cancelled'].includes(row.status))return row;
  if(status!=='success'&&Number(row.cost)>0)await adjustWallet(ctx,row.user_id,`generation:${row.id}:refund`,row.cost,{kind:'generation_refund',taskId:row.id,refundOf:`generation:${row.id}:debit`},client);
  const updated=(await client.query(`UPDATE oaooao_generation_jobs SET status=$2,phase='complete',result=$3,error=$4,needs_review=false,lease_owner=null,lease_until=null,finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,[row.id,status,result,error])).rows[0];
  await jobEvent(client,row.id,'task.updated',{taskId:row.id,status,result,error});return updated;
}
export async function cancelJob(ctx:Context,client:PoolClient,id:string,userId:string){
  const row=(await client.query('SELECT * FROM oaooao_generation_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId])).rows[0];
  if(!row)throw httpError(404,'Task not found');
  if(row.status==='cancelled')return row;
  if(row.cancel_requested)return row;
  if(['success','error'].includes(row.status))throw httpError(409,'Task has already finished');
  if(row.phase==='queued')return finishJob(ctx,client,row,'cancelled',null,'Cancelled before provider submission');
  const updated=(await client.query('UPDATE oaooao_generation_jobs SET cancel_requested=true,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',[id])).rows[0];
  await jobEvent(client,id,'cancellation.requested',{taskId:id,pendingCount:1});return updated;
}
export type Executor=(ctx:Context,job:Json,poll:boolean)=>Promise<ProviderResult>;
export async function processNextJob(ctx:Context,execute:Executor=invokeProvider):Promise<boolean>{
  const {advanceAgentRuns}=await import('./agents.js');
  await advanceAgentRuns(ctx);
  const workerId=randomUUID();
  const job=await transaction(ctx.db,async client=>{
    // A crashed POST may already have been accepted upstream. Never repeat it.
    const expired=await client.query(`UPDATE oaooao_generation_jobs SET phase='review',needs_review=true,error='Worker stopped during provider submission; outcome requires verification',lease_owner=null,lease_until=null,updated_at=clock_timestamp() WHERE status='running' AND phase='submitting' AND lease_until<now() RETURNING id`);
    for(const row of expired.rows)await jobEvent(client,row.id,'task.needs_review',{taskId:row.id});
    const row=(await client.query(`SELECT * FROM oaooao_generation_jobs WHERE status IN ('pending','running') AND phase IN ('queued','polling') AND next_poll_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if(!row)return null;
    const polling=row.phase==='polling';
    const result=(await client.query(`UPDATE oaooao_generation_jobs SET status='running',phase=$2,lease_owner=$3,lease_until=now()+interval '5 minutes',started_at=coalesce(started_at,now()),updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,[row.id,polling?'polling':'submitting',workerId])).rows[0];
    await jobEvent(client,row.id,'task.running',{taskId:row.id,status:'running'});
    return{...result,polling};
  });
  if(!job)return false;
  let outcome:ProviderResult|undefined;let failure:unknown;
  const heartbeat=setInterval(()=>{void ctx.db.query("UPDATE oaooao_generation_jobs SET lease_until=now()+interval '5 minutes' WHERE id=$1 AND lease_owner=$2 AND status='running'",[job.id,workerId]).catch(()=>undefined);},30000);heartbeat.unref();
  try{outcome=await execute(ctx,job,job.polling);}catch(error){failure=error;}finally{clearInterval(heartbeat);}
  await transaction(ctx.db,async client=>{
    const current=(await client.query('SELECT * FROM oaooao_generation_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
    if(current.lease_owner!==workerId||!['running','pending'].includes(current.status))return;
    if(outcome?.type==='complete')await finishJob(ctx,client,current,'success',outcome.result,null);
    else if(outcome?.type==='pending'){
      await client.query(`UPDATE oaooao_generation_jobs SET upstream_id=$2,phase='polling',lease_owner=null,lease_until=null,next_poll_at=now()+interval '5 seconds',updated_at=clock_timestamp() WHERE id=$1`,[job.id,outcome.upstreamId]);
      await jobEvent(client,job.id,'task.submitted',{taskId:job.id,upstreamId:outcome.upstreamId});
    }else if(failure instanceof ProviderFailure&&failure.definitive)await finishJob(ctx,client,current,'error',null,failure.message);
    else if(job.polling){
      await client.query(`UPDATE oaooao_generation_jobs SET lease_owner=null,lease_until=null,next_poll_at=now()+interval '30 seconds',phase=CASE WHEN started_at<now()-interval '24 hours' THEN 'review' ELSE 'polling' END,needs_review=(started_at<now()-interval '24 hours'),error='Provider status is temporarily unavailable',updated_at=clock_timestamp() WHERE id=$1`,[job.id]);
    }else{
      await client.query(`UPDATE oaooao_generation_jobs SET phase='review',needs_review=true,error='Provider submission outcome is unknown; manual verification is required',lease_owner=null,lease_until=null,updated_at=clock_timestamp() WHERE id=$1`,[job.id]);
      await jobEvent(client,job.id,'task.needs_review',{taskId:job.id});
    }
  });
  await advanceAgentRuns(ctx);
  return true;
}
export function startWorker(ctx:Context){
  let stopped=false;let active:Promise<unknown>|undefined;
  let maintenanceAt=0;
  const tick=()=>{if(stopped||active)return;active=(async()=>{await processNextJob(ctx);if(Date.now()-maintenanceAt>60000){maintenanceAt=Date.now();const {runCommerceMaintenance}=await import('./commerce.js');await runCommerceMaintenance(ctx);const {expireCreditBatches}=await import('./wallet.js');await expireCreditBatches(ctx);}})().catch(()=>undefined).finally(()=>{active=undefined;});};
  const timer=setInterval(tick,1000);timer.unref();tick();
  return async()=>{stopped=true;clearInterval(timer);await active;};
}
