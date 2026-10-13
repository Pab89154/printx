import { randomInt } from 'node:crypto'
import type { DbApi } from './dbClient.ts'
import { formatTrackCode, hasBusinessDaysElapsed } from '../shared/orderTracking.ts'

function randomCode(): string {
  return formatTrackCode(randomInt(0, 1_000_000))
}

/** Assign a unique 6-digit track code; never reuses an existing code. */
export async function ensureOrderTrackCode(db: DbApi, orderId: string): Promise<string> {
  const existing = await db.get<{ track_code: string | null }>(
    'SELECT track_code FROM orders WHERE id = ?',
    orderId,
  )
  const current = String(existing?.track_code || '').trim()
  if (/^\d{6}$/.test(current)) return current

  for (let attempt = 0; attempt < 40; attempt++) {
    const code = randomCode()
    try {
      await db.run(
        `UPDATE orders SET track_code = ? WHERE id = ? AND (track_code IS NULL OR TRIM(track_code) = '')`,
        code,
        orderId,
      )
      const row = await db.get<{ track_code: string | null }>(
        'SELECT track_code FROM orders WHERE id = ?',
        orderId,
      )
      const assigned = String(row?.track_code || '').trim()
      if (/^\d{6}$/.test(assigned)) return assigned
    } catch {
      /* unique collision — try another */
    }
  }
  throw new Error('Could not allocate a unique track code.')
}

/**
 * Advance shipped orders past shipping-method business-day ETA:
 * shipped → arrived → fulfilled (order finished for money/admin).
 */
export async function advanceArrivedOrders(db: DbApi): Promise<number> {
  const rows = await db.all<{
    id: string
    shipped_at: string | null
    shipping_method: string | null
  }>(
    `SELECT id, shipped_at, shipping_method FROM orders
     WHERE status = 'shipped' AND shipped_at IS NOT NULL
     ORDER BY shipped_at ASC
     LIMIT 100`,
  )
  let n = 0
  const now = new Date()
  for (const row of rows) {
    if (!hasBusinessDaysElapsed(row.shipped_at, row.shipping_method, now)) continue
    const ts = now.toISOString()
    await db.run(
      `UPDATE orders SET status = 'arrived', updated_at = ? WHERE id = ? AND status = 'shipped'`,
      ts,
      row.id,
    )
    await db.run(
      `UPDATE orders SET status = 'fulfilled', updated_at = ? WHERE id = ? AND status = 'arrived'`,
      ts,
      row.id,
    )
    n++
  }
  return n
}
