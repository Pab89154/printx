/**
 * GitHub Actions / local CLI: slice a design STL and store G-code in Supabase.
 * Env: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      PRINTX_DESIGN_ID, PRINTX_PRINTER_ID, PRINTX_SLICER_BIN
 */
import { getDb, ensureDbReady, closeDb } from '../server/db.ts'
import { ensureModelBucket, resolveStoredFile } from '../server/objectStorage.ts'
import { storeGcodeBuffer } from '../server/gcodeStorage.ts'
import { sliceStlLocally, localSlicerAvailable } from '../server/localSlicer.ts'

function parseIdMap(raw: unknown): Record<string, string> {
  if (!raw) return {}
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!v || typeof v !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'string' && val.trim()) out[k] = val.trim()
    }
    return out
  } catch {
    return {}
  }
}

async function main() {
  const designId = process.env.PRINTX_DESIGN_ID?.trim()
  const printerId = process.env.PRINTX_PRINTER_ID?.trim() || 'pablo_p1s'
  if (!designId) throw new Error('PRINTX_DESIGN_ID is required')
  if (!localSlicerAvailable(printerId)) {
    throw new Error(
      `Local slicer not available for ${printerId}. Check PRINTX_SLICER_BIN / profiles.`,
    )
  }

  await ensureDbReady()
  await ensureModelBucket()
  const db = await getDb()
  const design = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
  if (!design) throw new Error(`Design not found: ${designId}`)

  const stlPath = String(design.stl_path || '').trim()
  if (!stlPath) throw new Error('Design has no stl_path')

  const resolved = await resolveStoredFile(stlPath)
  if (!resolved) throw new Error(`STL missing in storage: ${stlPath}`)

  try {
    console.log('[prepare-gcode-ci] slicing', designId, printerId, stlPath)
    const local = await sliceStlLocally(resolved.path, printerId)
    const storedName = await storeGcodeBuffer(local.buffer, {
      hint: `${designId.slice(0, 8)}-${printerId}`,
    })
    const gcodePaths = parseIdMap(design.gcode_paths_json)
    gcodePaths[printerId] = storedName
    const quoteIds = parseIdMap(design.quote_ids_json)
    quoteIds[printerId] = quoteIds[printerId] || `local-${Date.now().toString(36)}`

    const gramsCol =
      printerId === 'pablo_p1s'
        ? 'grams_pablo_p1s'
        : printerId === 'court_ender'
          ? 'grams_court_ender'
          : 'grams_josh_kobra'
    const hoursCol =
      printerId === 'pablo_p1s'
        ? 'hours_pablo_p1s'
        : printerId === 'court_ender'
          ? 'hours_court_ender'
          : 'hours_josh_kobra'

    const existingGrams = Number(design[gramsCol])
    const existingHours = Number(design[hoursCol])
    const grams =
      Number.isFinite(existingGrams) && existingGrams > 0 ? existingGrams : local.grams
    const hours =
      Number.isFinite(existingHours) && existingHours > 0 ? existingHours : local.hours

    await db.run(
      `UPDATE designs SET
         gcode_paths_json = ?,
         quote_ids_json = ?,
         ${gramsCol} = ?,
         ${hoursCol} = ?,
         slice_error = '',
         updated_at = ?
       WHERE id = ?`,
      JSON.stringify(gcodePaths),
      JSON.stringify(quoteIds),
      grams,
      hours,
      new Date().toISOString(),
      designId,
    )
    console.log('[prepare-gcode-ci] stored', storedName, `${grams}g`, `${hours}h`)
  } finally {
    resolved.cleanup?.()
    await closeDb()
  }
}

main().catch((err) => {
  console.error('[prepare-gcode-ci]', err instanceof Error ? err.message : err)
  process.exit(1)
})
