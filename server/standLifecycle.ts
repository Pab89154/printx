import type { DbApi } from './dbClient.ts'
import { invalidateBootstrapCache } from './bootstrapCache.ts'
import { isStandFinished, isStandOlderThanOneYear } from '../shared/standSchedule.ts'

/**
 * Keep stands in sync with the calendar:
 * - finished stands → status "past" (still visible in admin, hidden on public site)
 * - stands a year or older → deleted
 */
export async function syncStandLifecycle(db: DbApi): Promise<boolean> {
  const rows = await db.all<{
    id: string
    date: string
    start_time: string
    end_time: string
    status: string
  }>('SELECT id, date, start_time, end_time, status FROM stands')

  const now = new Date()
  const nowIso = now.toISOString()
  let changed = false

  for (const row of rows) {
    if (isStandOlderThanOneYear(row.date, now)) {
      await db.run('DELETE FROM stands WHERE id = ?', row.id)
      changed = true
      continue
    }

    if (row.status !== 'past' && isStandFinished(row.date, row.start_time, row.end_time, now)) {
      await db.run(
        'UPDATE stands SET status = ?, updated_at = ? WHERE id = ?',
        'past',
        nowIso,
        row.id,
      )
      changed = true
    }
  }

  if (changed) invalidateBootstrapCache()
  return changed
}
