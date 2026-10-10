export type DesignStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived'

export type CatalogColor = {
  id: string
  code: string
  name: string
  hex: string
  builtin: boolean
}

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
  worstCostUsd: number | null
  catalogPriceUsd: number | null
  pricedAt: string | null
  pricingInputsJson: string
  createdAt: string
  updatedAt: string
}

export type PublicCatalogDesign = {
  id: string
  skuBase: string
  name: string
  description: string
  category: string
  imageUrl: string
  catalogPriceUsd: number | null
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
  createdAt: string
  updatedAt: string
  paidAt: string | null
  items?: OrderItemDto[]
}

export type CartLine = {
  designId: string
  skuBase: string
  name: string
  imageUrl: string
  colorId: string
  colorName: string
  colorHex: string
  unitPrice: number
  qty: number
}
