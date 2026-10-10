import { randomUUID } from 'node:crypto'
import { resolveImageUrl } from '../shared/imageUrl.ts'
import {
  BUILTIN_COLORS,
  buildSku,
  colorById,
  emptyCustomColorSlots,
  normalizeCustomSlots,
  type CustomColorSlot,
} from '../shared/colors.ts'
import type { DbApi } from './dbClient.ts'
import {
  DEFAULT_PRICING,
  DEFAULT_PRINTERS,
  priceDesign,
  roundMoney,
  type PricingSettings,
  type PrinterRow,
} from './pricing.ts'

export type DesignStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived'

export type SliceStatus = 'idle' | 'slicing' | 'ready' | 'error'

export type Design = {
  id: string
  skuBase: string
  name: string
  description: string
  category: string
  imageUrl: string
  stlPath: string
  hasStl: boolean
  modelExt?: string
  sliceStatus: SliceStatus
  sliceError: string
  status: DesignStatus
  createdBy: string | null
  submittedAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNote: string
  gramsPabloP1s: number | null
  hoursPabloP1s: number | null
  gramsCourtEnder: number | null
  hoursCourtEnder: number | null
  gramsJoshKobra: number | null
  hoursJoshKobra: number | null
  availableColorIds: string[]
  worstCostUsd: number | null
  catalogPriceUsd: number | null
  pricedAt: string | null
  pricingInputsJson: string
  createdAt: string
  updatedAt: string
}

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'in_production'
  | 'ready'
  | 'fulfilled'
  | 'cancelled'
  | 'refunded'

export type PrintStatus = 'unclaimed' | 'claimed' | 'printing' | 'done'

export type OrderItem = {
  id: string
  orderId: string
  designId: string
  sku: string
  colorId: string
  colorName: string
  qty: number
  unitPriceUsd: number
  worstCostUnitUsd: number
  lineTotalUsd: number
  printStatus: PrintStatus
  assignedPrinterId: string | null
  assignedAdminUserId: string | null
  claimedAt: string | null
  completedAt: string | null
  reimburseUsd: number | null
  profitUsd: number | null
  designName?: string
}

export type Order = {
  id: string
  customerName: string
  customerEmail: string
  status: OrderStatus
  stripeSessionId: string | null
  stripePaymentIntent: string | null
  subtotalUsd: number
  totalUsd: number
  currency: string
  createdAt: string
  updatedAt: string
  paidAt: string | null
  items?: OrderItem[]
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function rowToDesign(row: Record<string, unknown>): Design {
  let colors: string[] = []
  try {
    colors = JSON.parse(String(row.available_color_ids || '[]')) as string[]
  } catch {
    colors = []
  }
  const stlPath = String(row.stl_path || '')
  const sliceStatusRaw = String(row.slice_status || 'idle')
  const sliceStatus: SliceStatus =
    sliceStatusRaw === 'slicing' || sliceStatusRaw === 'ready' || sliceStatusRaw === 'error'
      ? sliceStatusRaw
      : 'idle'
  return {
    id: row.id as string,
    skuBase: row.sku_base as string,
    name: row.name as string,
    description: (row.description as string) || '',
    category: (row.category as string) || 'General',
    imageUrl: resolveImageUrl((row.image_url as string) || ''),
    stlPath,
    hasStl: Boolean(stlPath.trim()),
    sliceStatus,
    sliceError: String(row.slice_error || ''),
    status: row.status as DesignStatus,
    createdBy: (row.created_by as string | null) ?? null,
    submittedAt: (row.submitted_at as string | null) ?? null,
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    reviewNote: (row.review_note as string) || '',
    gramsPabloP1s: numOrNull(row.grams_pablo_p1s),
    hoursPabloP1s: numOrNull(row.hours_pablo_p1s),
    gramsCourtEnder: numOrNull(row.grams_court_ender),
    hoursCourtEnder: numOrNull(row.hours_court_ender),
    gramsJoshKobra: numOrNull(row.grams_josh_kobra),
    hoursJoshKobra: numOrNull(row.hours_josh_kobra),
    availableColorIds: Array.isArray(colors) ? colors : [],
    worstCostUsd: numOrNull(row.worst_cost_usd),
    catalogPriceUsd: numOrNull(row.catalog_price_usd),
    pricedAt: (row.priced_at as string | null) ?? null,
    pricingInputsJson: (row.pricing_inputs_json as string) || '{}',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export function rowToOrder(row: Record<string, unknown>): Order {
  return {
    id: row.id as string,
    customerName: (row.customer_name as string) || '',
    customerEmail: (row.customer_email as string) || '',
    status: row.status as OrderStatus,
    stripeSessionId: (row.stripe_session_id as string | null) ?? null,
    stripePaymentIntent: (row.stripe_payment_intent as string | null) ?? null,
    subtotalUsd: Number(row.subtotal_usd) || 0,
    totalUsd: Number(row.total_usd) || 0,
    currency: (row.currency as string) || 'usd',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    paidAt: (row.paid_at as string | null) ?? null,
  }
}

export function rowToOrderItem(row: Record<string, unknown>): OrderItem {
  return {
    id: row.id as string,
    orderId: row.order_id as string,
    designId: row.design_id as string,
    sku: row.sku as string,
    colorId: row.color_id as string,
    colorName: (row.color_name as string) || '',
    qty: Number(row.qty) || 1,
    unitPriceUsd: Number(row.unit_price_usd) || 0,
    worstCostUnitUsd: Number(row.worst_cost_unit_usd) || 0,
    lineTotalUsd: Number(row.line_total_usd) || 0,
    printStatus: row.print_status as PrintStatus,
    assignedPrinterId: (row.assigned_printer_id as string | null) ?? null,
    assignedAdminUserId: (row.assigned_admin_user_id as string | null) ?? null,
    claimedAt: (row.claimed_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    reimburseUsd: numOrNull(row.reimburse_usd),
    profitUsd: numOrNull(row.profit_usd),
    designName: typeof row.design_name === 'string' ? row.design_name : undefined,
  }
}

export async function seedCatalogDefaults(database: DbApi) {
  const now = new Date().toISOString()
  const existing = await database.get<{ id: string }>('SELECT id FROM pricing_settings WHERE id = ?', 'default')
  if (!existing) {
    await database.run(
      `INSERT INTO pricing_settings (
        id, filament_usd_per_gram, electricity_usd_per_kwh, margin_pct,
        unproductive_adder_usd, fixing_adder_usd, sales_tax_pct, custom_colors_json, updated_at, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'default',
      DEFAULT_PRICING.filamentUsdPerGram,
      DEFAULT_PRICING.electricityUsdPerKwh,
      DEFAULT_PRICING.marginPct,
      DEFAULT_PRICING.unproductiveAdderUsd,
      DEFAULT_PRICING.fixingAdderUsd,
      DEFAULT_PRICING.salesTaxPct,
      JSON.stringify(emptyCustomColorSlots()),
      now,
      null,
    )
  }
  for (const p of DEFAULT_PRINTERS) {
    await database.run(
      `INSERT INTO printers (id, owner_label, model_name, avg_power_kw, active, owner_user_id)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO NOTHING`,
      p.id,
      p.ownerLabel,
      p.modelName,
      p.avgPowerKw,
      p.active ? 1 : 0,
    )
  }
}

export async function getPricingSettings(database: DbApi): Promise<PricingSettings & { customColors: CustomColorSlot[] }> {
  await seedCatalogDefaults(database)
  const row = await database.get<Record<string, unknown>>(
    'SELECT * FROM pricing_settings WHERE id = ?',
    'default',
  )
  if (!row) throw new Error('pricing_settings missing')
  const customColors = normalizeCustomSlots(
    (() => {
      try {
        return JSON.parse(String(row.custom_colors_json || '[]'))
      } catch {
        return []
      }
    })(),
  )
  return {
    filamentUsdPerGram: Number(row.filament_usd_per_gram),
    electricityUsdPerKwh: Number(row.electricity_usd_per_kwh),
    marginPct: Number(row.margin_pct),
    unproductiveAdderUsd: Number(row.unproductive_adder_usd),
    fixingAdderUsd: Number(row.fixing_adder_usd),
    salesTaxPct: Number(row.sales_tax_pct),
    customColorsJson: JSON.stringify(customColors),
    updatedAt: row.updated_at as string,
    updatedBy: (row.updated_by as string | null) ?? null,
    customColors,
  }
}

export async function listPrinters(database: DbApi): Promise<PrinterRow[]> {
  await seedCatalogDefaults(database)
  const rows = await database.all<Record<string, unknown>>(
    'SELECT * FROM printers ORDER BY owner_label ASC',
  )
  return rows.map((r) => ({
    id: r.id as string,
    ownerLabel: r.owner_label as string,
    modelName: r.model_name as string,
    avgPowerKw: Number(r.avg_power_kw),
    active: Boolean(r.active),
    ownerUserId: (r.owner_user_id as string | null) ?? null,
  }))
}

export function designHasCompletePrinterInputs(d: Design): boolean {
  return (
    d.gramsPabloP1s != null &&
    d.hoursPabloP1s != null &&
    d.gramsCourtEnder != null &&
    d.hoursCourtEnder != null &&
    d.gramsJoshKobra != null &&
    d.hoursJoshKobra != null &&
    d.availableColorIds.length > 0
  )
}

export async function computeDesignPrice(database: DbApi, design: Design) {
  const settings = await getPricingSettings(database)
  const printers = await listPrinters(database)
  const byId = Object.fromEntries(printers.map((p) => [p.id, p]))
  const inputs = [
    {
      printerId: 'pablo_p1s',
      grams: design.gramsPabloP1s ?? 0,
      hours: design.hoursPabloP1s ?? 0,
      avgPowerKw: byId.pablo_p1s?.avgPowerKw ?? 0.22,
    },
    {
      printerId: 'court_ender',
      grams: design.gramsCourtEnder ?? 0,
      hours: design.hoursCourtEnder ?? 0,
      avgPowerKw: byId.court_ender?.avgPowerKw ?? 0.2,
    },
    {
      printerId: 'josh_kobra',
      grams: design.gramsJoshKobra ?? 0,
      hours: design.hoursJoshKobra ?? 0,
      avgPowerKw: byId.josh_kobra?.avgPowerKw ?? 0.25,
    },
  ]
  return { result: priceDesign(inputs, settings), settings, printers }
}

export function sanitizeSkuBase(raw: string): string {
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned.slice(0, 40)
}

export function suggestSkuBase(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28)
  return sanitizeSkuBase(`PX-${slug || 'DESIGN'}`)
}

export { BUILTIN_COLORS, buildSku, colorById, roundMoney }
