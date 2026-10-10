/** PrintX manufacturing cost + catalog price engine. */

export type PricingSettings = {
  filamentUsdPerGram: number
  electricityUsdPerKwh: number
  marginPct: number
  unproductiveAdderUsd: number
  fixingAdderUsd: number
  salesTaxPct: number
  customColorsJson: string
  updatedAt: string
  updatedBy: string | null
}

export type PrinterRow = {
  id: string
  ownerLabel: string
  modelName: string
  avgPowerKw: number
  active: boolean
  ownerUserId: string | null
}

export type PrinterCostInput = {
  printerId: string
  grams: number
  hours: number
  avgPowerKw: number
}

export type PrinterCostBreakdown = {
  printerId: string
  grams: number
  hours: number
  filamentUsd: number
  electricityUsd: number
  directUsd: number
  manufacturingUsd: number
}

export type DesignPriceResult = {
  printers: PrinterCostBreakdown[]
  worstCostUsd: number
  worstPrinterId: string | null
  catalogPriceUsd: number
  marginPct: number
  salesTaxPct: number
}

export const DEFAULT_PRICING: Omit<PricingSettings, 'updatedAt' | 'updatedBy'> = {
  filamentUsdPerGram: 0.0289,
  electricityUsdPerKwh: 0.15,
  marginPct: 0.5,
  unproductiveAdderUsd: 0.2,
  fixingAdderUsd: 0.05,
  salesTaxPct: 0,
  customColorsJson: '[]',
}

export const DEFAULT_PRINTERS: Omit<PrinterRow, 'ownerUserId'>[] = [
  {
    id: 'pablo_p1s',
    ownerLabel: 'Pablo',
    modelName: 'Bambu Lab P1S with AMS',
    avgPowerKw: 0.22,
    active: true,
  },
  {
    id: 'court_ender',
    ownerLabel: 'Court',
    modelName: 'Ender S1 Pro',
    avgPowerKw: 0.2,
    active: true,
  },
  {
    id: 'josh_kobra',
    ownerLabel: 'Josh',
    modelName: 'Kobra X Combo',
    avgPowerKw: 0.25,
    active: true,
  },
]

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function costForPrinter(
  input: PrinterCostInput,
  settings: Pick<
    PricingSettings,
    'filamentUsdPerGram' | 'electricityUsdPerKwh' | 'unproductiveAdderUsd' | 'fixingAdderUsd'
  >,
): PrinterCostBreakdown {
  const grams = Math.max(0, input.grams)
  const hours = Math.max(0, input.hours)
  const filamentUsd = roundMoney(grams * settings.filamentUsdPerGram)
  const electricityUsd = roundMoney(hours * input.avgPowerKw * settings.electricityUsdPerKwh)
  const directUsd = roundMoney(filamentUsd + electricityUsd)
  const manufacturingUsd = roundMoney(
    directUsd + settings.unproductiveAdderUsd + settings.fixingAdderUsd,
  )
  return {
    printerId: input.printerId,
    grams,
    hours,
    filamentUsd,
    electricityUsd,
    directUsd,
    manufacturingUsd,
  }
}

export function priceDesign(
  inputs: PrinterCostInput[],
  settings: PricingSettings,
): DesignPriceResult {
  const printers = inputs.map((i) => costForPrinter(i, settings))
  let worstCostUsd = 0
  let worstPrinterId: string | null = null
  for (const p of printers) {
    if (p.manufacturingUsd >= worstCostUsd) {
      worstCostUsd = p.manufacturingUsd
      worstPrinterId = p.printerId
    }
  }
  const withMargin = worstCostUsd * (1 + Math.max(0, settings.marginPct))
  const withTax = withMargin * (1 + Math.max(0, settings.salesTaxPct))
  return {
    printers,
    worstCostUsd: roundMoney(worstCostUsd),
    worstPrinterId,
    catalogPriceUsd: roundMoney(withTax),
    marginPct: settings.marginPct,
    salesTaxPct: settings.salesTaxPct,
  }
}
