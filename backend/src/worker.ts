import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { httpError, transaction, type Context } from './core.js';
import { adjustWallet,refundWalletDifference,creditUnits,creditDecimal } from './wallet.js';
import { refundTeamJob,refundTeamDifference } from './team-wallet.js';
import { cleanupTeamAssets } from './team-assets.js';
import { invokeProvider, ProviderFailure, type Json, type ProviderResult } from './providers.js';
import { cleanupStoredMedia } from './account-storage.js';
import { cleanupDirectDownloads } from './media-download.js';

export async function jobEvent(client:PoolClient,jobId:string,type:string,data:Json){
  await client.query('INSERT INTO oaooao_agent_events(run_id,event_type,data) SELECT id,$2,$3 FROM oaooao_agent_runs WHERE job_id=$1 OR id IN (SELECT run_id FROM oaooao_agent_steps WHERE job_id=$1)',[jobId,type,data]);
}
export async function finishJob(ctx:Context,client:PoolClient,row:Json,status:'success'|'error'|'cancelled',result:Json|null,error:string|null){
  if(['success','error','cancelled'].includes(row.status))return row;
  if(status!=='success'&&Number(row.cost)>0){
    if(row.team_id)await refundTeamJob(client,row);
    else await adjustWallet(ctx,row.user_id,`generation:${row.id}:refund`,row.cost,{kind:'generation_refund',taskId:row.id,refundOf:`generation:${row.id}:debit`},client);
  }
  const updated=(await client.query(`UPDATE oaooao_generation_jobs SET status=$2,phase='complete',result=$3,error=$4,needs_review=false,lease_owner=null,lease_until=null,finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,[row.id,status,result,error])).rows[0];
  await jobEvent(client,row.id,'task.updated',{taskId:row.id,status,result,error});return updated;
}
const DEFAULT_ASYNC_TASK_TIMEOUT_MINUTES=3;
const DEFAULT_STATUS_QUERY_RETRIES=3;
function asyncTaskTimeoutMs(row:Json){
  const value=Number(row.provider_config?.asyncTaskTimeoutMinutes);
  const minutes=Number.isInteger(value)&&value>=1&&value<=1440?value:DEFAULT_ASYNC_TASK_TIMEOUT_MINUTES;
  return minutes*60_000;
}
function statusQueryRetryLimit(row:Json){
  const value=Number(row.provider_config?.statusQueryRetries);
  return Number.isInteger(value)&&value>=0&&value<=10?value:DEFAULT_STATUS_QUERY_RETRIES;
}
function asyncTaskExpired(row:Json,now=Date.now()){
  const startedAt=new Date(row.started_at||row.created_at).getTime();
  return Number.isFinite(startedAt)&&now-startedAt>=asyncTaskTimeoutMs(row);
}
function timeoutMessage(row:Json){
  const minutes=Math.round(asyncTaskTimeoutMs(row)/60_000);
  return `异步任务超过 ${minutes} 分钟仍未完成，系统已结束任务并退还积分。`;
}
export async function cancelJob(ctx:Context,client:PoolClient,id:string,userId:string){
  const row=(await client.query('SELECT * FROM oaooao_generation_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId])).rows[0];
  if(!row)throw httpError(404,'Task not found');
  if(row.status==='cancelled')return row;
  if(row.cancel_requested)return row;
  if(['success','error'].includes(row.status))throw httpError(409,'Task has already finished');
  if(row.phase==='queued'||(row.phase==='review'&&!row.lease_owner&&!row.upstream_id))return finishJob(ctx,client,row,'cancelled',null,'任务已取消，未改动生成结果');
  const updated=(await client.query('UPDATE oaooao_generation_jobs SET cancel_requested=true,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',[id])).rows[0];
  await jobEvent(client,id,'cancellation.requested',{taskId:id,pendingCount:1});return updated;
}
export type Executor=(ctx:Context,job:Json,poll:boolean)=>Promise<ProviderResult>;
export async function processNextJob(ctx:Context,execute:Executor=invokeProvider,scopeUserId?:string):Promise<boolean>{
  const {advanceAgentRuns}=await import('./agents.js');
  await advanceAgentRuns(ctx);
  const workerId=randomUUID();
  const job=await transaction(ctx.db,async client=>{
    // Recover legacy review rows without asking an administrator to interpret an unknown outcome.
    const legacy=(await client.query(`SELECT * FROM oaooao_generation_jobs WHERE status IN ('pending','running') AND (phase='review' OR needs_review) AND (lease_until IS NULL OR lease_until<now()) AND ($1::text IS NULL OR user_id=$1) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 20`,[scopeUserId||null])).rows;
    for(const row of legacy){
      if(row.upstream_id&& !asyncTaskExpired(row))await client.query("UPDATE oaooao_generation_jobs SET phase='polling',needs_review=false,poll_failures=0,next_poll_at=now(),lease_owner=null,lease_until=null,error=null,updated_at=clock_timestamp() WHERE id=$1",[row.id]);
      else await finishJob(ctx,client,row,'error',null,row.upstream_id?timeoutMessage(row):'上游提交未返回任务标识，无法继续查询。任务已结束，积分已退还；系统不会自动重复创建。');
    }
    // A crashed POST may have reached the provider, but without a task ID it cannot be queried safely.
    const expiredSubmissions=(await client.query(`SELECT * FROM oaooao_generation_jobs WHERE status='running' AND phase='submitting' AND lease_until<now() AND ($1::text IS NULL OR user_id=$1) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 20`,[scopeUserId||null])).rows;
    for(const row of expiredSubmissions)await finishJob(ctx,client,row,'error',null,'上游提交连接中断且未取得任务标识，无法继续查询。任务已结束，积分已退还；系统不会自动重复创建。');
    const row=(await client.query(`SELECT * FROM oaooao_generation_jobs WHERE status IN ('pending','running') AND phase IN ('queued','polling') AND next_poll_at<=now() AND (lease_until IS NULL OR lease_until<now()) AND ($1::text IS NULL OR user_id=$1) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,[scopeUserId||null])).rows[0];
    if(!row)return null;
    if(row.phase==='polling'&&asyncTaskExpired(row)){
      await finishJob(ctx,client,row,'error',null,timeoutMessage(row));
      return null;
    }
    const polling=row.phase==='polling';
    const result=(await client.query(`UPDATE oaooao_generation_jobs SET status='running',phase=$2,lease_owner=$3,lease_until=now()+interval '5 minutes',started_at=coalesce(started_at,now()),updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,[row.id,polling?'polling':'submitting',workerId])).rows[0];
    await jobEvent(client,row.id,'task.running',{taskId:row.id,status:'running'});
    return{...result,polling};
  });
  if(!job)return false;
  let outcome:ProviderResult|undefined;let failure:unknown;
  const heartbeat=setInterval(()=>{void ctx.db.query("UPDATE oaooao_generation_jobs SET lease_until=now()+interval '5 minutes' WHERE id=$1 AND lease_owner=$2 AND status='running'",[job.id,workerId]).catch(()=>undefined);},30000);heartbeat.unref();
  try{outcome=await execute(job.team_id?{...ctx,workspace:{teamId:job.team_id,projectId:job.team_project_id}}:ctx,job,job.polling);}catch(error){failure=error;}finally{clearInterval(heartbeat);}
  await transaction(ctx.db,async client=>{
    const current=(await client.query('SELECT * FROM oaooao_generation_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
    if(current.lease_owner!==workerId||!['running','pending'].includes(current.status))return;
    if(outcome?.type==='complete'){
      if(outcome.settledCost!==undefined){
        const actual=creditUnits(outcome.settledCost),reserved=creditUnits(current.cost),difference=reserved-actual;
        if(actual<0n||difference<0n)throw httpError(409,'视频结算费用超出预扣上限');
        if(difference>0n){if(current.team_id)await refundTeamDifference(client,current,creditDecimal(difference));else await refundWalletDifference(ctx,current.user_id,`generation:${current.id}:refund`,creditDecimal(difference),`generation:${current.id}:debit`,client);}
        outcome.result.billing={reservedPoints:Number(current.cost),actualPoints:Number(outcome.settledCost),returnedPoints:Number(creditDecimal(difference))};
        await client.query('UPDATE oaooao_generation_jobs SET cost=$2 WHERE id=$1',[current.id,outcome.settledCost]);current.cost=outcome.settledCost;
      }
      await finishJob(ctx,client,current,'success',outcome.result,null);
    }
    else if(outcome?.type==='pending'&&asyncTaskExpired(current))await finishJob(ctx,client,current,'error',null,timeoutMessage(current));
    else if(outcome?.type==='pending'){
      await client.query(`UPDATE oaooao_generation_jobs SET upstream_id=$2,phase='polling',poll_failures=0,needs_review=false,lease_owner=null,lease_until=null,next_poll_at=now()+interval '5 seconds',updated_at=clock_timestamp() WHERE id=$1`,[job.id,outcome.upstreamId]);
      await jobEvent(client,job.id,'task.submitted',{taskId:job.id,upstreamId:outcome.upstreamId});
    }
    else if(failure instanceof ProviderFailure&&failure.definitive)await finishJob(ctx,client,current,'error',null,failure.message);
    else if(job.polling){
      const failedQueries=Number(current.poll_failures||0),retryLimit=statusQueryRetryLimit(current);
      if(asyncTaskExpired(current))await finishJob(ctx,client,current,'error',null,timeoutMessage(current));
      else if(failedQueries>=retryLimit)await finishJob(ctx,client,current,'error',null,`连续 ${failedQueries+1} 次查询上游状态失败，系统已结束任务并退还积分。`);
      else await client.query(`UPDATE oaooao_generation_jobs SET poll_failures=poll_failures+1,lease_owner=null,lease_until=null,next_poll_at=now()+interval '10 seconds',phase='polling',error='Provider status is temporarily unavailable',updated_at=clock_timestamp() WHERE id=$1`,[job.id]);
    }else{
      await finishJob(ctx,client,current,current.cancel_requested?'cancelled':'error',null,'上游提交结果无法确认且没有可查询的任务标识。任务已结束，积分已退还；系统不会自动重复创建。');
    }
  });
  await advanceAgentRuns(ctx);
  return true;
}
export function startWorker(ctx:Context){
  let stopped=false;let active:Promise<unknown>|undefined;
  let maintenanceAt=0;
  const tick=()=>{if(stopped||active)return;active=(async()=>{await processNextJob(ctx);if(Date.now()-maintenanceAt>60000){maintenanceAt=Date.now();const {runCommerceMaintenance}=await import('./commerce.js');await runCommerceMaintenance(ctx);const {expireCreditBatches}=await import('./wallet.js');await expireCreditBatches(ctx);await cleanupStoredMedia(ctx);await cleanupTeamAssets(ctx);await cleanupDirectDownloads(ctx);}})().catch(()=>undefined).finally(()=>{active=undefined;});};
  const timer=setInterval(tick,1000);timer.unref();tick();
  return async()=>{stopped=true;clearInterval(timer);await active;};
}
