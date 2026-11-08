import { sleep } from 'workflow'
import { start } from 'workflow/api'

async function processAccountQueue(userId: string) {
  'use step'
  const { getEmbeddedBackend } = await import('./embedded-backend')
  const { processNextJob } = await import('@/backend/src/worker')
  const app = await getEmbeddedBackend()
  await processNextJob(app.ctx, undefined, userId)
  const { rows } = await app.ctx.db.query(
    "SELECT EXISTS(SELECT 1 FROM oaooao_generation_jobs WHERE user_id=$1 AND status IN ('pending','running') AND phase IN ('queued','submitting','polling')) AS active",
    [userId],
  )
  return rows[0].active as boolean
}

export async function runGenerationQueue(userId: string): Promise<void> {
  'use workflow'
  for (let round = 0; round < 120; round += 1) {
    if (!await processAccountQueue(userId)) return
    await sleep('10s')
  }
  // Keep each event log bounded while the parent retains the per-account start lock.
  const continuation = await start(runGenerationQueue, [userId])
  await continuation.returnValue
}
