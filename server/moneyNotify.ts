/** End-of-month money push — owed print pay + PrintX profit share reminder. */

import { getDb } from './db.ts'
import { notifyAdminsWithPermission } from './pushNotify.ts'
import { roundMoney } from './pricing.ts'

function previousUtcMonth(): string {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() // 0-based; previous = m-1
  const d = new Date(Date.UTC(y, m - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Notify admins with Money access about the previous month's print pay + profit split.
 * Intended for Cloudflare cron on the 1st of each month.
 */
export async function notifyPreviousMonthMoneySummary(): Promise<{ sent: boolean; month: string }> {
  const yearMonth = previousUtcMonth()
  const [yStr, mStr] = yearMonth.split('-')
  const y = Number(yStr)
  const m = Number(mStr)
  const rangeStart = new Date(Date.UTC(y, m - 1, 1)).toISOString()
  const rangeEnd = new Date(Date.UTC(y, m, 1)).toISOString()

  const db = await getDb()
  const reimburse = await db.get<{ total: number | string | null }>(
    `SELECT COALESCE(SUM(amount_usd), 0) as total FROM profit_ledger
     WHERE entry_type = 'reimburse' AND created_at >= ? AND created_at < ?`,
    rangeStart,
    rangeEnd,
  )
  const owedAll = roundMoney(Number(reimburse?.total) || 0)

  await notifyAdminsWithPermission(db, 'money', {
    title: `Money · ${yearMonth}`,
    body:
      owedAll > 0
        ? `Last month: $${owedAll.toFixed(2)} owed to printers. Open Money for your print pay + profit split.`
        : `Open Money for ${yearMonth} — print pay and PrintX profit split.`,
    url: '/money',
  })
  return { sent: true, month: yearMonth }
}
