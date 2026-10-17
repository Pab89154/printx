import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CUSTOMER_ACCOUNTS_ENABLED } from '../shared/customerAccounts.ts'
import {
  clearCustomerSessionCookieHeader,
  createSession,
  CUSTOMER_SESSION_COOKIE,
  customerSessionCookieHeader,
  destroySession,
  getSessionCustomer,
  parseCookies,
  registerCustomer,
  sanitizeText,
  updateCustomerPassword,
  updateCustomerProfile,
  verifyCustomerLogin,
  type SessionCustomer,
} from './auth.ts'
import { getDb } from './db.ts'
import { roundMoney } from './pricing.ts'
import { upsTrackUrl } from './shippingUrls.ts'

function send(res: ServerResponse, status: number, body: unknown, cookies?: string[]) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  if (cookies?.length) res.setHeader('Set-Cookie', cookies)
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

function isSecure(req: IncomingMessage): boolean {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim()
  return proto === 'https' || Boolean((req.socket as { encrypted?: boolean } | undefined)?.encrypted)
}

function customerDto(c: SessionCustomer) {
  return {
    id: c.id,
    email: c.email,
    displayName: c.displayName,
  }
}

async function requireCustomer(req: IncomingMessage): Promise<SessionCustomer | null> {
  const cookies = parseCookies(req.headers.cookie)
  return getSessionCustomer(cookies[CUSTOMER_SESSION_COOKIE] ?? null)
}

export async function handleCustomerApi(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  method: string,
): Promise<boolean> {
  if (!CUSTOMER_ACCOUNTS_ENABLED) {
    const gated =
      urlPath === '/api/public/auth/register' ||
      urlPath === '/api/public/auth/login' ||
      urlPath.startsWith('/api/public/account')
    if (gated) {
      send(res, 403, { error: 'Customer accounts are disabled.' })
      return true
    }
  }

  if (urlPath === '/api/public/auth/register' && method === 'POST') {
    const body = await readJson(req)
    const result = await registerCustomer(body.name, body.email, body.password)
    if (!result.ok) {
      send(res, 400, { error: result.error })
      return true
    }
    const token = await createSession(result.customer.id)
    send(res, 200, { customer: customerDto(result.customer) }, [
      customerSessionCookieHeader(token, { secure: isSecure(req) }),
    ])
    return true
  }

  if (urlPath === '/api/public/auth/login' && method === 'POST') {
    const body = await readJson(req)
    const customer = await verifyCustomerLogin(String(body.email ?? ''), String(body.password ?? ''))
    if (!customer) {
      send(res, 401, { error: 'Invalid email or password.' })
      return true
    }
    const token = await createSession(customer.id)
    send(res, 200, { customer: customerDto(customer) }, [
      customerSessionCookieHeader(token, { secure: isSecure(req) }),
    ])
    return true
  }

  if (urlPath === '/api/public/auth/logout' && method === 'POST') {
    const cookies = parseCookies(req.headers.cookie)
    await destroySession(cookies[CUSTOMER_SESSION_COOKIE] ?? null)
    send(res, 200, { ok: true }, [clearCustomerSessionCookieHeader(isSecure(req))])
    return true
  }

  if (urlPath === '/api/public/auth/me' && method === 'GET') {
    const customer = await requireCustomer(req)
    if (!customer) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    send(res, 200, { customer: customerDto(customer) })
    return true
  }

  if (urlPath === '/api/public/account/profile' && method === 'PATCH') {
    const customer = await requireCustomer(req)
    if (!customer) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    const body = await readJson(req)
    const result = await updateCustomerProfile(customer.id, body.name)
    if (!result.ok) {
      send(res, 400, { error: result.error })
      return true
    }
    send(res, 200, { customer: customerDto(result.customer) })
    return true
  }

  if (urlPath === '/api/public/account/password' && method === 'POST') {
    const customer = await requireCustomer(req)
    if (!customer) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    const body = await readJson(req)
    const result = await updateCustomerPassword(
      customer.id,
      String(body.currentPassword ?? ''),
      String(body.newPassword ?? ''),
    )
    if (!result.ok) {
      send(res, 400, { error: result.error })
      return true
    }
    send(res, 200, { ok: true })
    return true
  }

  if (urlPath === '/api/public/account/discounts' && method === 'GET') {
    const customer = await requireCustomer(req)
    if (!customer) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    const db = await getDb()
    const rows = await db.all<Record<string, unknown>>(
      `SELECT code, kind, percent_off, amount_off_cents, max_redemptions, created_at
       FROM discounts
       WHERE active = 1 AND visible_to_customers = 1 AND kind <> 'school_pickup'
       ORDER BY created_at DESC
       LIMIT 50`,
    )
    send(res, 200, {
      discounts: rows.map((d) => ({
        code: String(d.code || ''),
        kind: String(d.kind || 'percent'),
        percentOff: d.percent_off != null ? Number(d.percent_off) : null,
        amountOffCents: d.amount_off_cents != null ? Number(d.amount_off_cents) : null,
        maxRedemptions: d.max_redemptions != null ? Number(d.max_redemptions) : null,
      })),
    })
    return true
  }

  if (urlPath === '/api/public/account/orders' && method === 'GET') {
    const customer = await requireCustomer(req)
    if (!customer) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    const db = await getDb()
    const shopRows = await db.all<Record<string, unknown>>(
      `SELECT * FROM orders
       WHERE user_id = ?
         AND status IN ('paid', 'in_production', 'printed', 'shipped', 'arrived', 'ready', 'fulfilled', 'refunded')
       ORDER BY COALESCE(paid_at, created_at) DESC
       LIMIT 100`,
      customer.id,
    )
    const shopOrders = []
    for (const row of shopRows) {
      const items = await db.all<Record<string, unknown>>(
        `SELECT oi.*, d.name as design_name
         FROM order_items oi
         JOIN designs d ON d.id = oi.design_id
         WHERE oi.order_id = ?
         ORDER BY oi.sku ASC`,
        String(row.id),
      )
      const trackingNumber = String(row.tracking_number || '')
      const carrier = String(row.tracking_carrier || '') || (trackingNumber ? 'UPS' : '')
      const trackingUrl =
        String(row.tracking_url || '').trim() ||
        (carrier.toUpperCase() === 'UPS' && trackingNumber ? upsTrackUrl(trackingNumber) : '')
      const refund = await db.get<{ id: string; status: string; reason: string; admin_note: string }>(
        `SELECT id, status, reason, admin_note FROM refund_requests
         WHERE order_id = ? AND user_id = ?
         ORDER BY created_at DESC LIMIT 1`,
        String(row.id),
        customer.id,
      )
      shopOrders.push({
        id: String(row.id),
        kind: 'shop' as const,
        status: String(row.status || ''),
        customerName: String(row.customer_name || ''),
        customerEmail: String(row.customer_email || ''),
        subtotalUsd: roundMoney(Number(row.subtotal_usd) || 0),
        totalUsd: roundMoney(Number(row.total_usd) || 0),
        shippingUsd: roundMoney(Number(row.shipping_usd) || 0),
        shippingName: String(row.shipping_name || ''),
        shippingLine1: String(row.shipping_line1 || ''),
        shippingLine2: String(row.shipping_line2 || ''),
        shippingCity: String(row.shipping_city || ''),
        shippingState: String(row.shipping_state || ''),
        shippingPostal: String(row.shipping_postal || ''),
        shippingCountry: String(row.shipping_country || ''),
        shippingMethod: String(row.shipping_method || ''),
        trackingNumber,
        trackingCarrier: carrier,
        trackingUrl,
        shippedAt: row.shipped_at != null ? String(row.shipped_at) : null,
        paidAt: row.paid_at != null ? String(row.paid_at) : null,
        createdAt: String(row.created_at || ''),
        refundRequest: refund
          ? {
              id: refund.id,
              status: refund.status,
              reason: refund.reason,
              adminNote: refund.admin_note,
            }
          : null,
        items: items.map((it) => ({
          id: String(it.id),
          designName: String(it.design_name || 'Design'),
          colorName: String(it.color_name || ''),
          qty: Number(it.qty) || 1,
          unitPriceUsd: roundMoney(Number(it.unit_price_usd) || 0),
          printStatus: String(it.print_status || ''),
        })),
      })
    }

    const customRows = await db.all<Record<string, unknown>>(
      `SELECT * FROM custom_requests
       WHERE user_id = ?
         AND paid_at IS NOT NULL
       ORDER BY paid_at DESC
       LIMIT 100`,
      customer.id,
    )
    const customOrders = customRows.map((row) => {
      const trackingNumber = String(row.tracking_number || '')
      const carrier = String(row.tracking_carrier || '') || (trackingNumber ? 'UPS' : '')
      const trackingUrl =
        String(row.tracking_url || '').trim() ||
        (carrier.toUpperCase() === 'UPS' && trackingNumber ? upsTrackUrl(trackingNumber) : '')
      return {
        id: String(row.id),
        kind: 'custom' as const,
        status: String(row.status || ''),
        label: sanitizeText(String(row.description || ''), 120) || 'Custom print',
        totalUsd: roundMoney(Number(row.catalog_price_usd) || 0),
        shippingUsd: roundMoney(Number(row.shipping_usd) || 0),
        shippingName: String(row.shipping_name || ''),
        shippingLine1: String(row.shipping_line1 || ''),
        shippingLine2: String(row.shipping_line2 || ''),
        shippingCity: String(row.shipping_city || ''),
        shippingState: String(row.shipping_state || ''),
        shippingPostal: String(row.shipping_postal || ''),
        shippingCountry: String(row.shipping_country || ''),
        shippingMethod: String(row.shipping_method || ''),
        trackingNumber,
        trackingCarrier: carrier,
        trackingUrl,
        shippedAt: row.shipped_at != null ? String(row.shipped_at) : null,
        paidAt: row.paid_at != null ? String(row.paid_at) : null,
        createdAt: String(row.created_at || ''),
      }
    })

    // Attach refund status for custom
    for (const co of customOrders) {
      const refund = await db.get<{ id: string; status: string; reason: string; admin_note: string }>(
        `SELECT id, status, reason, admin_note FROM refund_requests
         WHERE custom_request_id = ? AND user_id = ?
         ORDER BY created_at DESC LIMIT 1`,
        co.id,
        customer.id,
      )
      ;(co as { refundRequest?: unknown }).refundRequest = refund
        ? {
            id: refund.id,
            status: refund.status,
            reason: refund.reason,
            adminNote: refund.admin_note,
          }
        : null
    }

    send(res, 200, { shopOrders, customOrders })
    return true
  }

  const refundShopMatch = /^\/api\/public\/account\/orders\/([^/]+)\/refund-request$/.exec(urlPath)
  if (refundShopMatch && method === 'POST') {
    const customer = await requireCustomer(req)
    if (!customer) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    const orderId = refundShopMatch[1]!
    const body = await readJson(req)
    const reason = sanitizeText(String(body.reason ?? ''), 1000)
    if (!reason) {
      send(res, 400, { error: 'Please explain why you want a refund.' })
      return true
    }
    const db = await getDb()
    const order = await db.get<{ id: string; status: string; user_id: string | null }>(
      'SELECT id, status, user_id FROM orders WHERE id = ?',
      orderId,
    )
    if (!order || String(order.user_id) !== customer.id) {
      send(res, 404, { error: 'Order not found' })
      return true
    }
    if (order.status === 'refunded') {
      send(res, 400, { error: 'This order is already refunded.' })
      return true
    }
    if (
      !['paid', 'in_production', 'printed', 'shipped', 'arrived', 'ready', 'fulfilled'].includes(
        order.status,
      )
    ) {
      send(res, 400, { error: 'This order cannot be refunded.' })
      return true
    }
    const pending = await db.get<{ id: string }>(
      `SELECT id FROM refund_requests WHERE order_id = ? AND status = 'pending'`,
      orderId,
    )
    if (pending) {
      send(res, 400, { error: 'A refund request is already pending.' })
      return true
    }
    const id = randomUUID()
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO refund_requests (id, order_id, custom_request_id, user_id, reason, status, admin_note, created_at)
       VALUES (?, ?, NULL, ?, ?, 'pending', '', ?)`,
      id,
      orderId,
      customer.id,
      reason,
      now,
    )
    send(res, 200, { ok: true, id, status: 'pending' })
    return true
  }

  const refundCustomMatch =
    /^\/api\/public\/account\/custom-orders\/([^/]+)\/refund-request$/.exec(urlPath)
  if (refundCustomMatch && method === 'POST') {
    const customer = await requireCustomer(req)
    if (!customer) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    const customId = refundCustomMatch[1]!
    const body = await readJson(req)
    const reason = sanitizeText(String(body.reason ?? ''), 1000)
    if (!reason) {
      send(res, 400, { error: 'Please explain why you want a refund.' })
      return true
    }
    const db = await getDb()
    const row = await db.get<{ id: string; status: string; user_id: string | null; paid_at: string | null }>(
      'SELECT id, status, user_id, paid_at FROM custom_requests WHERE id = ?',
      customId,
    )
    if (!row || String(row.user_id) !== customer.id || !row.paid_at) {
      send(res, 404, { error: 'Order not found' })
      return true
    }
    if (String(row.status) === 'refunded') {
      send(res, 400, { error: 'This order is already refunded.' })
      return true
    }
    const pending = await db.get<{ id: string }>(
      `SELECT id FROM refund_requests WHERE custom_request_id = ? AND status = 'pending'`,
      customId,
    )
    if (pending) {
      send(res, 400, { error: 'A refund request is already pending.' })
      return true
    }
    const id = randomUUID()
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO refund_requests (id, order_id, custom_request_id, user_id, reason, status, admin_note, created_at)
       VALUES (?, NULL, ?, ?, ?, 'pending', '', ?)`,
      id,
      customId,
      customer.id,
      reason,
      now,
    )
    send(res, 200, { ok: true, id, status: 'pending' })
    return true
  }

  return false
}

export { requireCustomer }
