/**
 * GitHub Actions / local CLI: slice a design STL and store G-code in Supabase.
 * Multicolor designs slice every part STL into separate G-code files.
 * Env: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      PRINTX_DESIGN_ID, PRINTX_PRINTER_ID, PRINTX_SLICER_BIN
 */
import { getDb, ensureDbReady, closeDb } from '../server/db.ts'
import { rowToDesign } from '../server/catalog.ts'
import { ensureModelBucket, resolveStoredFile } from '../server/objectStorage.ts'
import { storeGcodeBuffer } from '../server/gcodeStorage.ts'
import { sliceStlLocally, localSlicerAvailable } from '../server/localSlicer.ts'
import { designGcodeSliceTargets } from '../server/gcodePartPaths.ts'

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
  const designRow = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
  if (!designRow) throw new Error(`Design not found: ${designId}`)
  const design = rowToDesign(designRow)

  const targets = designGcodeSliceTargets(design)
  if (!targets.length) {
    throw new Error(
      design.multicolorOnly
        ? 'Multicolor design has no part STLs to slice'
        : 'Design has no stl_path',
    )
  }

  const gcodePaths = parseIdMap(designRow.gcode_paths_json)
  const quoteIds = parseIdMap(designRow.quote_ids_json)
  let totalGrams = 0
  let totalHours = 0

  try {
    for (const target of targets) {
      const resolved = await resolveStoredFile(target.stlPath)
      if (!resolved) throw new Error(`STL missing in storage: ${target.stlPath}`)
      try {
        const label =
          target.partIndex != null
            ? `part ${target.partIndex + 1} (${target.label})`
            : 'model'
        console.log('[prepare-gcode-ci] slicing', designId, printerId, label, target.stlPath)
        const local = await sliceStlLocally(resolved.path, printerId)
        const hint =
          target.partIndex != null
            ? `${designId.slice(0, 8)}-${printerId}-p${target.partIndex}`
            : `${designId.slice(0, 8)}-${printerId}`
        const storedName = await storeGcodeBuffer(local.buffer, { hint })
        gcodePaths[target.storageKey(printerId)] = storedName
        totalGrams += local.grams
        totalHours += local.hours
        console.log('[prepare-gcode-ci] stored', storedName, `${local.grams}g`, `${local.hours}h`)
      } finally {
        resolved.cleanup?.()
      }
    }

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

    const existingGrams = Number(designRow[gramsCol])
    const existingHours = Number(designRow[hoursCol])
    const grams =
      Number.isFinite(existingGrams) && existingGrams > 0 ? existingGrams : totalGrams
    const hours =
      Number.isFinite(existingHours) && existingHours > 0 ? existingHours : totalHours

    await db.run(
      `UPDATE designs SET
         gcode_paths_json = ?,
         quote_ids_json = ?,
         ${gramsCol} = ?,
         ${hoursCol} = ?,
         slice_status = 'ready',
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
    console.log(
      '[prepare-gcode-ci] done',
      targets.length,
      'file(s)',
      `${grams}g`,
      `${hours}h`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      await db.run(
        `UPDATE designs SET slice_status = 'error', slice_error = ?, updated_at = ? WHERE id = ?`,
        message.slice(0, 500),
        new Date().toISOString(),
        designId,
      )
    } catch {
      /* best-effort */
    }
    throw err
  } finally {
    await closeDb()
  }
}

main().catch((err) => {
  console.error('[prepare-gcode-ci]', err instanceof Error ? err.message : err)
  process.exit(1)
})
