import { applyWorkerEnv, handleWorkerFetch, type WorkerEnv } from '../server/cfAdapter.ts'
import { drainBackgroundTasks } from '../server/background.ts'
import { runWithDbScope } from '../server/dbClient.ts'
import { notifyPreviousMonthMoneySummary } from '../server/moneyNotify.ts'
import { ensureDbReady, runDbMigrations, closeDb } from '../server/db.ts'

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleWorkerFetch(request, env, ctx)
    } finally {
      // Keep push / mail side-effects alive after the response (Workers otherwise abort them).
      for (const task of drainBackgroundTasks()) {
        ctx.waitUntil(task)
      }
    }
  },

  /** Cron: flush scheduled mail every 5 min; monthly money summary on the 1st. */
  async scheduled(event: ScheduledEvent, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runWithDbScope(async () => {
        try {
          applyWorkerEnv(env)
          await ensureDbReady()
          // Migrations live here (every 5 min, off the user path) — request
          // isolates only probe, so bursts can't trigger migration storms.
          await runDbMigrations()
          const { flushDueScheduledMail } = await import('../server/router.ts')
          const { getDb } = await import('../server/db.ts')
          const db = await getDb()
          const delivered = await flushDueScheduledMail(db)
          if (delivered > 0) console.log('[cron:mail]', delivered, 'scheduled message(s) delivered')

          const { resumeInterruptedDesignQuotes } = await import('../server/catalogApi.ts')
          await resumeInterruptedDesignQuotes()

          const { processRealisticImageJobs } = await import('../server/realisticImages.ts')
          const realistic = await processRealisticImageJobs(db, { maxStarts: 6 })
          if (realistic.started || realistic.polled) {
            console.log('[cron:realistic-image]', realistic)
          }

          if (event.cron === '0 14 1 * *') {
            const result = await notifyPreviousMonthMoneySummary()
            console.log('[cron:money]', result.month, 'notified')
          }
          for (const task of drainBackgroundTasks()) {
            await task
          }
        } catch (err) {
          console.warn('[cron]', err instanceof Error ? err.message : err)
        } finally {
          try {
            await closeDb()
          } catch {
            /* ignore */
          }
        }
      }),
    )
  },
}
