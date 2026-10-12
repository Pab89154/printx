export type DesignStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived'

export type CatalogColor = {
  id: string
  code: string
  name: string
  hex: string
  builtin: boolean
}

export type SliceStatus = 'idle' | 'slicing' | 'ready' | 'error'

export type DesignPartDto = {
  label: string
  stlPath: string
  hasStl: boolean
  modelExt?: string
}

export type Design = {
  id: string
  skuBase: string
  name: string
  description: string
  category: string
  imageUrl: string
  stlPath: string
  hasStl: boolean
  /** File extension of the stored model, e.g. `.stl` (from API; path itself is never sent). */
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
  multicolorOnly: boolean
  multicolorSlotCount?: number
  parts?: DesignPartDto[]
  worstCostUsd: number | null
  catalogPriceUsd: number | null
  pricedAt: string | null
  pricingInputsJson: string
  createdAt: string
  updatedAt: string
}

export type PublicCatalogPart = {
  label: string
  modelUrl: string
}

export type PublicCatalogDesign = {
  id: string
  skuBase: string
  name: string
  description: string
  category: string
  imageUrl: string
  hasModel?: boolean
  modelExt?: string
  /** Public URL for STL preview (approved designs only). */
  modelUrl?: string
  catalogPriceUsd: number | null
  multicolorOnly?: boolean
  multicolorSlotCount?: number
  /** Per-slot part STLs for multicolor tinted preview. */
  parts?: PublicCatalogPart[]
  availableColors: CatalogColor[]
}

export type PricingSettingsDto = {
  filamentUsdPerGram: number
  electricityUsdPerKwh: number
  marginPct: number
  unproductiveAdderUsd: number
  fixingAdderUsd: number
  salesTaxPct: number
  customColorsJson: string
  updatedAt: string
  updatedBy: string | null
  customColors: { id: string; name: string; hex: string; code: string }[]
}

export type PrinterDto = {
  id: string
  ownerLabel: string
  modelName: string
  avgPowerKw: number
  active: boolean
  ownerUserId: string | null
}

export type OrderItemDto = {
  id: string
  orderId: string
  designId: string
  sku: string
  colorId: string
  colorName: string
  filamentColorIds?: string[]
  qty: number
  unitPriceUsd: number
  worstCostUnitUsd: number
  lineTotalUsd: number
  printStatus: 'unclaimed' | 'claimed' | 'printing' | 'done'
  assignedPrinterId: string | null
  assignedAdminUserId: string | null
  claimedAt: string | null
  completedAt: string | null
  reimburseUsd: number | null
  profitUsd: number | null
  designName?: string
}

export type OrderDto = {
  id: string
  customerName: string
  customerEmail: string
  status: string
  stripeSessionId: string | null
  stripePaymentIntent: string | null
  subtotalUsd: number
  totalUsd: number
  currency: string
  shippingName: string
  shippingLine1: string
  shippingLine2: string
  shippingCity: string
  shippingState: string
  shippingPostal: string
  shippingCountry: string
  shippingMethod: string
  shippingUsd: number
  trackingNumber?: string
  trackingCarrier?: string
  trackingUrl?: string
  shippedAt?: string | null
  userId?: string | null
  pendingRefundRequest?: {
    id: string
    reason: string
    createdAt: string
  } | null
  createdAt: string
  updatedAt: string
  paidAt: string | null
  items?: OrderItemDto[]
}

export type MoneyPaymentLineDto = {
  id: string
  kind: 'shop' | 'custom'
  label: string
  email: string
  amountUsd: number
  status: string
  paidAt: string | null
  stripeSessionId: string | null
}

export type MoneyOwedLineDto = {
  id: string
  amountUsd: number
  note: string
  createdAt: string
  orderId: string | null
  designName: string | null
  sku: string | null
  colorName: string | null
  qty: number | null
}

export type MoneyOwedPersonDto = {
  userId: string
  email: string
  displayName: string | null
  totalOwedUsd: number
  lines: MoneyOwedLineDto[]
  settlement: {
    id: string
    amountUsd: number
    markedPaidAt: string
    note: string
  } | null
}

export type MoneyPeriodTotalsDto = {
  stripeUsd: number
  owedToMeUsd: number
  reimbursementsUsd: number
}

export type MoneyMonthHistoryDto = {
  month: string
  stripeUsd: number
  owedToMeUsd: number
  reimbursementsUsd: number
  mySettlement: {
    amountUsd: number
    markedPaidAt: string
  } | null
}

export type MoneySummaryDto = {
  month: string
  earnings: {
    totalUsd: number
    shopUsd: number
    customUsd: number
    shopOrders: MoneyPaymentLineDto[]
    customOrders: MoneyPaymentLineDto[]
  }
  owedByPerson: MoneyOwedPersonDto[]
  reimbursementsTotalUsd: number
  /** Printer/admin costs combined (ledger or worst-case estimate). */
  adminsEarnAllUsd?: number
  shippingTotalUsd?: number
  /** Customer paid this month (items + shipping). */
  printxEarnedGrossUsd?: number
  businessKeptUsd: number
  canSettle: boolean
  totals: {
    year: MoneyPeriodTotalsDto & { year: number }
    allTime: MoneyPeriodTotalsDto
  }
  monthHistory: MoneyMonthHistoryDto[]
}

export type CartLine = {
  designId: string
  skuBase: string
  name: string
  imageUrl: string
  colorId: string
  colorName: string
  colorHex: string
  /** Solid filament picks for multicolor lines. */
  filamentColorIds?: string[]
  unitPrice: number
  qty: number
}
