/** Shop and admin label for a model's bounding box, in millimeters. */
export function formatSizeMm(
  xMm: number | null | undefined,
  yMm: number | null | undefined,
  zMm: number | null | undefined,
): string {
  if (xMm == null || yMm == null || zMm == null) return ''
  if (![xMm, yMm, zMm].every((n) => Number.isFinite(n) && n > 0)) return ''
  const fmt = (n: number) => {
    const rounded = Math.round(n * 10) / 10
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  }
  return `${fmt(xMm)} × ${fmt(yMm)} × ${fmt(zMm)} mm`
}
